const express = require("express");
const controller = require("../controllers/produtoExtrasController");

const router = express.Router();

router.post("/sabores", controller.criarSabor);
router.get("/sabores/:produtoId", controller.listarSabores);

router.post("/bordas", controller.criarBorda);
router.get("/bordas/:produtoId", controller.listarBordas);

router.post("/adicionais", controller.criarAdicional);
router.get("/adicionais/:produtoId", controller.listarAdicionais);

router.post("/complementos", controller.criarComplemento);
router.get("/complementos/:produtoId", controller.listarComplementos);

module.exports = router;
