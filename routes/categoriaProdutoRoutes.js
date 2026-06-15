// routes/categoriaProdutoRoutes.js
const express = require('express');
const controller = require('../controllers/categoriaProdutoController');
const authRestaurante = require('../middlewares/authRestaurante');
const matchRestaurante = require('../middlewares/requireRestaurantMatch');

const router = express.Router();

// IMPORTANTE: rotas fixas/específicas precisam vir ANTES de '/:id' e '/:restauranteId'
// Senão '/ordem/reordenar' cai no GET/PUT '/:restauranteId' ou '/:id' e a ordem não salva.
router.put('/ordem/reordenar', authRestaurante, matchRestaurante, controller.atualizarOrdemCategorias);
router.post('/duplicar/:id', authRestaurante, matchRestaurante, controller.duplicarCategoria);
router.put('/:id/ativar', authRestaurante, matchRestaurante, controller.ativarCategoria);
router.put('/:id/desativar', authRestaurante, matchRestaurante, controller.desativarCategoria);

// CRUD principal
router.post('/', authRestaurante, matchRestaurante, controller.createCategoria);
router.get('/:restauranteId', controller.listarCategoriasPorRestaurante);
router.put('/:id', authRestaurante, matchRestaurante, controller.atualizarCategoria);
router.delete('/:id', authRestaurante, matchRestaurante, controller.deletarCategoria);

module.exports = router;
