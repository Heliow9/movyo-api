const express = require("express");
const router = express.Router();
const mp = require("../controllers/mercadoPagoController");
const authRestaurante = require('../middlewares/authRestaurante');
router.get("/oauth/start/:restauranteId", mp.startOAuth);
router.get("/oauth/callback", mp.callbackOAuth);
router.get("/status/:restauranteId", mp.statusById);
router.post("/disconnect", authRestaurante, mp.disconnect);
module.exports = router;
