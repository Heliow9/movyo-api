const Receita = require("../../models/Receita");
const Insumo = require("../../models/Insumo");

function calcProducaoMaxima(receita, insumoMap) {
  if (!receita?.itens?.length) return { max: 0, gargalo: null, motivo: "sem_itens", detalhes: [] };

  const detalhes = [];

  for (const it of receita.itens) {
    const ins = insumoMap.get(String(it.insumoId));
    if (!ins) continue;

    // consumoBasePorUn já está na baseUnit do insumo
    const consumo = Number(it.consumoBasePorUn || 0);
    if (!consumo || consumo <= 0) continue;

    const maxPorInsumo = Math.floor(ins.quantidadeBase / consumo);

    detalhes.push({
      insumoId: ins._id,
      insumoNome: ins.nome,
      baseUnit: ins.baseUnit,
      consumoBasePorUn: consumo,
      estoqueBase: ins.quantidadeBase,
      maxPorInsumo,
    });
  }

  if (!detalhes.length) return { max: 0, gargalo: null, motivo: "sem_detalhes", detalhes: [] };

  detalhes.sort((a, b) => a.maxPorInsumo - b.maxPorInsumo);
  const gargalo = detalhes[0];

  return { max: Math.max(0, gargalo.maxPorInsumo), gargalo, motivo: "ok", detalhes };
}

exports.producao = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;

    const receitas = await Receita.find({ restauranteId, ativo: true }).lean();
    const insumos = await Insumo.find({ restauranteId, ativo: true }).lean();
    const insumoMap = new Map(insumos.map((i) => [String(i._id), i]));

    const out = receitas.map((r) => {
      const calc = calcProducaoMaxima(r, insumoMap);
      return {
        receitaId: r._id,
        nome: r.nome,
        produzAte: calc.max,
        motivo: calc.motivo,
        gargalo: calc.gargalo
          ? { insumoId: calc.gargalo.insumoId, nome: calc.gargalo.insumoNome, maxPorInsumo: calc.gargalo.maxPorInsumo }
          : null,
        detalhes: calc.detalhes,
      };
    });

    // opcional: ordenar pelo menor produzAte (mais crítico primeiro)
    out.sort((a, b) => (a.produzAte ?? 0) - (b.produzAte ?? 0));

    return res.json(out);
  } catch (e) {
    return res.status(500).json({ message: "Erro no relatório de produção.", error: e.message });
  }
};

exports.alertas = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const insumos = await Insumo.find({ restauranteId, ativo: true }).lean();

    const abaixo = insumos
      .filter((i) => Number(i.quantidadeBase) <= Number(i.minimoBase))
      .sort((a, b) => (a.quantidadeBase ?? 0) - (b.quantidadeBase ?? 0));

    return res.json({ abaixoMinimo: abaixo });
  } catch (e) {
    return res.status(500).json({ message: "Erro no relatório de alertas.", error: e.message });
  }
};

/**
 * POST /relatorios/compras
 * Body:
 * {
 *   "metas": [
 *     { "receitaId": "...", "qtd": 100 },
 *     { "receitaId": "...", "qtd": 50 }
 *   ]
 * }
 */
exports.comprasPorMeta = async (req, res) => {
  try {
    const restauranteId = req.restauranteId;
    const metas = Array.isArray(req.body.metas) ? req.body.metas : [];

    const receitaIds = metas.map((m) => m.receitaId).filter(Boolean);
    const receitas = await Receita.find({ restauranteId, _id: { $in: receitaIds }, ativo: true }).lean();

    const insumos = await Insumo.find({ restauranteId, ativo: true }).lean();
    const insumoMap = new Map(insumos.map((i) => [String(i._id), i]));

    // faltas consolidadas em baseUnit do insumo
    const faltaPorInsumo = new Map(); // insumoId -> faltaBase

    for (const r of receitas) {
      const meta = metas.find((m) => String(m.receitaId) === String(r._id));
      const qtd = Math.max(0, Math.floor(Number(meta?.qtd || 0)));
      if (!qtd) continue;

      for (const it of r.itens || []) {
        const ins = insumoMap.get(String(it.insumoId));
        if (!ins) continue;

        const consumoTotal = Number(it.consumoBasePorUn || 0) * qtd;
        const falta = Math.max(0, consumoTotal - Number(ins.quantidadeBase || 0));

        if (falta > 0) {
          const key = String(ins._id);
          faltaPorInsumo.set(key, (faltaPorInsumo.get(key) || 0) + falta);
        }
      }
    }

    const consolidado = [];
    for (const [insumoId, faltaBase] of faltaPorInsumo.entries()) {
      const ins = insumoMap.get(insumoId);
      if (!ins) continue;
      consolidado.push({
        insumoId: ins._id,
        nome: ins.nome,
        baseUnit: ins.baseUnit,
        faltaBase,
      });
    }

    consolidado.sort((a, b) => (b.faltaBase ?? 0) - (a.faltaBase ?? 0));

    return res.json({ consolidado });
  } catch (e) {
    return res.status(500).json({ message: "Erro no relatório de compras.", error: e.message });
  }
};
