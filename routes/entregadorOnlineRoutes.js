// routes/entregadorOnlineRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/entregadorOnlineController");

// GET /api/entregadores-online/:restauranteId
router.get("/:restauranteId", controller.listarOnlineHoje);

module.exports = router;
