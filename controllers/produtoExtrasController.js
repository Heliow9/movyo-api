const Sabor = require("../models/Sabor");
const Borda = require("../models/Borda");
const Adicional = require("../models/Adicional");
const Complemento = require("../models/Complemento");

const create = async (Model, data, res) => {
  try {
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Erro ao criar item", details: err.message });
  }
};

const listByProduto = async (Model, req, res) => {
  try {
    const itens = await Model.find({ produto: req.params.produtoId });
    res.json(itens);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar itens", details: err.message });
  }
};

module.exports = {
  criarSabor: (req, res) => create(Sabor, req.body, res),
  listarSabores: (req, res) => listByProduto(Sabor, req, res),

  criarBorda: (req, res) => create(Borda, req.body, res),
  listarBordas: (req, res) => listByProduto(Borda, req, res),

  criarAdicional: (req, res) => create(Adicional, req.body, res),
  listarAdicionais: (req, res) => listByProduto(Adicional, req, res),

  criarComplemento: (req, res) => create(Complemento, req.body, res),
  listarComplementos: (req, res) => listByProduto(Complemento, req, res),
};
