const Produto = require("../../models/Produto");
const Receita = require("../../models/Receita");
const Insumo = require("../../models/Insumo");
const MovimentoEstoque = require("../../models/MovimentoEstoque");
const { buildRecipeMultipliers, getProductId } = require("./pizzaStock");

function getId(value) {
  return String(value?._id || value?.id || value || "");
}

async function carregarProdutos(restauranteId, itensPedido) {
  const ids = [...new Set((itensPedido || []).map(getProductId).filter(Boolean))];
  if (!ids.length) return [];
  return Produto.find({ _id: { $in: ids }, restaurante: restauranteId }).lean();
}

function montarConsumoPorInsumo(receitasPlanejadas, receitaMap) {
  const consumo = new Map();
  const detalhesPorInsumo = new Map();

  receitasPlanejadas.forEach((planejada) => {
    const receita = receitaMap.get(String(planejada.receitaId));
    if (!receita) return;

    (receita.itens || []).forEach((item) => {
      const insumoId = getId(item.insumoId || item.insumo);
      const consumoBase = Number(item.consumoBasePorUn ?? item.insumoBasePorUn ?? item.qtd ?? 0);
      if (!insumoId || !Number.isFinite(consumoBase) || consumoBase <= 0) return;
      const total = consumoBase * Number(planejada.multiplicador || 0);
      consumo.set(insumoId, (consumo.get(insumoId) || 0) + total);
      const list = detalhesPorInsumo.get(insumoId) || [];
      list.push({
        receitaId: String(planejada.receitaId),
        receitaNome: receita.nome,
        consumoBase: total,
        composicao: planejada.detalhes,
      });
      detalhesPorInsumo.set(insumoId, list);
    });
  });

  return { consumo, detalhesPorInsumo };
}

