// routes/mercadoPagoWebhookRoutes.js
const express = require("express");
const router = express.Router();

const { mpWebhook } = require("../controllers/mercadoPagoWebhookController");

// Mercado Pago recomenda POST
router.post("/mercadopago/webhook", mpWebhook);

module.exports = router;
