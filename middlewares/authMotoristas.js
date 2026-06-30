const jwt = require("jsonwebtoken");
const Entregador = require("../models/Entregador");
const Restaurante = require("../models/Restaurante");
const { planHasFeature } = require("../utils/planRules");
require("dotenv").config();

function extractToken(req) {
  const raw = req.headers.authorization || req.headers.Authorization || "";
  const parts = String(raw).trim().split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return String(raw).trim();
}

module.exports = async function authMotoristas(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ mensagem: "Token nao fornecido." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const entregadorId = String(decoded.entregadorId || decoded.id || "");
    if (!entregadorId) {
      return res.status(401).json({ mensagem: "Token sem identificacao do motorista." });
    }

    const entregador = await Entregador.findById(entregadorId);
    if (!entregador) return res.status(401).json({ mensagem: "Motorista nao encontrado." });
    if (
      String(entregador.statusConta || "ativo").toLowerCase() === "bloqueado"
    ) {
      return res.status(403).json({ mensagem: "Acesso do motorista bloqueado." });
    }

    const restaurante = await Restaurante.findById(entregador.restaurante).lean();
    if (!restaurante || restaurante.ativo === false) {
      return res.status(403).json({ mensagem: "Restaurante bloqueado ou inativo." });
    }
    if (!planHasFeature(restaurante, "driversApp")) {
      return res.status(403).json({
        code: "PLANO_REQUERIDO",
        mensagem: "O app Movyo Motorista esta disponivel no plano Premium.",
      });
    }

    req.userId = entregadorId;
    req.entregadorId = entregadorId;
    req.restauranteId = String(entregador.restaurante);
    req.role = "entregador";
    req.user = {
      id: entregadorId,
      _id: entregadorId,
      role: "entregador",
      restauranteId: req.restauranteId,
    };
    req.jwt = decoded;
    req.entregador = entregador;
    req.restauranteMotorista = restaurante;
    return next();
  } catch (error) {
    const jwtError = /jwt|token|signature/i.test(String(error?.message || ""));
    return res.status(jwtError ? 401 : 500).json({
      mensagem: jwtError ? "Token invalido ou expirado." : "Erro ao validar motorista.",
    });
  }
};