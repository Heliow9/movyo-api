// controllers/itensProdutoController.js
const Sabor = require('../models/Sabor');
const Borda = require('../models/Borda');
const Adicional = require('../models/Adicional');
const Complemento = require('../models/Complemento');

const criarItem = (Model) => async (req, res) => {
  try {
    const item = await Model.create(req.body);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar item', details: err.message });
  }
};