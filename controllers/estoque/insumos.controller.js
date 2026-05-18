const Insumo = require("../../models/Insumo");

// -----------------------------
// Helpers
// -----------------------------
function baseUnitFromUnidadePadrao(u) {
  if (u === "kg" || u === "g") return "kg";
  if (u === "l" || u === "ml") return "l";
  if (u === "un") return "un";
  return null;
}

// preço por 1 unidade informada -> custo por 1 unidade BASE (kg/l/un)
function costBaseFromPrice(preco, unidadePreco, unidadePadraoInsumo) {
  const base = baseUnitFromUnidadePadrao(unidadePadraoInsumo);
  if (!base) return { ok: false, msg: "Unidade inválida." };

  const p = Number(preco);
  if (Number.isNaN(p) || p < 0) return { ok: false, msg: "Preço inválido." };
  if (p === 0) return { ok: true, costBase: 0 };

  // base kg: aceita kg ou g
  if (base === "kg") {
    if (unidadePreco === "kg") return { ok: true, costBase: p };
    if (unidadePreco === "g") return { ok: true, costBase: p / 0.001 }; // R$/g => R$/kg
    return { ok: false, msg: "Unidade do preço incompatível com base kg." };
  }

  // base l: aceita l ou ml
  if (base === "l") {
    if (unidadePreco === "l") return { ok: true, costBase: p };
    if (unidadePreco === "ml") return { ok: true, costBase: p / 0.001 }; // R$/ml => R$/l
    return { ok: false, msg: "Unidade do preço incompatível com base l." };
  }

  // base un: aceita un
  if (base === "un") {
    if (unidadePreco === "un") return { ok: true, costBase: p };
    return { ok: false, msg: "Unidade do preço incompatível com base un." };
  }

  return { ok: false, msg: "Conversão inválida." };
}

function pickMessage(e, fallback) {
  return e?.response?.data?.message || e?.message || fallback;
}

// -----------------------------
// Controllers
// -----------------------------
exports.listar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const q = (req.query.q || "").trim();
    const ativo = req.query.ativo;

    const filter = { restauranteId };
    if (typeof ativo !== "undefined") filter.ativo = ativo === "true";
    if (q) filter.nome = { $regex: q, $options: "i" };

    const docs = await Insumo.find(filter).sort({ nome: 1 });
    return res.json(docs);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar insumos.", error: e.message });
  }
};

exports.obter = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Insumo.findOne({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Insumo não encontrado." });
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao obter insumo.", error: e.message });
  }
};

exports.criar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;

    const nome = String(req.body.nome || "").trim();
    const unidadePadrao = String(req.body.unidadePadrao || "").trim(); // kg|g|l|ml|un
    const quantidadeBase = Number(req.body.quantidadeBase ?? 0);
    const minimoBase = Number(req.body.minimoBase ?? 0);

    if (!nome) return res.status(400).json({ message: "Nome é obrigatório." });

    const baseUnit = baseUnitFromUnidadePadrao(unidadePadrao);
    if (!baseUnit) return res.status(400).json({ message: "Unidade inválida." });

    if (Number.isNaN(quantidadeBase) || quantidadeBase < 0) {
      return res.status(400).json({ message: "quantidadeBase inválida." });
    }

    if (Number.isNaN(minimoBase) || minimoBase < 0) {
      return res.status(400).json({ message: "minimoBase inválido." });
    }

    // ✅ custo: aceita direto costBase OU aceita (preco, precoUnidade)
    let costBase = 0;

    if (typeof req.body.costBase !== "undefined") {
      const v = Number(req.body.costBase);
      if (Number.isNaN(v) || v < 0) return res.status(400).json({ message: "costBase inválido." });
      costBase = v;
    } else if (typeof req.body.preco !== "undefined" && typeof req.body.precoUnidade !== "undefined") {
      const conv = costBaseFromPrice(req.body.preco, String(req.body.precoUnidade || "").trim(), unidadePadrao);
      if (!conv.ok) return res.status(400).json({ message: conv.msg });
      costBase = conv.costBase;
    }

    const doc = await Insumo.create({
      restauranteId,
      nome,
      unidadePadrao, // ✅ salva pra UI
      baseUnit,      // ✅ salva pra cálculo
      quantidadeBase,
      minimoBase,
      costBase,      // ✅ custo por base
      estoqueAtualBase: quantidadeBase,
      estoqueMinimoBase: minimoBase,
      custoMedioBase: costBase,
      ativo: req.body.ativo !== false,
    });

    return res.status(201).json(doc);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Já existe um insumo com esse nome." });
    }
    return res.status(500).json({ message: "Erro ao criar insumo.", error: e.message });
  }
};

exports.atualizar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Insumo.findOne({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Insumo não encontrado." });

    if (typeof req.body.nome !== "undefined") {
      const nome = String(req.body.nome || "").trim();
      if (!nome) return res.status(400).json({ message: "Nome inválido." });
      doc.nome = nome;
    }

    // ✅ atualiza unidadePadrao e recalcula baseUnit
    if (typeof req.body.unidadePadrao !== "undefined") {
      const unidadePadrao = String(req.body.unidadePadrao || "").trim();
      const baseUnit = baseUnitFromUnidadePadrao(unidadePadrao);
      if (!baseUnit) return res.status(400).json({ message: "Unidade inválida." });

      doc.unidadePadrao = unidadePadrao;
      doc.baseUnit = baseUnit;
    }

    if (typeof req.body.quantidadeBase !== "undefined") {
      const v = Number(req.body.quantidadeBase);
      if (Number.isNaN(v) || v < 0) return res.status(400).json({ message: "quantidadeBase inválida." });
      doc.quantidadeBase = v;
      doc.estoqueAtualBase = v;
    }

    if (typeof req.body.minimoBase !== "undefined") {
      const v = Number(req.body.minimoBase);
      if (Number.isNaN(v) || v < 0) return res.status(400).json({ message: "minimoBase inválido." });
      doc.minimoBase = v;
      doc.estoqueMinimoBase = v;
    }

    // ✅ custo: aceita direto costBase OU aceita (preco, precoUnidade)
    if (typeof req.body.costBase !== "undefined") {
      const v = Number(req.body.costBase);
      if (Number.isNaN(v) || v < 0) return res.status(400).json({ message: "costBase inválido." });
      doc.costBase = v;
      doc.custoMedioBase = v;
    } else if (typeof req.body.preco !== "undefined" && typeof req.body.precoUnidade !== "undefined") {
      const conv = costBaseFromPrice(req.body.preco, String(req.body.precoUnidade || "").trim(), doc.unidadePadrao);
      if (!conv.ok) return res.status(400).json({ message: conv.msg });
      doc.costBase = conv.costBase;
      doc.custoMedioBase = conv.costBase;
    }

    if (typeof req.body.ativo !== "undefined") {
      doc.ativo = req.body.ativo !== false;
    }

    await doc.save();
    return res.json(doc);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Já existe um insumo com esse nome." });
    }
    return res.status(500).json({ message: "Erro ao atualizar insumo.", error: e.message });
  }
};

exports.remover = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Insumo.findOneAndDelete({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Insumo não encontrado." });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao remover insumo.", error: e.message });
  }
};
