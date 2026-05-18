// controllers/entregadorOnlineController.js
const EntregadorOnline = require("../models/EntregadorOnline");
const Entregador = require("../models/Entregador");

exports.listarOnlineHoje = async (req, res) => {
  const { restauranteId } = req.params;

  if (!restauranteId) {
    return res.status(400).json({ erro: "RestauranteId é obrigatório" });
  }

  const hoje = new Date().toISOString().split("T")[0]; // "2025-07-11"

  try {
    const lista = await EntregadorOnline.find({ restauranteId, dia: hoje })
      .populate("entregadorId", "nome email localizacao")
      .sort({ dataEntrada: 1 });

    res.json(lista);
  } catch (err) {
    console.error("❌ Erro ao listar entregadores online:", err);
    res.status(500).json({ erro: "Erro interno ao buscar entregadores online" });
  }
};
