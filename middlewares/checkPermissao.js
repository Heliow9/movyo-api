// middlewares/checkPermissao.js
module.exports = function checkPermissao(chave) {
  return (req, res, next) => {
    // 🧠 Identifica role
    const role = req.role || req.user?.role;

    // ✅ Restaurante / admin passa sempre
    if (role && role !== "garcom") return next();

    // 🧠 Garçom: tenta todas as fontes possíveis (ordem importa)
    const permissoes =
      req.garcom?.permissoes ||       // vindo do authRestaurante (modo garçom)
      req.user?.permissoes ||         // compat
      req.permissoes ||               // compat antigo
      {};

    // aceita boolean true e string "true"
    const allowed = permissoes?.[chave] === true || permissoes?.[chave] === "true";

    if (allowed) return next();

    // ❌ Bloqueado
    return res.status(403).json({
      code: "PERMISSION_DENIED",
      message: "Sem permissão para executar esta ação.",
      permissaoNecessaria: chave,
    });
  };
};
