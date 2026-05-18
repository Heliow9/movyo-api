// src/services/estoque/baixarPorPedido.js
const mongoose = require("../../lib/mongoId");
const Produto = require("../../models/Produto");
const Receita = require("../../models/Receita");
const Insumo = require("../../models/Insumo");
const MovimentoEstoque = require("../../models/MovimentoEstoque");

async function baixarEstoquePorPedido({ restauranteId, pedidoId, itensPedido, actorId }) {
  // itensPedido: [{ produtoId, quantidade }]
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // 1) carregar produtos (com receitaId)
      const produtoIds = itensPedido.map((x) => x.produtoId);
      const produtos = await Produto.find({ _id: { $in: produtoIds }, restauranteId }).session(session);

      const produtoMap = new Map(produtos.map((p) => [String(p._id), p]));

      // 2) carregar receitas
      const receitaIds = produtos.map((p) => p.receitaId).filter(Boolean);
      const receitas = await Receita.find({ _id: { $in: receitaIds }, restauranteId }).session(session);
      const receitaMap = new Map(receitas.map((r) => [String(r._id), r]));

      // 3) montar consumo total por insumo
      const consumoPorInsumo = new Map(); // insumoId -> totalBaseConsumir

      for (const item of itensPedido) {
        const p = produtoMap.get(String(item.produtoId));
        if (!p) continue;

        if (!p.receitaId) continue; // produto sem receita: não baixa insumo
        const r = receitaMap.get(String(p.receitaId));
        if (!r) continue;

        const q = Math.max(0, Math.floor(Number(item.quantidade || 0)));
        if (!q) continue;

        for (const it of r.itens || []) {
          const key = String(it.insumoId);
          const total = (consumoPorInsumo.get(key) || 0) + (it.consumoBasePorUn * q);
          consumoPorInsumo.set(key, total);
        }
      }

      const insumoIds = Array.from(consumoPorInsumo.keys());
      if (!insumoIds.length) return;

      // 4) carregar insumos e validar estoque
      const insumos = await Insumo.find({ _id: { $in: insumoIds }, restauranteId }).session(session);
      const insMap = new Map(insumos.map((i) => [String(i._id), i]));

      for (const [insumoId, totalConsumo] of consumoPorInsumo.entries()) {
        const ins = insMap.get(insumoId);
        if (!ins) throw new Error(`Insumo não encontrado: ${insumoId}`);

        const novo = ins.quantidadeBase - totalConsumo;
        if (novo < 0) {
          throw new Error(`Estoque insuficiente para ${ins.nome}`);
        }
      }

      // 5) debitar + registrar movimentos
      for (const [insumoId, totalConsumo] of consumoPorInsumo.entries()) {
        await Insumo.updateOne(
          { _id: insumoId, restauranteId },
          { $inc: { quantidadeBase: -totalConsumo } },
          { session }
        );

        await MovimentoEstoque.create(
          [
            {
              restauranteId,
              insumoId,
              tipo: "baixa_venda",
              deltaBase: -totalConsumo,
              ref: { kind: "pedido", id: pedidoId },
              observacao: "Baixa automática por venda",
              criadoPor: actorId || null,
            },
          ],
          { session }
        );
      }
    });

    return { ok: true };
  } finally {
    session.endSession();
  }
}

module.exports = { baixarEstoquePorPedido };
