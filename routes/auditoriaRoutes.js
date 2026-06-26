const express = require('express');
const router = express.Router();
const authRestaurante = require('../middlewares/authRestaurante');
const { requirePlanFeature } = require('../middlewares/requirePlanFeature');
const controller = require('../controllers/auditoriaController');
router.get('/', authRestaurante, requirePlanFeature('audit'), controller.listar);
module.exports = router;
