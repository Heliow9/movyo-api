// routes/food99Routes.js
const express = require('express');
const authRestaurante = require('../middlewares/authRestaurante');
const food99 = require('../controllers/food99Controller');

module.exports = function buildFood99Routes() {
  const router = express.Router();

  router.get('/ping', (_req, res) => res.json({ ok: true, provider: '99food' }));

  // Webhook público usado pela 99Food/Open Delivery para enviar pedidos ao Movyo.
  router.post('/webhook', food99.webhook);

  // Utilitários autenticados para validar configuração dentro do desktop.
  router.get('/status', authRestaurante, food99.status);
  router.post('/pedido-teste', authRestaurante, food99.criarPedidoTeste);

  return router;
};
