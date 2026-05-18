// routes/freteRoutes.js
const express = require('express');
const router = express.Router();
const freteController = require('../controllers/freteController');

// POST salva todas as áreas de frete (substitui existentes)
router.post('/area/:restauranteId', freteController.salvarAreas);

// GET retorna todas as áreas de um restaurante
router.get('/area/:restauranteId', freteController.listarAreas);

// PUT atualiza uma área específica (por índice)
router.put('/area/:restauranteId/:index', freteController.atualizarArea);

// DELETE remove uma área específica (por índice)
router.delete('/area/:restauranteId/:index', freteController.deletarArea);

router.get('/dados/:restauranteId', freteController.obterDadosFrete);

module.exports = router;
