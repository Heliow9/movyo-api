// controllers/mercadoPagoController.js
// OAuth Mercado Pago (PKCE) + status + disconnect (revoga token quando possível)

const crypto = require("crypto");
const axios = require("axios");
const Restaurante = require("../models/Restaurante");
const OAuthState = require("../models/OAuthState");
const { trocarCodePorToken } = require("../services/mercadoPagoOAuthService");

// -------------------- helpers --------------------
function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function gerarCodeVerifier() {
  // 43..128 chars recomendado (RFC 7636). randomBytes(64) => ~86 chars base64url
  return base64UrlEncode(crypto.randomBytes(64));
}

function gerarCodeChallenge(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}

function gerarState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

function safeRedirect(baseUrl, params = {}) {
  // evita open-redirect e mantém query consistente
  try {
    const u = new URL(baseUrl);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    return u.toString();
  } catch {
    // fallback simples
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
      )
    ).toString();
    return q ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${q}` : baseUrl;
  }
}

function getAppRedirectUrl() {
  // defina no .env algo como:
  // APP_URL=https://app.movyo.delivery/#/configuracoes
  // (pode ser com ou sem hash, depende do seu front)
  return process.env.APP_URL || "http://localhost:5173/#/configuracoes";
}

// -------------------- controllers --------------------

/**
 * GET /api/mercadopago/oauth/start/:restauranteId
 * Retorna { url }
 */
exports.startOAuth = async (req, res) => {
  try {
    const { restauranteId } = req.params;
    const { MP_CLIENT_ID, MP_REDIRECT_URI } = process.env;

    console.log("🟡 startOAuth HIT", { restauranteId, MP_REDIRECT_URI });

    if (!MP_CLIENT_ID || !MP_REDIRECT_URI) {
      return res.status(500).json({
        error: "MP_CLIENT_ID ou MP_REDIRECT_URI não configurados no servidor (.env).",
      });
    }
    if (!restauranteId) {
      return res.status(400).json({ error: "restauranteId não informado." });
    }

    const rest = await Restaurante.findById(restauranteId).select("_id");
    if (!rest) {
      return res.status(404).json({ error: "Restaurante não encontrado." });
    }

    // ✅ PKCE
    const codeVerifier = gerarCodeVerifier();
    const codeChallenge = gerarCodeChallenge(codeVerifier);

    // ✅ State único por tentativa
    const state = gerarState();

    // ✅ salva state + verifier (expira em 10 min)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OAuthState.create({
      provider: "mercadopago",
      state,
      restauranteId: rest._id,
      codeVerifier,
      createdAt: new Date(),
      expiresAt,
      usedAt: null, // opcional (se seu schema aceitar)
    });

    const scope = "read write";
    const base = "https://auth.mercadopago.com.br/authorization";

    // IMPORTANTE: redirect_uri aqui precisa ser IDENTICO ao usado na troca do token
    const url =
      `${base}?client_id=${encodeURIComponent(MP_CLIENT_ID)}` +
      `&response_type=code` +
      `&platform_id=mp` +
      `&redirect_uri=${encodeURIComponent(MP_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=S256`;

    console.log("🟣 OAuth URL GERADA:", url);

    return res.json({ url });
  } catch (err) {
    console.error("❌ startOAuth error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Erro ao iniciar OAuth Mercado Pago." });
  }
};

/**
 * GET /api/mercadopago/oauth/callback?code=...&state=...
 */
exports.callbackOAuth = async (req, res) => {
  console.log("🔥 CALLBACK CHEGOU", req.query);

  const { code, state, error, error_description } = req.query;
  const appUrl = getAppRedirectUrl();

  try {
    if (error) {
      console.error("❌ MP retornou error:", { error, error_description });
      return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: error }));
    }

    if (!code) return res.status(400).send("Callback inválido: sem 'code'.");
    if (!state) return res.status(400).send("Callback inválido: sem 'state'.");

    // Busca o state salvo
    const entry = await OAuthState.findOne({ provider: "mercadopago", state });
    if (!entry) {
      console.error("❌ OAuthState não encontrado (expirou ou state inválido).", { state });
      return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: "state_invalido" }));
    }

    // expiração hard
    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      console.error("❌ OAuthState expirado.", { state });
      await OAuthState.deleteOne({ _id: entry._id });
      return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: "state_expirado" }));
    }

    // (Opcional) se seu schema tiver usedAt, evita reuso/replay
    if (entry.usedAt) {
      console.error("❌ OAuthState já utilizado.", { state });
      return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: "state_reutilizado" }));
    }

    const codeVerifier = entry.codeVerifier;

    // ✅ marca como usado antes de trocar token (mitiga replay em callbacks duplicados)
    try {
      await OAuthState.updateOne({ _id: entry._id }, { $set: { usedAt: new Date() } });
    } catch (e) {
      // se seu schema não tiver usedAt, ignora sem quebrar
    }

    // ✅ troca code por token (PKCE)
    let data;
    try {
      data = await trocarCodePorToken(code, codeVerifier);
    } catch (e) {
      console.error("❌ trocarCodePorToken falhou:", e?.response?.data || e?.message || e);
      await OAuthState.deleteOne({ _id: entry._id });
      return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: "token_exchange" }));
    }

    console.log("✅ TOKEN OK", {
      user_id: data?.user_id,
      has_access_token: !!data?.access_token,
      expires_in: data?.expires_in,
    });

    await Restaurante.findByIdAndUpdate(entry.restauranteId, {
      $set: {
        "mercadoPago.conectado": true,
        "mercadoPago.userId": data?.user_id != null ? String(data.user_id) : null,
        "mercadoPago.accessToken": data?.access_token != null ? String(data.access_token) : null,
        "mercadoPago.refreshToken": data?.refresh_token != null ? String(data.refresh_token) : null,
        "mercadoPago.tokenExpiraEm": new Date(Date.now() + Number(data.expires_in || 0) * 1000),
        "mercadoPago.ultimoOAuthEm": new Date(),
      },
    });

    await OAuthState.deleteOne({ _id: entry._id });

    return res.redirect(safeRedirect(appUrl, { mp: "ok" }));
  } catch (err) {
    console.error("❌ callbackOAuth error:", err?.response?.data || err?.message || err);
    return res.redirect(safeRedirect(appUrl, { mp: "erro", reason: "callback_exception" }));
  }
};

/**
 * GET /api/mercadopago/status/:restauranteId
 */
exports.statusById = async (req, res) => {
  try {
    const { restauranteId } = req.params;
    const restaurante = await Restaurante.findById(restauranteId).select("mercadoPago");
    if (!restaurante) return res.status(404).json({ error: "Restaurante não encontrado." });

    const mp = restaurante.mercadoPago || {};
    return res.json({
      conectado: !!mp.conectado,
      userId: mp.userId || null,
      tokenExpiraEm: mp.tokenExpiraEm || null,
      ultimoOAuthEm: mp.ultimoOAuthEm || null,
    });
  } catch (err) {
    console.error("statusById Mercado Pago error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Erro ao buscar status Mercado Pago." });
  }
};

/**
 * POST /api/mercadopago/disconnect
 * Requer auth (depende do seu middleware)
 */
exports.disconnect = async (req, res) => {
  try {
    // ✅ deixa robusto (cada middleware usa um nome)
    const restauranteId = req.userId || req.restauranteId || req.user?._id;
    if (!restauranteId) return res.status(401).json({ error: "Não autenticado." });

    const restaurante = await Restaurante.findById(restauranteId).select("mercadoPago");
    if (!restaurante) return res.status(404).json({ error: "Restaurante não encontrado." });

    const accessToken = restaurante?.mercadoPago?.accessToken;

    // opcional: revogar token (se suportado para o seu tipo de app)
    if (accessToken) {
      try {
        await axios.post(
          "https://api.mercadopago.com/oauth/revoke",
          new URLSearchParams({ token: accessToken }).toString(),
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 15000,
          }
        );
        console.log("🧹 Token revogado no MP (se suportado).");
      } catch (e) {
        console.warn("⚠️ Falha ao revogar no MP (ok):", e?.response?.data || e?.message);
      }
    }

    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        // ✅ ao desconectar MP, desliga cartão na vitrine automaticamente
        pagamentoCartaoAtivo: false,

        "mercadoPago.conectado": false,
        "mercadoPago.userId": null,
        "mercadoPago.accessToken": null,
        "mercadoPago.refreshToken": null,
        "mercadoPago.tokenExpiraEm": null,
        "mercadoPago.ultimoOAuthEm": null,
      },
    });


    await OAuthState.deleteMany({ provider: "mercadopago", restauranteId });

    return res.json({ ok: true, message: "Mercado Pago desconectado com sucesso." });
  } catch (err) {
    console.error("disconnect Mercado Pago error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Erro ao desconectar Mercado Pago." });
  }
};
