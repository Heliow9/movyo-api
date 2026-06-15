// middlewares/authRestaurante.js
const jwt = require("jsonwebtoken");
const Restaurante = require("../models/Restaurante");
require("dotenv").config();

function extractToken(req) {
  const auth =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers["x-access-token"] ||
    req.query?.token ||
    "";

  if (!auth) return null;

  const parts = String(auth).trim().split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return String(auth).trim();
}

module.exports = async function authRestaurante(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ mensagem: "Token não fornecido." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ restauranteId em vários formatos
    const restauranteId =
      decoded.restauranteId ||
      decoded.idRestaurante ||
      decoded.restaurante?._id ||
      decoded._id ||
      decoded.id;

    if (!restauranteId) {
      return res.status(401).json({
        mensagem: "Token válido, mas sem restauranteId no payload.",
      });
    }

    // ✅ base
    req.restauranteId = String(restauranteId);
    req.role = decoded.role || "restaurante";
    req.permissoes = decoded.permissoes || {};

    // ✅ útil p/ debug / compat
    req.jwt = decoded;

    // ✅ compat antigo
    req.userId = decoded.id || String(restauranteId);

    // ✅ padrão: quando é restaurante/admin, pode deixar o decoded em req.user
    req.user = decoded;

    // ✅ valida plano/assinatura e força logout quando o SaaS altera plano/status/vencimento.
    const restAuth = await Restaurante.findById(req.restauranteId).select(
      "garcons ativo bloqueado nome plano statusAssinatura dataFimPlano sessaoVersao"
    );

    if (!restAuth) return res.status(404).json({ mensagem: "Restaurante não encontrado." });

    const dataLocal = (value) => {
      if (!value) return null;
      const text = String(value);
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const d = match ? new Date(Number(match[1]), Number(match[2])-1, Number(match[3]), 23, 59, 59, 999) : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const agora = new Date();
    const fimPlano = dataLocal(restAuth.dataFimPlano);
    const venceu = !!(fimPlano && fimPlano.getTime() < agora.getTime());

    if (venceu) {
      // Licença vencida deve ser tratada como licença vencida, não como bloqueio/desativação.
      // Não derrubamos sessaoVersao aqui para evitar o falso erro “Sua sessão foi atualizada”.
      return res.status(403).json({
        mensagem: "Licença vencida. Regularize o plano para continuar usando o Movyo.",
        code: "LICENCA_VENCIDA"
      });
    }

    if (restAuth?.ativo === false || restAuth?.bloqueado === true || String(restAuth.statusAssinatura || '').toLowerCase() === 'bloqueado') {
      return res.status(403).json({
        mensagem: "Restaurante bloqueado/desativado. Fale com o suporte Movyo.",
        code: "RESTAURANTE_BLOQUEADO",
      });
    }

    // ATENÇÃO:
    // O bloqueio por sessaoVersao causava falso logout no app do garçom/restaurante
    // quando o cadastro do restaurante era salvo/atualizado no SaaS.
    // Como este middleware já consulta o restaurante no banco em toda requisição,
    // bloqueio real e licença vencida continuam sendo aplicados imediatamente acima.
    const tokenVersao = Number(decoded.sessaoVersao || 1);
    const bancoVersao = Number(restAuth.sessaoVersao || 1);
    if (tokenVersao !== bancoVersao) {
      req.sessaoDesatualizada = true;
    }

    req.restaurante = restAuth;
    req.plano = restAuth.plano || 'free';
    res.setHeader('X-Movyo-License-Status', 'valid');
    if (restAuth.dataFimPlano) res.setHeader('X-Movyo-License-Expires', new Date(restAuth.dataFimPlano).toISOString());

    // =========================
    // ✅ MODO GARÇOM
    // =========================
    if (req.role === "garcom") {
      // tenta pegar garcomId de várias chaves
      const garcomId =
        decoded.garcomId ||
        decoded.garcom?._id ||
        decoded._garcomId ||
        decoded.userId || // se você gravou assim
        null;

      req.garcomId = garcomId ? String(garcomId) : null;
      req.restauranteSlug = decoded.restauranteSlug || decoded.slug || null;

      if (!req.garcomId) {
        return res.status(401).json({ mensagem: "Garçom não autenticado." });
      }

      // ✅ usa restaurante já validado acima
      const rest = restAuth;

      // MySQL: garcons vem como JSON array, não subdocumento Mongoose.
      const garcons = Array.isArray(rest.garcons) ? rest.garcons : [];
      const garcom = garcons.find((g) => String(g?._id || g?.id || g?.garcomId) === String(req.garcomId));
      if (!garcom) return res.status(404).json({ mensagem: "Garçom não encontrado." });

      if (garcom.ativo === false) {
        return res.status(403).json({ mensagem: "Garçom desativado." });
      }

      // ✅ expõe subdoc completo (pra quem precisar)
      req.garcomDoc = garcom;

      // ✅ monta um objeto “limpo” e consistente
      const garcomUser = {
        _id: String(garcom._id),
        nome: garcom.nome || null,
        apelido: garcom.apelido || null,
        telefone: garcom.telefone || null,
        ativo: garcom.ativo !== false,
        permissoes: garcom.permissoes || {},
        role: "garcom",
        restauranteId: String(req.restauranteId),
        restauranteNome: rest?.nome || null,
      };

      // ✅ IMPORTANTE: controllers do app usam req.user._id / req.user.nome
      req.garcom = garcomUser;
      req.user = garcomUser;

      // ✅ compat antigo: userId deve ser do garçom
      req.userId = String(garcom._id);
      req.permissoes = garcomUser.permissoes || {};
    }

    return next();
  } catch (err) {
    console.error("authRestaurante:", err?.message || err);
    const msg = String(err?.message || "").toLowerCase();
    const isJwt = msg.includes("jwt") || msg.includes("token") || msg.includes("signature");
    return res.status(isJwt ? 401 : 500).json({
      mensagem: isJwt ? "Token inválido." : "Erro ao validar autenticação.",
      error: err?.message,
    });
  }
};
