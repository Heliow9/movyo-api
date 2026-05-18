const Receita = require("../../models/Receita");
const Insumo = require("../../models/Insumo");
const { toBase } = require("../../utils/unidades");

// garante "kg/l/un"
function normalizeBaseUnit(u) {
  if (u === "kg") return "kg";
  if (u === "l") return "l";
  if (u === "un") return "un";
  return null;
}

exports.listar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const q = (req.query.q || "").trim();

    const filter = { restauranteId, ativo: true };
    if (q) filter.nome = { $regex: q, $options: "i" };

    const docs = await Receita.find(filter).sort({ nome: 1 });
    return res.json(docs);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao listar receitas.", error: e.message });
  }
};

exports.obter = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Receita.findOne({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Receita não encontrada." });
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ message: "Erro ao obter receita.", error: e.message });
  }
};

exports.criar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;

    const nome = String(req.body.nome || "").trim();
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];

    if (!nome) return res.status(400).json({ message: "Nome é obrigatório." });

    const insumoIds = itens.map((x) => x.insumoId).filter(Boolean);
    const insumos = await Insumo.find({ _id: { $in: insumoIds }, restauranteId });
    const map = new Map(insumos.map((i) => [String(i._id), i]));

    const itensNorm = [];
    for (const it of itens) {
      const ins = map.get(String(it.insumoId));
      if (!ins) continue;

      const qtd = Number(it.qtd || 0);
      if (!qtd || qtd <= 0) continue;

      const conv = toBase(qtd, String(it.unidade || "").trim());
      const insBase = normalizeBaseUnit(ins.baseUnit);
      if (!insBase) return res.status(400).json({ message: `Insumo inválido (${ins.nome}).` });

      if (conv.base !== insBase) {
        return res.status(400).json({
          message: `Unidade incompatível com o insumo ${ins.nome}. (Receita: ${conv.base} vs Insumo: ${insBase})`,
        });
      }

      itensNorm.push({
        insumoId: ins._id,
        baseUnit: insBase,
        consumoBasePorUn: conv.value,
      });
    }

    if (!itensNorm.length) {
      return res.status(400).json({ message: "Adicione ao menos 1 insumo válido." });
    }

    const doc = await Receita.create({
      restauranteId,
      nome,
      itens: itensNorm,
      ativo: req.body.ativo !== false,
    });

    return res.status(201).json(doc);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Já existe uma receita com esse nome." });
    }
    return res.status(500).json({ message: "Erro ao criar receita.", error: e.message });
  }
};

exports.atualizar = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Receita.findOne({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Receita não encontrada." });

    if (typeof req.body.nome !== "undefined") {
      const nome = String(req.body.nome || "").trim();
      if (!nome) return res.status(400).json({ message: "Nome inválido." });
      doc.nome = nome;
    }

    if (typeof req.body.itens !== "undefined") {
      const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
      const insumoIds = itens.map((x) => x.insumoId).filter(Boolean);
      const insumos = await Insumo.find({ _id: { $in: insumoIds }, restauranteId });
      const map = new Map(insumos.map((i) => [String(i._id), i]));

      const itensNorm = [];
      for (const it of itens) {
        const ins = map.get(String(it.insumoId));
        if (!ins) continue;

        const qtd = Number(it.qtd || 0);
        if (!qtd || qtd <= 0) continue;

        const conv = toBase(qtd, String(it.unidade || "").trim());
        const insBase = normalizeBaseUnit(ins.baseUnit);
        if (conv.base !== insBase) {
          return res.status(400).json({
            message: `Unidade incompatível com o insumo ${ins.nome}.`,
          });
        }

        itensNorm.push({
          insumoId: ins._id,
          baseUnit: insBase,
          consumoBasePorUn: conv.value,
        });
      }

      if (!itensNorm.length) return res.status(400).json({ message: "Adicione ao menos 1 insumo válido." });
      doc.itens = itensNorm;
    }

    if (typeof req.body.ativo !== "undefined") doc.ativo = req.body.ativo !== false;

    await doc.save();
    return res.json(doc);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Já existe uma receita com esse nome." });
    }
    return res.status(500).json({ message: "Erro ao atualizar receita.", error: e.message });
  }
};

exports.remover = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const doc = await Receita.findOneAndDelete({ _id: req.params.id, restauranteId });
    if (!doc) return res.status(404).json({ message: "Receita não encontrada." });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Erro ao remover receita.", error: e.message });
  }
};
