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

function dataOperacionalDoCaixa(caixa) {
  const direta = String(caixa?.dataOperacional || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direta)) return direta;
  const d = new Date(caixa?.abertoEm || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

/**
 * Vincula o pedido à sessão informada.
 * `force` é usado apenas no instante financeiro (pagamento confirmado), quando
 * a venda precisa pertencer ao caixa que está efetivamente aberto naquele momento.
 */
async function vincularPedidoAoCaixa(pedido, caixa, options = {}) {
  if (!pedido || !caixa) return pedido;
  const caixaId = String(caixa._id || caixa.id || '');
  const force = options?.force === true;

  if (force || !pedido.caixaSessaoId) pedido.caixaSessaoId = caixaId;
  if (force || !pedido.operadorCaixaId) pedido.operadorCaixaId = caixa.operadorId;
  if (force || !pedido.operadorCaixaNome) pedido.operadorCaixaNome = caixa.operadorNome;

  // Vincular ao caixa não significa aceitar o pedido. O marco de produção é gravado
  // somente quando o restaurante efetivamente move o pedido para em_producao.
  if (force || !pedido.dataOperacional) {
    pedido.dataOperacional = dataOperacionalDoCaixa(caixa);
  }
  return pedido;
}

/**
 * Corrige dados antigos/inconsistentes sem misturar caixas fechados.
 * Um pedido só é movido para o caixa atual quando o seu evento operacional/financeiro
 * ocorreu depois da abertura atual e ele está sem caixa, aponta para caixa inexistente,
 * ou aponta para uma sessão que já estava fechada antes desse evento.
 */
async function reconciliarPedidosDoCaixaAberto(caixa) {
  if (!caixa || String(caixa.status || '').toLowerCase() !== 'aberto') {
    return { pedidos: 0, movimentos: 0 };
  }

  const caixaId = String(caixa._id || caixa.id || '');
  const restauranteId = String(caixa.restauranteId || '');
  const abertoEm = caixa.abertoEm;
  if (!caixaId || !restauranteId || !abertoEm) return { pedidos: 0, movimentos: 0 };

  const eventoSql = `COALESCE(p.pagoEm, p.emProducaoEm, p.aceitoEm, p.statusAtualizadoEm, p.criadoEm, p.created_at)`;
  const dataOperacional = dataOperacionalDoCaixa(caixa);

  const [pedidoUpdate] = await queryWithRetry(
    `UPDATE pedidos p
       LEFT JOIN caixa_sessoes anterior ON anterior.id = p.caixaSessaoId
        SET p.caixaSessaoId = ?,
            p.operadorCaixaId = ?,
            p.operadorCaixaNome = ?,
            p.dataOperacional = ?
      WHERE p.restaurante = ?
        AND COALESCE(p.caixaSessaoId, '') <> ?
        AND LOWER(COALESCE(p.status, '')) NOT IN ('cancelado','cancelada','canceled','cancelled')
        AND ${eventoSql} IS NOT NULL
        AND ${eventoSql} >= ?
        AND (
          p.caixaSessaoId IS NULL
          OR TRIM(p.caixaSessaoId) = ''
          OR anterior.id IS NULL
          OR (
            LOWER(COALESCE(anterior.status, '')) = 'fechado'
            AND anterior.fechadoEm IS NOT NULL
            AND ${eventoSql} > anterior.fechadoEm
          )
          OR (
            LOWER(COALESCE(anterior.status, '')) = 'aberto'
            AND anterior.abertoEm < ?
          )
        )`,
    [
      caixaId,
      caixa.operadorId || null,
      caixa.operadorNome || '',
      dataOperacional || null,
      restauranteId,
      caixaId,
      abertoEm,
      abertoEm,
    ],
    { label: 'caixa.reconciliarPedidosAtual' }
  );

  // Se uma venda antiga foi registrada em movimento com a sessão errada, acompanha
  // o pedido já reconciliado. A restrição temporal impede alterar movimentos legítimos.
  const [movimentoUpdate] = await queryWithRetry(
    `UPDATE caixa_movimentos m
       INNER JOIN pedidos p ON p.id = m.pedidoId
        SET m.caixaSessaoId = ?,
            m.operadorId = ?
      WHERE p.caixaSessaoId = ?
        AND m.tipo = 'venda'
        AND COALESCE(m.caixaSessaoId, '') <> ?
        AND COALESCE(m.data, p.pagoEm, p.criadoEm, p.created_at) >= ?`,
    [caixaId, caixa.operadorId || null, caixaId, caixaId, abertoEm],
    { label: 'caixa.reconciliarMovimentosAtual' }
  );

  const resultado = {
    pedidos: Number(pedidoUpdate?.affectedRows || 0),
    movimentos: Number(movimentoUpdate?.affectedRows || 0),
  };
  if (resultado.pedidos > 0 || resultado.movimentos > 0) {
    console.log(`🧾 Caixa ${caixaId}: reconciliados ${resultado.pedidos} pedido(s) e ${resultado.movimentos} movimento(s).`);
  }
  return resultado;
}

async function registrarMovimentoVenda({ pedido, pagamento, caixa, restauranteId }) {
  if (!pedido || !caixa) return null;
  const caixaId = String(caixa._id || caixa.id || '');
  const pedidoId = String(pedido._id || pedido.id || '');
  const forma = normalizeFormaPagamento(pagamento?.metodo || pagamento?.formaPagamento || pedido?.formaPagamento || pedido?.formadePagamento);
  const valor = round2(toNum(pagamento?.valor ?? pedido?.valorPago ?? totalPedido(pedido)));
  const referenciaPagamento = String(
    pagamento?.mpPaymentId || pagamento?.paymentId || pagamento?.idPagamento || ''
  ).trim();
  if (!caixaId || !pedidoId || valor <= 0) return null;

  let existenteId = String(pagamento?.caixaMovimentoId || '').trim();

  // Mercado Pago pode reenviar o mesmo webhook. A referência externa torna o
  // lançamento idempotente sem juntar pagamentos mistos legítimos do mesmo pedido.
  if (!existenteId && referenciaPagamento) {
    const [porReferencia] = await queryWithRetry(
      `SELECT id FROM caixa_movimentos
        WHERE tipo = 'venda' AND referenciaPagamento = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [referenciaPagamento],
      { label: 'caixa.movimentoVenda.referencia' }
    );
    existenteId = String(porReferencia?.[0]?.id || '');
  }

  // Compatibilidade com movimentos criados antes da coluna referenciaPagamento.
  // Só aplica para pagamentos externos identificados e exige pedido, forma e valor iguais.
  if (!existenteId && referenciaPagamento) {
    const [legados] = await queryWithRetry(
      `SELECT id FROM caixa_movimentos
        WHERE tipo = 'venda'
          AND pedidoId = ?
          AND LOWER(COALESCE(formaPagamento, '')) = ?
          AND ABS(COALESCE(valor, 0) - ?) < 0.01
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [pedidoId, forma.toLowerCase(), valor],
      { label: 'caixa.movimentoVenda.legado' }
    );
    existenteId = String(legados?.[0]?.id || '');
  }

  if (existenteId) {
    await queryWithRetry(
      `UPDATE caixa_movimentos
          SET caixaSessaoId = ?, valor = ?, formaPagamento = ?, operadorId = ?,
              origem = ?, referenciaPagamento = ?, descricao = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        caixaId,
        valor,
        forma,
        caixa.operadorId || null,
        pedido.origem || 'pedido',
        referenciaPagamento || null,
        `Pedido ${pedido.numeroPedido || pedidoId}`.trim(),
        existenteId,
      ],
      { label: 'caixa.movimentoVenda.atualizar' }
    );
    return CaixaMovimento.findById(existenteId);
  }

  return CaixaMovimento.create({
    restauranteId: String(restauranteId || pedido.restaurante || caixa.restauranteId),
    caixaSessaoId: caixaId,
    operadorId: caixa.operadorId,
    tipo: 'venda',
    valor,
    formaPagamento: forma,
    origem: pedido.origem || 'pedido',
    pedidoId,
    referenciaPagamento: referenciaPagamento || null,
    descricao: `Pedido ${pedido.numeroPedido || pedidoId}`.trim(),
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
          COALESCE(SUM(CASE WHEN
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END
            ELSE 0 END), 0) AS totalVendasPedidos,
          COALESCE(SUM(CASE WHEN (
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
          ) AND LOWER(COALESCE(formaPagamento, '')) LIKE '%dinheiro%'
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END ELSE 0 END), 0) AS dinheiroPedidos,
          COALESCE(SUM(CASE WHEN (
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
          ) AND LOWER(COALESCE(formaPagamento, '')) LIKE '%pix%'
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END ELSE 0 END), 0) AS pixPedidos,
          COALESCE(SUM(CASE WHEN (
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
          ) AND (LOWER(COALESCE(formaPagamento, '')) LIKE '%credito%' OR LOWER(COALESCE(formaPagamento, '')) LIKE '%cartao%')
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END ELSE 0 END), 0) AS creditoPedidos,
          COALESCE(SUM(CASE WHEN (
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
          ) AND LOWER(COALESCE(formaPagamento, '')) LIKE '%debito%'
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END ELSE 0 END), 0) AS debitoPedidos,
          COALESCE(SUM(CASE WHEN (
            LOWER(COALESCE(statusPagamento, '')) IN ('pago','paid','approved','aprovado')
            OR LOWER(COALESCE(status, '')) IN ('pago','em_producao','em_entrega','entregue','concluido','finalizado')
          ) AND (LOWER(COALESCE(formaPagamento, '')) LIKE '%online%' OR LOWER(COALESCE(formaPagamento, '')) LIKE '%pagarme%')
            THEN CASE WHEN COALESCE(total, 0) > 0 THEN total ELSE COALESCE(valorPago, 0) END ELSE 0 END), 0) AS onlinePedidos
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

  // Pedidos confirmados corrigem caixas antigos que não receberam movimento financeiro.
  // O maior valor por forma evita duplicidade quando o movimento já existe.
  totals.dinheiro = round2(Math.max(totals.dinheiro, toNum(pedidoRow.dinheiroPedidos)));
  totals.pix = round2(Math.max(totals.pix, toNum(pedidoRow.pixPedidos)));
  totals.credito = round2(Math.max(totals.credito, toNum(pedidoRow.creditoPedidos)));
  totals.debito = round2(Math.max(totals.debito, toNum(pedidoRow.debitoPedidos)));
  totals.online = round2(Math.max(totals.online, toNum(pedidoRow.onlinePedidos)));
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
  if (String(caixa.status || '').toLowerCase() === 'aberto') {
    await reconciliarPedidosDoCaixaAberto(caixa);
  }
  const totals = await calcularTotaisCaixa(caixa._id || caixa.id || caixaId);
  await aplicarTotaisNoCaixa(caixa, totals);
  await caixa.save();
  return caixa;
}

async function montarCaixaComTotais(caixa) {
  if (!caixa) return null;
  if (String(caixa.status || '').toLowerCase() === 'aberto') {
    await reconciliarPedidosDoCaixaAberto(caixa);
  }
  const totals = await calcularTotaisCaixa(caixa._id || caixa.id);
  const alvo = { ...(typeof caixa.toObject === 'function' ? caixa.toObject() : caixa) };
  await aplicarTotaisNoCaixa(alvo, totals);
  return alvo;
}

module.exports = {
  normalizeFormaPagamento,
  getCaixaAberto,
  exigirCaixaAberto,
  vincularPedidoAoCaixa,
  reconciliarPedidosDoCaixaAberto,
  registrarMovimentoVenda,
  recalcularCaixa,
  montarCaixaComTotais,
  calcularTotaisCaixa,
  round2,
  toNum,
};
