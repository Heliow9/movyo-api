const express = require('express');
const router = express.Router();
const enderecoController = require('../controllers/enderecoController');

router.get('/cep/:cep', enderecoController.buscarCep);
router.get('/cep', enderecoController.buscarCep);

module.exports = router;