async function baixarEstoquePorPedido({ restauranteId, pedidoId, itensPedido, actorId }) {
  const referenceId = String(pedidoId || "");
  if (!restauranteId || !referenceId) throw new Error("Restaurante e pedido são obrigatórios para baixar o estoque.");

  const produtos = await carregarProdutos(restauranteId, itensPedido);
  const plano = buildRecipeMultipliers({ itensPedido, produtos });
  const saboresSemReceita = plano.avisos.filter((aviso) => aviso.codigo === "sabor_sem_receita");
  if (saboresSemReceita.length) {
    const nomes = saboresSemReceita.map((aviso) => aviso.opcao || "sabor sem nome").join(", ");
    throw new Error(`Configure a receita de estoque para os sabores: ${nomes}.`);
  }
  const receitaIds = plano.receitas.map((item) => item.receitaId);
  if (!receitaIds.length) {
    return { ok: true, semConfiguracao: true, avisos: plano.avisos };
  }

  const receitas = await Receita.find({
    _id: { $in: receitaIds },
    restauranteId,
    ativo: true,
  }).lean();
  const receitaMap = new Map(receitas.map((receita) => [getId(receita), receita]));
  const receitasAusentes = receitaIds.filter((receitaId) => !receitaMap.has(String(receitaId)));
  if (receitasAusentes.length) {
    throw new Error("Uma ou mais receitas vinculadas ao produto não existem ou estão inativas.");
  }
  const { consumo, detalhesPorInsumo } = montarConsumoPorInsumo(plano.receitas, receitaMap);
  const movimentosExistentes = await MovimentoEstoque.find({
    restauranteId,
    origem: "pedido",
    referenciaId: referenceId,
    tipo: "baixa_venda",
  }).lean();
  if (movimentosExistentes.length) {
    const insumosJaBaixados = new Set(
      movimentosExistentes.map((movimento) => getId(movimento.insumoId))
    );
    const baixaCompleta =
      insumosJaBaixados.size === consumo.size &&
      [...consumo.keys()].every((insumoId) => insumosJaBaixados.has(String(insumoId)));
    if (baixaCompleta) {
      return { ok: true, idempotente: true, avisos: plano.avisos };
    }
    throw new Error("A baixa anterior deste pedido ficou incompleta. Revise os movimentos antes de tentar novamente.");
  }

  const insumoIds = [...consumo.keys()];
  const insumos = await Insumo.find({
    _id: { $in: insumoIds },
    restauranteId,
    ativo: true,
  });
  const insumoMap = new Map(insumos.map((insumo) => [getId(insumo), insumo]));

  for (const [insumoId, total] of consumo.entries()) {
    const insumo = insumoMap.get(insumoId);
    if (!insumo) throw new Error(`Insumo da receita não encontrado: ${insumoId}`);
    if (Number(insumo.quantidadeBase || 0) < total) {
      throw new Error(
        `Estoque insuficiente para ${insumo.nome}. Necessário: ${total.toFixed(4)} ${insumo.baseUnit}; disponível: ${Number(insumo.quantidadeBase || 0).toFixed(4)} ${insumo.baseUnit}.`
      );
    }
  }

  const movimentosCriados = [];
  for (const [insumoId, total] of consumo.entries()) {
    const insumo = insumoMap.get(insumoId);
    await Insumo.updateOne(
      { _id: insumoId, restauranteId },
      { $inc: { quantidadeBase: -Math.abs(total) } }
    );

    const movimento = await MovimentoEstoque.create({
      restauranteId,
      insumoId,
      tipo: "baixa_venda",
      quantidadeBase: -Math.abs(total),
      custoUnitarioBase: Number(insumo.costBase || insumo.custoMedioBase || 0),
      origem: "pedido",
      referenciaId: referenceId,
      observacao: "Baixa automática por pedido",
      criadoPor: actorId || null,
      detalhes: {
        pedidoId: referenceId,
        composicao: detalhesPorInsumo.get(insumoId) || [],
      },
      data: new Date(),
    });
    movimentosCriados.push(getId(movimento));
  }

  return {
    ok: true,
    idempotente: false,
    movimentos: movimentosCriados,
    insumosBaixados: consumo.size,
    avisos: plano.avisos,
  };
}

async function estornarEstoquePorPedido({ restauranteId, pedidoId, actorId }) {
  const referenceId = String(pedidoId || "");
  if (!restauranteId || !referenceId) return { ok: true, semMovimentos: true };

  const jaEstornado = await MovimentoEstoque.findOne({
    restauranteId,
    origem: "pedido",
    referenciaId: referenceId,
    tipo: "estorno_venda",
  }).lean();
  if (jaEstornado) return { ok: true, idempotente: true };

  const baixas = await MovimentoEstoque.find({
    restauranteId,
    origem: "pedido",
    referenciaId: referenceId,
    tipo: "baixa_venda",
  }).lean();
  if (!baixas.length) return { ok: true, semMovimentos: true };

  for (const baixa of baixas) {
    const quantidade = Math.abs(Number(baixa.quantidadeBase || 0));
    if (!quantidade) continue;
    await Insumo.updateOne(
      { _id: baixa.insumoId, restauranteId },
      { $inc: { quantidadeBase: quantidade } }
    );
    await MovimentoEstoque.create({
      restauranteId,
      insumoId: baixa.insumoId,
      tipo: "estorno_venda",
      quantidadeBase: quantidade,
      custoUnitarioBase: Number(baixa.custoUnitarioBase || 0),
      origem: "pedido",
      referenciaId: referenceId,
      observacao: "Estorno automático por cancelamento do pedido",
      criadoPor: actorId || null,
      detalhes: { movimentoOriginalId: getId(baixa) },
      data: new Date(),
    });
  }

  return { ok: true, idempotente: false, insumosEstornados: baixas.length };
}

module.exports = {
  baixarEstoquePorPedido,
  estornarEstoquePorPedido,
  montarConsumoPorInsumo,
};
