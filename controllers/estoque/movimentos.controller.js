const crypto = require("crypto");
const Insumo = require("../../models/Insumo");
const MovimentoEstoque = require("../../models/MovimentoEstoque");
const { baixarEstoquePorPedido } = require("../../services/estoque/baixarPorPedido");

function toBase(qtd, unidade) {
  const value = Number(qtd || 0);
  if (unidade === "g") return { base: "kg", value: value / 1000 };
  if (unidade === "kg") return { base: "kg", value };
  if (unidade === "ml") return { base: "l", value: value / 1000 };
  if (unidade === "l") return { base: "l", value };
  if (unidade === "un") return { base: "un", value };
  return { base: unidade, value };
}

function baseFromInsumo(insumo) {
  const unidade = insumo?.baseUnit || insumo?.unidadePadrao;
  if (unidade === "g" || unidade === "kg") return "kg";
  if (unidade === "ml" || unidade === "l") return "l";
  return unidade || "un";
}

async function getInsumo(req) {
  return Insumo.findOne({
    _id: req.params.id,
    restauranteId: req.restauranteId,
  });
}

exports.listarPorInsumo = async (req, res) => {
  try {
    const insumo = await getInsumo(req);
    if (!insumo) return res.status(404).json({ message: "Insumo não encontrado." });
    const movimentos = await MovimentoEstoque.find({
      restauranteId: req.restauranteId,
      insumoId: req.params.id,
    }).sort({ data: -1 });
    return res.json({ data: movimentos });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao carregar histórico do insumo.", error: error.message });
  }
};

exports.criarMovimentoManual = async (req, res) => {
  try {
    const insumo = await getInsumo(req);
    if (!insumo) return res.status(404).json({ message: "Insumo não encontrado." });

    const tipo = String(req.body.tipo || "entrada").trim().toLowerCase();
    const permitidos = new Set(["entrada", "compra", "saida", "perda", "ajuste", "inventario"]);
    if (!permitidos.has(tipo)) return res.status(400).json({ message: "Tipo de movimento inválido." });

    const saldoAtual = Number(insumo.quantidadeBase || 0);
    const unidadeInformada = String(req.body.unidade || insumo.unidadePadrao || insumo.baseUnit || "un");
    let deltaBase = 0;

    if (tipo === "ajuste" || tipo === "inventario") {
      const alvo = toBase(req.body.novoSaldo ?? req.body.quantidade, unidadeInformada);
      if (!Number.isFinite(alvo.value) || alvo.value < 0) {
        return res.status(400).json({ message: "Novo saldo inválido." });
      }
      if (alvo.base !== baseFromInsumo(insumo)) {
        return res.status(400).json({ message: "Unidade incompatível com o insumo." });
      }
      deltaBase = alvo.value - saldoAtual;
    } else {
      const quantidade = toBase(req.body.quantidade, unidadeInformada);
      if (!Number.isFinite(quantidade.value) || quantidade.value <= 0) {
        return res.status(400).json({ message: "Informe uma quantidade maior que zero." });
      }
      if (quantidade.base !== baseFromInsumo(insumo)) {
        return res.status(400).json({ message: "Unidade incompatível com o insumo." });
      }
      deltaBase = ["saida", "perda"].includes(tipo) ? -quantidade.value : quantidade.value;
    }

    const novoSaldo = saldoAtual + deltaBase;
    if (novoSaldo < 0) {
      return res.status(409).json({
        message: `Saldo insuficiente. Disponível: ${saldoAtual.toFixed(4)} ${baseFromInsumo(insumo)}.`,
      });
    }

    await Insumo.updateOne(
      { _id: insumo._id, restauranteId: req.restauranteId },
      { $inc: { quantidadeBase: deltaBase } }
    );

    const movimento = await MovimentoEstoque.create({
      restauranteId: req.restauranteId,
      insumoId: insumo._id,
      tipo,
      quantidadeBase: deltaBase,
      custoUnitarioBase: Number(req.body.custoUnitarioBase ?? insumo.costBase ?? 0),
      origem: "manual",
      referenciaId: req.body.referenciaId || null,
      observacao: String(req.body.observacao || "").trim(),
      criadoPor: req.user?._id || req.userId || req.restauranteId || null,
      detalhes: { saldoAnterior: saldoAtual, saldoPosterior: novoSaldo },
      data: new Date(),
    });

    return res.status(201).json({
      ok: true,
      data: movimento,
      insumo: { ...insumo.toObject(), quantidadeBase: novoSaldo, estoqueAtualBase: novoSaldo },
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao registrar movimento de estoque.", error: error.message });
  }
};

exports.baixarPorProduto = async (req, res) => {
  try {
    const produtoId = String(req.body.produtoId || "");
    if (!produtoId) return res.status(400).json({ message: "produtoId é obrigatório." });
    const quantidade = Math.max(1, Math.floor(Number(req.body.quantidade || 1)));
    const referenciaId = String(req.body.pedidoId || crypto.randomBytes(12).toString("hex"));
    const item = {
      produtoId,
      quantidade,
      saboresSelecionados: req.body.saboresSelecionados || req.body.sabores || [],
      bordaSelecionada: req.body.bordaSelecionada || req.body.borda || null,
      adicionalSelecionado: req.body.adicionalSelecionado || req.body.adicional || null,
      complementosSelecionados: req.body.complementosSelecionados || [],
      tiposExtrasSelecionados: req.body.tiposExtrasSelecionados || {},
    };
    const result = await baixarEstoquePorPedido({
      restauranteId: req.restauranteId,
      pedidoId: referenciaId,
      itensPedido: [item],
      actorId: req.user?._id || req.userId || req.restauranteId || null,
    });
    return res.json({ ...result, referenciaId });
  } catch (error) {
    return res.status(409).json({ ok: false, message: error?.message || "Erro ao baixar estoque." });
  }
};
