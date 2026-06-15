const express = require("express");
const controller = require("../controllers/produtoExtrasController");
const authRestaurante = require("../middlewares/authRestaurante");

const router = express.Router();

router.post("/sabores", authRestaurante, controller.criarSabor);
router.get("/sabores/:produtoId", controller.listarSabores);

router.post("/bordas", authRestaurante, controller.criarBorda);
router.get("/bordas/:produtoId", controller.listarBordas);

router.post("/adicionais", authRestaurante, controller.criarAdicional);
router.get("/adicionais/:produtoId", controller.listarAdicionais);

router.post("/complementos", authRestaurante, controller.criarComplemento);
router.get("/complementos/:produtoId", controller.listarComplementos);

module.exports = router;
