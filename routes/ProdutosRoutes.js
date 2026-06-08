// routes/produtoRoutes.js
const express = require("express");
const controller = require("../controllers/produtoController");

const router = express.Router();

/**
 * ⚠️ IMPORTANTE:
 * mantenha rotas "fixas" (ordem/reordenar, duplicar, etc.) ANTES de "/:restauranteId"
 * pra não bater conflito de params.
 */

// ✅ Novas rotas (fixas primeiro)
router.put("/ordem/reordenar", controller.reordenarProdutos);
router.post("/duplicar/:id", controller.duplicarProduto);

router.put("/:id/ativar", controller.ativarProduto);
router.put("/:id/desativar", controller.desativarProduto);

router.put("/:id/destaque", controller.setProdutoDestaque);
router.put("/:id/vitrine", controller.setProdutoAtivoVitrine);

// ✅ NOVO: imprime na cozinha
router.put("/:id/imprime-cozinha", controller.setProdutoImprimeCozinha);

// CRUD
router.post("/", controller.criarProduto);
router.put("/:id", controller.editarProduto);
router.delete("/:id", controller.excluirProduto);

// Buscar produtos por restaurante (deixe por último por causa do "/:param")
router.get("/:restauranteId", controller.getProdutosPorRestaurante);

module.exports = router;
