// routes/categoriaProdutoRoutes.js
const express = require('express');
const controller = require('../controllers/categoriaProdutoController');

const router = express.Router();

// IMPORTANTE: rotas fixas/específicas precisam vir ANTES de '/:id' e '/:restauranteId'
// Senão '/ordem/reordenar' cai no GET/PUT '/:restauranteId' ou '/:id' e a ordem não salva.
router.put('/ordem/reordenar', controller.atualizarOrdemCategorias);
router.post('/duplicar/:id', controller.duplicarCategoria);
router.put('/:id/ativar', controller.ativarCategoria);
router.put('/:id/desativar', controller.desativarCategoria);

// CRUD principal
router.post('/', controller.createCategoria);
router.get('/:restauranteId', controller.listarCategoriasPorRestaurante);
router.put('/:id', controller.atualizarCategoria);
router.delete('/:id', controller.deletarCategoria);

module.exports = router;
