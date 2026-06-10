// controllers/freteController.js
const Frete = require("../models/Frete");
const Restaurante = require("../models/Restaurante");

function toMoneyNumber(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, Number(n.toFixed(2))) : 0;
}

function normalizarFaixasRaio(faixas = []) {
  return (Array.isArray(faixas) ? faixas : [])
    .map((f) => ({
      ate: Number(String(f?.ate ?? f?.raio ?? f?.km ?? "").replace(",", ".")),
      valor: toMoneyNumber(f?.valor ?? f?.preco ?? f?.taxa),
    }))
    .filter((f) => Number.isFinite(f.ate) && f.ate > 0)
    .sort((a, b) => a.ate - b.ate);
}

function normalizarAreas(areas = []) {
  return (Array.isArray(areas) ? areas : []).map((area) => ({
    ...area,
    valor: toMoneyNumber(area?.valor),
  }));
}

// Salvar configurações de frete (tanto por área quanto por raio)
// MESMA rota usada pelos dois componentes:
// - FretePorRaio  => envia { faixasRaio, tipo: 'raio' }
// - FretePorArea  => envia { areas, tipo: 'area' }
exports.salvarAreas = async (req, res) => {
  const { restauranteId } = req.params;
  const { areas, faixasRaio, tipo } = req.body;

  try {
    let frete = await Frete.findOne({ restaurante: restauranteId });

    if (frete) {
      // 👉 Só atualiza o que veio no body (não zera o resto!)

      if (Array.isArray(areas)) {
        frete.areas = normalizarAreas(areas);
      }

      if (Array.isArray(faixasRaio)) {
        frete.faixasRaio = normalizarFaixasRaio(faixasRaio);
      }

      if (tipo === "raio" || tipo === "area") {
        frete.tipo = tipo; // modo "padrão" exibido na tela
      }

      await frete.save();
    } else {
      // 👉 Se ainda não existir doc de frete, cria com o que tiver
      frete = new Frete({
        restaurante: restauranteId,
        tipo: (tipo === "raio" || tipo === "area") ? tipo : "raio",
        faixasRaio: Array.isArray(faixasRaio) ? normalizarFaixasRaio(faixasRaio) : [],
        areas: Array.isArray(areas) ? normalizarAreas(areas) : [],
      });
      await frete.save();
    }

    return res
      .status(200)
      .json({ success: true, message: "Frete salvo com sucesso.", frete });
  } catch (err) {
    console.error("Erro ao salvar frete:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao salvar frete." });
  }
};

// GET retorna todas as áreas/faixas/tipo de um restaurante
exports.listarAreas = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const frete = await Frete.findOne({ restaurante: restauranteId });

    if (!frete) {
      // compatibilidade com o front:
      // Frete.jsx faz: if (Array.isArray(data)) ...
      return res.status(404).json([]);
    }

    // frete já contém { tipo, faixasRaio, areas }
    return res.json(frete);
  } catch (err) {
    console.error("Erro ao listar áreas de frete:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao buscar áreas." });
  }
};

// PUT atualiza uma área específica (por índice)
exports.atualizarArea = async (req, res) => {
  const { restauranteId, index } = req.params;
  const { nome, valor } = req.body;

  try {
    const frete = await Frete.findOne({ restaurante: restauranteId });
    if (!frete) {
      return res
        .status(404)
        .json({ success: false, message: "Frete não encontrado" });
    }

    if (!Array.isArray(frete.areas)) {
      frete.areas = [];
    }

    const idx = Number(index);
    if (Number.isNaN(idx) || !frete.areas[idx]) {
      return res
        .status(404)
        .json({ success: false, message: "Área não encontrada" });
    }

    frete.areas[idx].nome = nome;
    frete.areas[idx].valor = valor;

    await frete.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao atualizar área:", err);
    return res.status(500).json({ success: false });
  }
};

// DELETE remove uma área específica (por índice)
exports.deletarArea = async (req, res) => {
  const { restauranteId, index } = req.params;

  try {
    const frete = await Frete.findOne({ restaurante: restauranteId });
    if (!frete) {
      return res
        .status(404)
        .json({ success: false, message: "Frete não encontrado" });
    }

    if (!Array.isArray(frete.areas)) {
      frete.areas = [];
    }

    const idx = Number(index);
    if (Number.isNaN(idx) || !frete.areas[idx]) {
      return res
        .status(404)
        .json({ success: false, message: "Área não encontrada" });
    }

    frete.areas.splice(idx, 1);
    await frete.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao deletar área:", err);
    return res.status(500).json({ success: false });
  }
};

// Dados de frete para o checkout: áreas + faixas + localização do restaurante
exports.obterDadosFrete = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const frete = await Frete.findOne({ restaurante: restauranteId }).lean();
    const restaurante = await Restaurante.findById(restauranteId).lean();

    if (!restaurante) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurante não encontrado." });
    }

    // Se ainda não existir doc de frete, devolve padrão vazio,
    // mas com localização do restaurante pra calcular raio
    if (!frete) {
      return res.json({
        tipo: "raio",
        faixasRaio: [],
        areas: [],
        localizacaoRestaurante: restaurante.localizacao,
      });
    }

    return res.json({
      tipo: frete.tipo || "raio",
      faixasRaio: Array.isArray(frete.faixasRaio) ? frete.faixasRaio : [],
      areas: Array.isArray(frete.areas) ? frete.areas : [],
      localizacaoRestaurante: restaurante.localizacao,
    });
  } catch (err) {
    console.error("Erro ao obter dados de frete:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar dados de frete.",
    });
  }
};
