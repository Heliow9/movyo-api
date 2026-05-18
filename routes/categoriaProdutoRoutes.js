// routes/categoriaProdutoRoutes.js
const express = require('express');
const controller = require('../controllers/categoriaProdutoController');

const router = express.Router();

// CRUD principal
router.post('/', controller.createCategoria);
router.get('/:restauranteId', controller.listarCategoriasPorRestaurante);
router.put('/:id', controller.atualizarCategoria);
router.delete('/:id', controller.deletarCategoria);

// Reordenação (IMPORTANTE: rota mais específica antes de "/:id" se quiser)
router.put('/ordem/reordenar', controller.atualizarOrdemCategorias);

// Duplicação
router.post('/duplicar/:id', controller.duplicarCategoria);

// Ativação / Desativação
router.put('/:id/ativar', controller.ativarCategoria);
router.put('/:id/desativar', controller.desativarCategoria);

module.exports = router;
