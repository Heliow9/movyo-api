const express = require("express");
const router = express.Router();

const imagens = require("../controllers/imagens.controller");

// ✅ use o seu middleware de auth (o mesmo do estoque)
const authRestaurante = require("../middlewares/authRestaurante");

// tudo protegido
router.use(authRestaurante);

// busca
router.get("/buscar", imagens.buscarImagens);

// favoritas (por restaurante)
router.get("/favoritas", imagens.listarFavoritas);
router.post("/favoritas", imagens.adicionarFavorita);
router.delete("/favoritas", imagens.removerFavorita);
router.post("/favoritas/sync", imagens.syncFavoritas);

module.exports = router;
