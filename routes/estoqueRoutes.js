const express = require("express");
const router = express.Router();

// controllers
const insumos = require("../controllers/estoque/insumos.controller");
const receitas = require("../controllers/estoque/receitas.controller");
const movimentos = require("../controllers/estoque/movimentos.controller");
const relatorios = require("../controllers/estoque/relatorios.controller");

// middleware auth (ajuste o path/nome para o seu)
const authRestaurante = require("../middlewares/authRestaurante");

// aplica auth em tudo
router.use(authRestaurante);

/**
 * INSUMOS
 */
router.get("/insumos", insumos.listar);
router.post("/insumos", insumos.criar);
router.get("/insumos/:id", insumos.obter);
router.patch("/insumos/:id", insumos.atualizar);
router.delete("/insumos/:id", insumos.remover);

/**
 * MOVIMENTOS (compra/ajuste/estorno) e histórico
 */
router.get("/insumos/:id/movimentos", movimentos.listarPorInsumo);
router.post("/insumos/:id/movimentos", movimentos.criarMovimentoManual); // compra/ajuste

/**
 * RECEITAS
 */
router.get("/receitas", receitas.listar);
router.post("/receitas", receitas.criar);
router.get("/receitas/:id", receitas.obter);
router.patch("/receitas/:id", receitas.atualizar);
router.delete("/receitas/:id", receitas.remover);

/**
 * RELATÓRIOS
 * - produção: calcula "produz até X" e gargalo
 * - alertas: insumos abaixo do mínimo
 * - compras: recebe metas por receita e devolve faltas consolidadas
 */
router.get("/relatorios/producao", relatorios.producao);
router.get("/relatorios/alertas", relatorios.alertas);
router.post("/relatorios/compras", relatorios.comprasPorMeta);
router.post("/baixa", movimentos.baixarPorProduto);

module.exports = router;
