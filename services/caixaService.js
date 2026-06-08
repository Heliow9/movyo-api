const CaixaSessao = require('../models/CaixaSessao');
const CaixaMovimento = require('../models/CaixaMovimento');

const toNum = (v) => {
  const n = Number(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

function normalizeFormaPagamento(v='') {
  const s = String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
  if (s.includes('dinheiro')) return 'dinheiro';
  if (s === 'pix' || s.includes('mercadopagopix')) return 'pix';
  if (s.includes('credito') || s.includes('ccredito')) return 'credito';
  if (s.includes('debito') || s.includes('cdebito')) return 'debito';
  if (s.includes('online') || s.includes('mercadopago') || s.includes('pagarme')) return 'online';
  if (s.includes('cartao')) return 'credito';
  return s || 'outros';
}

async function getCaixaAberto(restauranteId) {
  const caixas = await CaixaSessao.find({ restauranteId: String(restauranteId), status: 'aberto' }).sort({ abertoEm: -1 }).limit(1).lean();
  return Array.isArray(caixas) ? caixas[0] : caixas;
}

async function exigirCaixaAberto(restauranteId) {
  const caixa = await getCaixaAberto(restauranteId);
  if (!caixa) {
    const err = new Error('Abra o caixa para continuar esta operação.');
    err.status = 409;
    err.code = 'CAIXA_FECHADO';
    throw err;
  }
  return caixa;
}

function totalPedido(pedido) {
  const v = toNum(pedido?.valorTotal ?? pedido?.total);
  if (v > 0) return round2(v);
  return round2((pedido?.itens || []).reduce((acc, it) => {
    const qtd = Math.max(1, toNum(it?.quantidade ?? 1));
    const unit = toNum(it?.precoUnitario ?? it?.preco ?? 0);
    const total = toNum(it?.precoTotal ?? it?.total ?? 0);
    return acc + (total > 0 ? total : unit * qtd);
  }, 0));
}

async function vincularPedidoAoCaixa(pedido, caixa) {
  if (!pedido || !caixa) return pedido;
  if (!pedido.caixaSessaoId) pedido.caixaSessaoId = caixa._id || caixa.id;
  if (!pedido.operadorCaixaId) pedido.operadorCaixaId = caixa.operadorId;
  if (!pedido.operadorCaixaNome) pedido.operadorCaixaNome = caixa.operadorNome;
  if (!pedido.aceitoEm) pedido.aceitoEm = new Date();
  return pedido;
}

async function registrarMovimentoVenda({ pedido, pagamento, caixa, restauranteId }) {
  if (!pedido || !caixa) return null;
  const forma = normalizeFormaPagamento(pagamento?.metodo || pagamento?.formaPagamento || pedido?.formaPagamento || pedido?.formadePagamento);
  const valor = round2(toNum(pagamento?.valor ?? pedido?.valorPago ?? totalPedido(pedido)));
  if (valor <= 0) return null;
  return CaixaMovimento.create({
    restauranteId: String(restauranteId || pedido.restaurante || caixa.restauranteId),
    caixaSessaoId: caixa._id || caixa.id,
    operadorId: caixa.operadorId,
    tipo: 'venda',
    valor,
    formaPagamento: forma,
    origem: pedido.origem || 'pedido',
    pedidoId: pedido._id || pedido.id,
    descricao: `Pedido ${pedido.numeroPedido || pedido._id || ''}`.trim(),
  });
}

async function recalcularCaixa(caixaId) {
  const caixa = await CaixaSessao.findById(caixaId);
  if (!caixa) return null;
  const movs = await CaixaMovimento.find({ caixaSessaoId: caixa._id }).lean();
  const totals = { dinheiro:0, pix:0, credito:0, debito:0, online:0, outros:0, sangria:0, suprimento:0, vendas:0 };
  for (const m of movs || []) {
    const val = round2(toNum(m.valor));
    const tipo = String(m.tipo || '').toLowerCase();
    if (tipo === 'sangria') totals.sangria += val;
    else if (tipo === 'suprimento') totals.suprimento += val;
    else if (tipo === 'venda') {
      totals.vendas += val;
      const f = normalizeFormaPagamento(m.formaPagamento);
      if (totals[f] === undefined) totals.outros += val;
      else totals[f] += val;
    }
  }
  caixa.totalDinheiro = round2(totals.dinheiro);
  caixa.totalPix = round2(totals.pix);
  caixa.totalCredito = round2(totals.credito);
  caixa.totalDebito = round2(totals.debito);
  caixa.totalOnline = round2(totals.online);
  caixa.totalOutros = round2(totals.outros);
  caixa.totalVendas = round2(totals.vendas);
  caixa.totalSangrias = round2(totals.sangria);
  caixa.totalSuprimentos = round2(totals.suprimento);
  caixa.totalEsperadoDinheiro = round2(toNum(caixa.saldoInicial) + totals.dinheiro + totals.suprimento - totals.sangria);
  await caixa.save();
  return caixa;
}

module.exports = { normalizeFormaPagamento, getCaixaAberto, exigirCaixaAberto, vincularPedidoAoCaixa, registrarMovimentoVenda, recalcularCaixa, round2, toNum };
