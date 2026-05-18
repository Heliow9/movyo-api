// controllers/estoque/movimentos.controller.js
const Produto = require("../../models/Produto");
const Receita = require("../../models/Receita");
const Insumo = require("../../models/Insumo");

// -------------------------------------
// Helpers
// -------------------------------------
function baseFromUnidade(unidade) {
  if (unidade === "g" || unidade === "kg") return "kg";
  if (unidade === "ml" || unidade === "l") return "l";
  if (unidade === "un") return "un";
  return unidade;
}

function toBase(qtd, unidade) {
  const n = Number(qtd || 0);
  if (unidade === "g") return { base: "kg", value: n / 1000 };
  if (unidade === "kg") return { base: "kg", value: n };
  if (unidade === "ml") return { base: "l", value: n / 1000 };
  if (unidade === "l") return { base: "l", value: n };
  if (unidade === "un") return { base: "un", value: n };
  return { base: unidade, value: n };
}

// baixa uma receita N vezes
async function baixarReceita(receitaId, mult) {
  const receita = await Receita.findById(receitaId).lean();
  if (!receita) throw new Error("Receita não encontrada.");

  const itens = Array.isArray(receita.itens)
    ? receita.itens
    : Array.isArray(receita.items)
    ? receita.items
    : [];

  if (!itens.length) return;

  const insumoIds = itens.map((x) => x.insumoId || x.insumo).filter(Boolean);
  const insumos = await Insumo.find({ _id: { $in: insumoIds } });
  const insumoMap = new Map(insumos.map((i) => [String(i._id), i]));

  // valida
  for (const it of itens) {
    const insumoId = String(it.insumoId || it.insumo);
    const ins = insumoMap.get(insumoId);
    if (!ins) continue;

    const qtd = Number(it.qtd ?? it.consumoBasePorUn ?? it.insumoBasePorUn ?? 0);
    const unidade = it.unidade || it.baseUnit || "g";

    const consumoBase = toBase(qtd, unidade);
    const baseInsumo = baseFromUnidade(ins.unidadePadrao || ins.baseUnit);

    if (consumoBase.base !== baseInsumo) {
      throw new Error(`Unidade incompatível na receita (${ins.nome}).`);
    }

    const total = consumoBase.value * Number(mult || 1);
    if ((ins.quantidadeBase || 0) - total < 0) {
      throw new Error(`Estoque insuficiente para ${ins.nome}.`);
    }
  }

  // baixa
  for (const it of itens) {
    const insumoId = String(it.insumoId || it.insumo);
    const ins = insumoMap.get(insumoId);
    if (!ins) continue;

    const qtd = Number(it.qtd ?? it.consumoBasePorUn ?? it.insumoBasePorUn ?? 0);
    const unidade = it.unidade || it.baseUnit || "g";
    const consumoBase = toBase(qtd, unidade);

    const total = consumoBase.value * Number(mult || 1);

    await Insumo.updateOne(
      { _id: ins._id },
      { $inc: { quantidadeBase: -Math.abs(total) } }
    );
  }
}

// -------------------------------------
// ✅ Handlers que sua rota espera (não pode faltar)
// -------------------------------------

// GET /insumos/:id/movimentos
exports.listarPorInsumo = async (req, res) => {
  // Se você já tem model Movimento, substitui por query nele.
  // Por enquanto, só pra não quebrar:
  return res.json({ data: [] });
};

// POST /insumos/:id/movimentos  (compra/ajuste manual)
exports.criarMovimentoManual = async (req, res) => {
  // Aqui você implementa compra/ajuste manual e grava movimento.
  // Por enquanto, stub seguro:
  return res.json({ ok: true, mensagem: "Movimento manual ainda não implementado." });
};

// POST /baixa
exports.baixarPorProduto = async (req, res) => {
  try {
    const { produtoId, quantidade, opcionais } = req.body;
    const q = Math.max(1, Math.floor(Number(quantidade || 1)));

    const produto = await Produto.findById(produtoId).lean();
    if (!produto) return res.status(404).json({ mensagem: "Produto não encontrado." });

    // 1) baixa receita principal
    if (produto.receita) {
      await baixarReceita(produto.receita, q);
    }

    // 2) baixa opcionais selecionados (se o campo existir no model)
    const ops = Array.isArray(opcionais) ? opcionais : [];
    for (const key of ops) {
      const vinc = produto.estoqueOpcionais?.get
        ? produto.estoqueOpcionais.get(key)
        : produto.estoqueOpcionais?.[key];

      if (!vinc) continue;

      if (vinc.receita) {
        await baixarReceita(vinc.receita, q);
        continue;
      }

      if (vinc.insumo && vinc.qtd > 0) {
        const ins = await Insumo.findById(vinc.insumo);
        if (!ins) continue;

        const consumoBase = toBase(vinc.qtd, vinc.unidade || "un");
        const baseInsumo = baseFromUnidade(ins.unidadePadrao || ins.baseUnit);

        if (consumoBase.base !== baseInsumo) {
          throw new Error(`Unidade incompatível no opcional (${key}).`);
        }

        const total = consumoBase.value * q;
        if ((ins.quantidadeBase || 0) - total < 0) {
          throw new Error(`Estoque insuficiente para ${ins.nome} (opcional ${key}).`);
        }

        await Insumo.updateOne(
          { _id: ins._id },
          { $inc: { quantidadeBase: -Math.abs(total) } }
        );
      }
    }

    return res.json({ ok: true, mensagem: "Baixa realizada com sucesso." });
  } catch (err) {
    return res.status(400).json({ ok: false, mensagem: err?.message || "Erro ao baixar estoque." });
  }
};
