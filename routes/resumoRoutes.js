const express = require("express");
const authRestaurante = require("../middlewares/authRestaurante");
const resumoController = require("../controllers/resumoController");

const router = express.Router();
router.use(authRestaurante);
router.get("/:restauranteId", resumoController.obter);

module.exports = router;
