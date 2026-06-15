const express = require('express');
const router = express.Router();
const authRestaurante = require('../middlewares/authRestaurante');
const controller = require('../controllers/auditoriaController');
router.get('/', authRestaurante, controller.listar);
module.exports = router;
