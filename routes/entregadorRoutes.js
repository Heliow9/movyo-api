const express = require('express');
const entregadorController = require('../controllers/entregadorController');
const authMotoristas = require('../middlewares/authMotoristas');
const authRestaurante = require('../middlewares/authRestaurante');

module.exports = (io) => {
  const router = express.Router();
  router.post('/login', entregadorController.login);
  // router.use(authRestaurante)
  router.post('/register', entregadorController.register);
  router.post('/atualizar-status', entregadorController.atualizarStatus);
  router.post('/atualizar-localizacao', (req, res) =>
    entregadorController.atualizarLocalizacao(req, res, io)
  );

  router.get("/disponiveis/:restauranteId", entregadorController.listarDisponiveis);
  router.get("/byRestaurante/:restauranteId", entregadorController.listarEntregadores);
  router.delete("/entregadordelete/:id", entregadorController.entregadorDelete)
  router.put("/entregadortrocasenha/:id", entregadorController.entregadorTrocaSenha)
  router.put('/editar/:_id', entregadorController.atualizarEntregador);
  router.put('/token', entregadorController.token);

  return router;
};
