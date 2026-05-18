// routes/clienteRoutes.js
const express = require("express");
const { buscarClientePorTelefone } = require("../controllers/clienteController");

const router = express.Router();

// Rota de teste rápida: GET /api/clientes/test
router.get("/test", (req, res) => {
  console.log("✅ Rota /api/clientes/test foi chamada");
  res.json({ ok: true, message: "Rota de clientes ativa" });
});

// Buscar cliente pelo telefone: GET /api/clientes/:telefone
router.get("/:telefone", buscarClientePorTelefone);

module.exports = router;
