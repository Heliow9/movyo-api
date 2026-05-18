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

  return router;
};
  