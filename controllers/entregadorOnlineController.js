const EntregadorOnline = require("../models/EntregadorOnline");
const { formatOperationalDateISO } = require("../utils/operationalDateTime");

exports.listarOnlineHoje = async (req, res) => {
  const restauranteId = String(req.restauranteId || req.params.restauranteId || "");
  if (!restauranteId) return res.status(400).json({ erro: "RestauranteId e obrigatorio." });

  try {
    const lista = await EntregadorOnline.find({
      restauranteId,
      dia: formatOperationalDateISO(),
      online: true,
    }).sort({ dataEntrada: 1 });
    return res.json(lista);
  } catch (error) {
    console.error("Erro ao listar motoristas online:", error);
    return res.status(500).json({ erro: "Erro interno ao buscar motoristas online." });
  }
};