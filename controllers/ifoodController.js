// controllers/ifoodController.js
const crypto = require("crypto");
const axios = require("axios");
const mongoose = require("../lib/mongoId");

const Restaurante = require("../models/Restaurante");
const OAuthState = require("../models/OAuthState");

function safeBaseUrl(v) {
  return String(v || "").replace(/\/$/, "");
}

function pickRestauranteIdFromReq(req) {
  // authRestaurante deve setar req.restauranteId
  return req.restauranteId || null;
}

// ===== PKCE helpers =====
function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateCodeVerifier() {
  // 43~128 chars
  return base64url(crypto.randomBytes(64));
}

function codeChallengeS256(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

/**
 * GET /api/ifood/connect-url
 * Retorna { url }
 */
exports.startOAuth = async (req, res) => {
  try {
    const restauranteId = pickRestauranteIdFromReq(req);
    if (!restauranteId) return res.status(401).json({ error: "Token não fornecido / não autenticado." });

    if (!mongoose.Types.ObjectId.isValid(String(restauranteId))) {
      return res.status(400).json({ error: "restauranteId inválido." });
    }

    const {
      IFOOD_CLIENT_ID,
      IFOOD_OAUTH_AUTHORIZE_URL,
      PUBLIC_API_BASE_URL,
      IFOOD_OAUTH_REDIRECT_PATH,
    } = process.env;

    if (!IFOOD_CLIENT_ID || !IFOOD_OAUTH_AUTHORIZE_URL || !PUBLIC_API_BASE_URL) {
      return res.status(500).json({
        error: "ENV do iFood incompleta",
        missing: {
          IFOOD_CLIENT_ID: !!IFOOD_CLIENT_ID,
          IFOOD_OAUTH_AUTHORIZE_URL: !!IFOOD_OAUTH_AUTHORIZE_URL,
          PUBLIC_API_BASE_URL: !!PUBLIC_API_BASE_URL,
        },
      });
    }

    const restaurante = await Restaurante.findById(restauranteId).select("_id");
    if (!restaurante) return res.status(404).json({ error: "Restaurante não encontrado." });

    // ✅ state + pkce
    const state = base64url(crypto.randomBytes(32));
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeChallengeS256(codeVerifier);

    await OAuthState.create({
      provider: "ifood",
      state,
      restauranteId: restaurante._id,
      codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
    });

    // ✅ callback correto (padrão: /api/ifood/oauth/callback)
    const redirectPath = IFOOD_OAUTH_REDIRECT_PATH || "/api/ifood/oauth/callback";
    const redirectUri = `${safeBaseUrl(PUBLIC_API_BASE_URL)}${redirectPath}`;

    const url =
      `${IFOOD_OAUTH_AUTHORIZE_URL}?` +
      new URLSearchParams({
        response_type: "code",
        client_id: IFOOD_CLIENT_ID,
        redirect_uri: redirectUri,
        state,

        // ✅ PKCE
        code_challenge: codeChallenge,
        code_challenge_method: "S256",

        // scope: "orders events" // (se o iFood exigir, você coloca aqui)
      }).toString();

    console.log("[iFood] connect-url authorizeUrl:", url);
    return res.json({ url });
  } catch (err) {
    console.error("[iFood] startOAuth error:", err?.response?.data || err);
    return res.status(500).json({ error: "Erro ao iniciar OAuth iFood." });
  }
};

/**
 * GET /api/ifood/oauth/callback
 * iFood redireciona aqui com ?code=...&state=...
 */
exports.callbackOAuth = async (req, res) => {
  const { code, state, error, error_description } = req.query;

  const appUrl = process.env.APP_URL || "http://localhost:5173/#/configuracoes";

  try {
    if (error) {
      console.error("[iFood] callback error:", { error, error_description });
      return res.redirect(`${appUrl}?ifood=erro`);
    }

    if (!code || !state) return res.redirect(`${appUrl}?ifood=erro`);

    const entry = await OAuthState.findOne({ provider: "ifood", state });
    if (!entry) return res.redirect(`${appUrl}?ifood=erro`);

    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      await OAuthState.deleteOne({ _id: entry._id });
      return res.redirect(`${appUrl}?ifood=erro`);
    }

    const {
      IFOOD_CLIENT_ID,
      IFOOD_CLIENT_SECRET,
      IFOOD_AUTH_URL,
      PUBLIC_API_BASE_URL,
      IFOOD_OAUTH_REDIRECT_PATH,
    } = process.env;

    if (!IFOOD_CLIENT_ID || !IFOOD_CLIENT_SECRET || !IFOOD_AUTH_URL || !PUBLIC_API_BASE_URL) {
      await OAuthState.deleteOne({ _id: entry._id });
      return res.redirect(`${appUrl}?ifood=erro`);
    }

    const redirectPath = IFOOD_OAUTH_REDIRECT_PATH || "/api/ifood/oauth/callback";
    const redirectUri = `${safeBaseUrl(PUBLIC_API_BASE_URL)}${redirectPath}`;

    // ✅ troca code por token (com PKCE -> code_verifier)
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: IFOOD_CLIENT_ID,
      client_secret: IFOOD_CLIENT_SECRET,
      code: String(code),
      redirect_uri: redirectUri,

      // ✅ PKCE
      code_verifier: entry.codeVerifier,
    }).toString();

    const tokenResp = await axios.post(IFOOD_AUTH_URL, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    const { access_token, refresh_token, expires_in, scope } = tokenResp.data || {};

    await Restaurante.findByIdAndUpdate(entry.restauranteId, {
      $set: {
        "ifood.conectado": true,
        "ifood.accessToken": access_token || null,
        "ifood.refreshToken": refresh_token || null,
        "ifood.tokenExpiraEm": typeof expires_in === "number" ? new Date(Date.now() + expires_in * 1000) : null,
        "ifood.ultimoOAuthEm": new Date(),
        "ifood.scopes": scope ? String(scope).split(" ") : [],
        "ifood.lastError": null,
      },
    });

    await OAuthState.deleteOne({ _id: entry._id });

    return res.redirect(`${appUrl}?ifood=ok`);
  } catch (err) {
    console.error("[iFood] callbackOAuth error:", err?.response?.data || err);
    try {
      if (state) await OAuthState.deleteOne({ provider: "ifood", state });
    } catch {}
    return res.redirect(`${appUrl}?ifood=erro`);
  }
};
