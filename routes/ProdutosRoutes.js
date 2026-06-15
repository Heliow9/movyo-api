// routes/produtoRoutes.js
const express = require("express");
const controller = require("../controllers/produtoController");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");

const router = express.Router();

/**
 * ⚠️ IMPORTANTE:
 * mantenha rotas "fixas" (ordem/reordenar, duplicar, etc.) ANTES de "/:restauranteId"
 * pra não bater conflito de params.
 */

// ✅ Novas rotas (fixas primeiro)
router.put("/ordem/reordenar", authRestaurante, matchRestaurante, controller.reordenarProdutos);
router.post("/duplicar/:id", authRestaurante, matchRestaurante, controller.duplicarProduto);

router.put("/:id/ativar", authRestaurante, matchRestaurante, controller.ativarProduto);
router.put("/:id/desativar", authRestaurante, matchRestaurante, controller.desativarProduto);

router.put("/:id/destaque", authRestaurante, matchRestaurante, controller.setProdutoDestaque);
router.put("/:id/vitrine", authRestaurante, matchRestaurante, controller.setProdutoAtivoVitrine);

// ✅ NOVO: imprime na cozinha
router.put("/:id/imprime-cozinha", authRestaurante, matchRestaurante, controller.setProdutoImprimeCozinha);

// CRUD
router.post("/", authRestaurante, matchRestaurante, controller.criarProduto);
router.put("/:id", authRestaurante, matchRestaurante, controller.editarProduto);
router.delete("/:id", authRestaurante, matchRestaurante, controller.excluirProduto);

// Buscar produtos por restaurante (deixe por último por causa do "/:param")
router.get("/:restauranteId", controller.getProdutosPorRestaurante);

module.exports = router;
