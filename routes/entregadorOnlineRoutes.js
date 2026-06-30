const express = require("express");
const controller = require("../controllers/entregadorOnlineController");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");
const { requirePlanFeature } = require("../middlewares/requirePlanFeature");

const router = express.Router();
router.get(
  "/:restauranteId",
  authRestaurante,
  matchRestaurante,
  requirePlanFeature("deliveryManagement"),
  controller.listarOnlineHoje
);
module.exports = router;