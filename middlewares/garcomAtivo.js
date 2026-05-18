// middlewares/garcomAtivo.js
const Restaurante = require("../models/Restaurante");

module.exports = async function garcomAtivo(req, res, next) {
  try {
    // ✅ normaliza role (evita "Garcom" / "GARCOM" etc)
    const role = String(req.role || req.user?.role || "").toLowerCase();
    const isGarcom = role === "garcom";
    if (!isGarcom) return next();

    /**
     * ✅ IMPORTANTE:
     * No modo garçom, req.userId normalmente vira o ID do garçom (setado no authRestaurante).
     * Então NÃO use req.userId como fallback de restauranteId aqui.
     */
    const restauranteId =
      req.restauranteId || req.user?.restauranteId || req.jwt?.restauranteId || null;

    const garcomId = req.garcomId || req.user?._id || req.user?.garcomId || null;

    if (!restauranteId || !garcomId) {
      return res.status(401).json({
        message: "Garçom não autenticado.",
        code: "GARCOM_NAO_AUTENTICADO",
      });
    }

    const rest = await Restaurante.findById(restauranteId).select("garcons ativo bloqueado nome");

    if (!rest) {
      return res.status(404).json({
        message: "Restaurante não encontrado.",
        code: "REST_NAO_ENCONTRADO",
      });
    }

    if (rest?.ativo === false || rest?.bloqueado === true) {
      return res.status(403).json({
        message: "Restaurante desativado/bloqueado. Fale com o gerente.",
        code: "RESTAURANTE_BLOQUEADO",
      });
    }

    const garcom = rest.garcons?.id(String(garcomId));
    if (!garcom) {
      return res.status(404).json({
        message: "Garçom não encontrado.",
        code: "GARCOM_NAO_ENCONTRADO",
      });
    }

    if (garcom.ativo === false) {
      return res.status(403).json({
        message: "Seu acesso foi desativado. Fale com o gerente.",
        code: "GARCOM_DESATIVADO",
      });
    }

    // ✅ mantém doc completo
    req.garcomDoc = garcom;
    req.garcomId = String(garcom._id);

    // ✅ GARANTE req.user e req.garcom preenchidos (caso authRestaurante não tenha feito)
    if (!req.garcom || !req.user || !req.user?._id) {
      const garcomUser = {
        _id: String(garcom._id),
        nome: garcom.nome || null,
        apelido: garcom.apelido || null,
        telefone: garcom.telefone || null,
        ativo: garcom.ativo !== false,
        permissoes: garcom.permissoes || {},
        role: "garcom",
        restauranteId: String(restauranteId),
        restauranteNome: rest?.nome || null,
      };

      req.garcom = garcomUser;
      req.user = garcomUser;

      // compat antigo
      req.userId = String(garcom._id);
      req.permissoes = garcomUser.permissoes || {};
      req.role = "garcom";
    }

    return next();
  } catch (err) {
    console.error("garcomAtivo:", err);
    return res.status(500).json({
      message: "Erro ao validar garçom.",
      code: "ERRO_VALIDAR_GARCOM",
      error: err.message,
    });
  }
};
