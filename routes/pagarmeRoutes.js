const express = require("express");
const router = express.Router();
const { pagarmeWebhook } = require("../controllers/pagarmeController");

// Webhook precisa receber POST da Pagar.me
router.post("/webhook", pagarmeWebhook);

module.exports = router;
