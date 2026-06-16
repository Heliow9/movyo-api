const CaixaSessao = require('../models/CaixaSessao');
const CaixaMovimento = require('../models/CaixaMovimento');
const { queryWithRetry } = require('../lib/mysqlRetry');

const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? 0).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '').replace(/R\$|[^0-9,.-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
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
  if (!restauranteId) return null;
  const [rows] = await queryWithRetry(
    `SELECT * FROM caixa_sessoes
      WHERE restauranteId = ? AND status = 'aberto'
      ORDER BY abertoEm DESC, created_at DESC, id DESC
      LIMIT 1`,
    [String(restauranteId)],
    { label: 'caixa.getAberto' }
  );
  const row = rows?.[0];
  if (!row) return null;
  return { ...row, _id: row.id, id: row.id };
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
  // Vincular ao caixa não significa aceitar o pedido. O marco de produção é gravado
  // somente quando o restaurante efetivamente move o pedido para em_producao.
  if (!pedido.dataOperacional) {
    const raw = caixa.dataOperacional || caixa.abertoEm || new Date();
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      pedido.dataOperacional = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }
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

async function calcularTotaisCaixa(caixaId) {
  const id = String(caixaId);

  // Tudo é calculado exclusivamente pelo ID da sessão atualmente aberta.
  // dataOperacional/data do calendário não entram aqui, pois um turno pode
  // atravessar a meia-noite e outro caixa pode ser aberto no mesmo dia.
  const [movimentosResult, pedidosResult] = await Promise.all([
    queryWithRetry(
      `SELECT tipo, formaPagamento, COALESCE(SUM(valor), 0) AS total
         FROM caixa_movimentos
        WHERE caixaSessaoId = ?
        GROUP BY tipo, formaPagamento`,
      [id],
      { label: 'caixa.calcularTotais.movimentos' }
    ),
    queryWithRetry(
      `SELECT
          COUNT(*) AS totalPedidos,
          COALESCE(SUM(
            CASE
              WHEN LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
                OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
              THEN COALESCE(total, 0)
              ELSE 0
            END
          ), 0) AS totalVendasPedidos
         FROM pedidos
        WHERE caixaSessaoId = ?
          AND LOWER(COALESCE(status, '')) NOT IN ('cancelado','cancelada','canceled','cancelled')`,
      [id],
      { label: 'caixa.calcularTotais.pedidos' }
    ),
  ]);

  const rows = movimentosResult?.[0] || [];
  const pedidoRow = pedidosResult?.[0]?.[0] || {};
  const totals = {
    dinheiro: 0,
    pix: 0,
    credito: 0,
    debito: 0,
    online: 0,
    outros: 0,
    sangria: 0,
    suprimento: 0,
    vendas: 0,
    pedidos: Math.max(0, Number(pedidoRow.totalPedidos || 0)),
    vendasPedidos: round2(toNum(pedidoRow.totalVendasPedidos || 0)),
  };

  for (const m of rows) {
    const val = round2(toNum(m.total));
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
  // O movimento financeiro é a fonte contábil principal. Como pedidos online
  // antigos podem não ter gerado movimento, conciliamos somente dentro do mesmo
  // caixa e usamos o maior total estritamente vinculado à sessão atual.
  totals.vendas = round2(Math.max(totals.vendas, totals.vendasPedidos));
  return totals;
}

async function aplicarTotaisNoCaixa(caixa, totals) {
  if (!caixa) return null;
  caixa.totalDinheiro = round2(totals.dinheiro);
  caixa.totalPix = round2(totals.pix);
  caixa.totalCredito = round2(totals.credito);
  caixa.totalDebito = round2(totals.debito);
  caixa.totalOnline = round2(totals.online);
  caixa.totalOutros = round2(totals.outros);
  caixa.totalVendas = round2(totals.vendas);
  caixa.totalPedidos = Math.max(0, Number(totals.pedidos || 0));
  caixa.totalSangrias = round2(totals.sangria);
  caixa.totalSuprimentos = round2(totals.suprimento);
  caixa.totalEsperadoDinheiro = round2(toNum(caixa.saldoInicial) + totals.dinheiro + totals.suprimento - totals.sangria);
  return caixa;
}

async function recalcularCaixa(caixaId) {
  const caixa = await CaixaSessao.findById(caixaId);
  if (!caixa) return null;
  const totals = await calcularTotaisCaixa(caixa._id || caixa.id || caixaId);
  await aplicarTotaisNoCaixa(caixa, totals);
  await caixa.save();
  return caixa;
}

async function montarCaixaComTotais(caixa) {
  if (!caixa) return null;
  const totals = await calcularTotaisCaixa(caixa._id || caixa.id);
  const alvo = { ...(typeof caixa.toObject === 'function' ? caixa.toObject() : caixa) };
  await aplicarTotaisNoCaixa(alvo, totals);
  return alvo;
}

module.exports = { normalizeFormaPagamento, getCaixaAberto, exigirCaixaAberto, vincularPedidoAoCaixa, registrarMovimentoVenda, recalcularCaixa, montarCaixaComTotais, calcularTotaisCaixa, round2, toNum };
