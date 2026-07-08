// routes/ifoodRoutes.js
const express = require("express");
const authRestaurante = require("../middlewares/authRestaurante");
const ifood = require("../controllers/ifoodController");

module.exports = function buildIfoodRoutes({ enqueueEvent } = {}) {
  const router = express.Router();

  if (typeof enqueueEvent === "function") {
    router.use((req, _res, next) => {
      req.enqueueIfoodEvent = enqueueEvent;
      next();
    });
  }

  router.get("/ping", (_req, res) => res.json({ ok: true }));

  // OAuth
  router.get("/connect-url", authRestaurante, ifood.startOAuth);
  router.get("/oauth/callback", ifood.callbackOAuth);
  router.get("/status", authRestaurante, ifood.status);
  router.post("/user-code", authRestaurante, ifood.requestUserCode);
  router.post("/complete", authRestaurante, ifood.completeAuthorization);
  router.post("/disconnect", authRestaurante, ifood.disconnect);
  router.post("/pedido-teste", authRestaurante, ifood.criarPedidoTeste);

  // Webhook publico configurado no Developer Portal do iFood.
  router.post("/webhook", ifood.webhook);

  return router;
};
