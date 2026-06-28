const express = require("express");
const router = express.Router();
const controller = require("../controllers/vitrineController");
const rateLimitPublico = require("../middlewares/rateLimitPublico");

router.get("/cardapio/:slug", rateLimitPublico({ prefix: "vitrine-cardapio", max: 180 }), controller.cardapioPorSlug);
router.get("/checkout-config/:restauranteId", rateLimitPublico({ prefix: "vitrine-checkout", max: 120 }), controller.checkoutConfig);

module.exports = router;
