const express = require("express");
const entregadorController = require("../controllers/entregadorController");
const appController = require("../controllers/entregadorAppController");
const authMotoristas = require("../middlewares/authMotoristas");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");
const uploadDeliveryProof = require("../middlewares/uploadDeliveryProof");
const { requirePlanFeature } = require("../middlewares/requirePlanFeature");

module.exports = (io) => {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.io = io;
    next();
  });

  router.post("/login", entregadorController.login);

  // Aplicativo do motorista: identidade sempre vem do JWT, nunca do body.
  router.get("/me", authMotoristas, appController.me);
  router.get("/me/entregas", authMotoristas, appController.estado);
  router.get("/me/resumo-dia", authMotoristas, appController.resumoDia);
  router.post("/me/status", authMotoristas, appController.status);
  router.post("/me/localizacao", authMotoristas, appController.localizacao);
  router.put("/me/token", authMotoristas, appController.token);
  router.post("/me/pedidos/:pedidoId/aceitar", authMotoristas, appController.aceitar);
  router.post("/me/pedidos/:pedidoId/recusar", authMotoristas, appController.recusar);
  router.post("/me/pedidos/:pedidoId/iniciar", authMotoristas, appController.iniciar);
  router.post("/me/pedidos/:pedidoId/ocorrencias", authMotoristas, appController.ocorrencia);
  router.post(
    "/me/pedidos/:pedidoId/concluir",
    authMotoristas,
    uploadDeliveryProof.single("foto"),
    appController.concluir
  );

  // Compatibilidade com builds anteriores do Motorista, agora protegida.
  router.post("/atualizar-status", authMotoristas, appController.status);
  router.post("/atualizar-localizacao", authMotoristas, appController.localizacao);
  router.put("/token", authMotoristas, appController.token);

  // Administracao de motoristas pelo restaurante/desktop.
  router.post(
    "/register",
    authRestaurante,
    matchRestaurante,
    requirePlanFeature("driversApp"),
    entregadorController.register
  );
  router.get(
    "/disponiveis/:restauranteId",
    authRestaurante,
    matchRestaurante,
    requirePlanFeature("deliveryManagement"),
    entregadorController.listarDisponiveis
  );
  router.get(
    "/byRestaurante/:restauranteId",
    authRestaurante,
    matchRestaurante,
    requirePlanFeature("deliveryManagement"),
    entregadorController.listarEntregadores
  );
  router.delete(
    "/entregadordelete/:id",
    authRestaurante,
    requirePlanFeature("driversApp"),
    entregadorController.entregadorDelete
  );
  router.put(
    "/entregadortrocasenha/:id",
    authRestaurante,
    requirePlanFeature("driversApp"),
    entregadorController.entregadorTrocaSenha
  );
  router.put(
    "/editar/:_id",
    authRestaurante,
    requirePlanFeature("driversApp"),
    entregadorController.atualizarEntregador
  );

  return router;
};