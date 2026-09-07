const ClienteMensalista = require('../models/ClienteMensalista');
const ContaReceber = require('../models/ContaReceber');
const RecebimentoConta = require('../models/RecebimentoConta');
const CaixaMovimento = require('../models/CaixaMovimento');
const { queryWithRetry } = require('../lib/mysqlRetry');
const { exigirCaixaAberto, recalcularCaixa, normalizeFormaPagamento, round2, toNum } = require('../services/caixaService');
const { registrarAuditoria } = require('../utils/audit');
const { addMonths, cleanPhone, dateOnly, effectiveStatus, monthKey } = require('../utils/financeiro');

const accountLocks = new Map();

async function acquireAccountLock(key) {
  const previous = accountLocks.get(key) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise((resolve) => { releaseCurrent = resolve; });
  accountLocks.set(key, current);
  await previous;
  return () => {
    releaseCurrent();
    if (accountLocks.get(key) === current) accountLocks.delete(key);
  };
}

function restauranteId(req) {
  return String(req.params.restauranteId || req.restauranteId || '');
}

async function assertCliente(id, restId) {
  const cliente = await ClienteMensalista.findById(id);
  if (!cliente || String(cliente.restauranteId) !== String(restId)) {
    const error = new Error('Cliente mensalista não encontrado.');
    error.status = 404;
    throw error;
  }
  return cliente;
}

async function assertConta(id, restId) {
  const conta = await ContaReceber.findById(id);
  if (!conta || String(conta.restauranteId) !== String(restId)) {
    const error = new Error('Conta a receber não encontrada.');
    error.status = 404;
    throw error;
  }
  return conta;
}

exports.listarClientes = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const busca = String(req.query.busca || '').trim();
    const params = [restId];
    let searchSql = '';
    if (busca) {
      searchSql = ' AND (c.nome LIKE ? OR c.telefone LIKE ? OR c.documento LIKE ?)';
      const pattern = `%${busca}%`;
      params.push(pattern, pattern, pattern);
    }
    const [rows] = await queryWithRetry(
      `SELECT c.*,
              COALESCE(SUM(CASE WHEN cr.status <> 'cancelada' THEN cr.saldo ELSE 0 END), 0) AS saldoDevedor,
              COALESCE(SUM(CASE WHEN cr.status <> 'cancelada' AND cr.saldo > 0 AND DATE(cr.vencimento) < CURDATE() THEN cr.saldo ELSE 0 END), 0) AS totalVencido,
              COUNT(CASE WHEN cr.status <> 'cancelada' AND cr.saldo > 0 THEN 1 END) AS contasAbertas
         FROM clientes_mensalistas c
         LEFT JOIN contas_receber cr ON cr.clienteMensalistaId = c.id AND cr.restauranteId = c.restauranteId
        WHERE c.restauranteId = ?${searchSql}
        GROUP BY c.id
        ORDER BY c.nome ASC`,
      params,
      { label: 'financeiro.clientes.listar' }
    );
    res.json({ clientes: (rows || []).map((row) => ({ ...row, _id: row.id })) });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar clientes mensalistas.', error: error.message });
  }
};

exports.salvarCliente = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const nome = String(req.body.nome || '').trim();
    const telefone = cleanPhone(req.body.telefone);
    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' });
    if (telefone.length < 8) return res.status(400).json({ message: 'Informe um telefone válido.' });
    const duplicate = await ClienteMensalista.findOne({ restauranteId: restId, telefone });
    if (duplicate && String(duplicate._id) !== String(req.params.clienteId || '')) {
      return res.status(409).json({ message: 'Já existe um mensalista com este telefone neste restaurante.' });
    }
    let cliente = req.params.clienteId ? await assertCliente(req.params.clienteId, restId) : new ClienteMensalista({ restauranteId: restId });
    cliente.nome = nome;
    cliente.telefone = telefone;
    cliente.email = String(req.body.email || '').trim();
    cliente.documento = String(req.body.documento || '').replace(/[^0-9A-Za-z]/g, '');
    cliente.endereco = req.body.endereco && typeof req.body.endereco === 'object' ? req.body.endereco : {};
    cliente.diaVencimento = Math.min(31, Math.max(1, Number(req.body.diaVencimento || 10)));
    cliente.limiteCredito = round2(Math.max(0, toNum(req.body.limiteCredito)));
    cliente.status = ['ativo', 'bloqueado', 'inativo'].includes(String(req.body.status)) ? String(req.body.status) : 'ativo';
    cliente.observacoes = String(req.body.observacoes || '').trim();
    cliente.criadoPor = cliente.criadoPor || req.userId || null;
    await cliente.save();
    await registrarAuditoria(req, req.params.clienteId ? 'mensalista.atualizado' : 'mensalista.criado', 'cliente_mensalista', cliente._id, { nome, telefone, status: cliente.status });
    res.status(req.params.clienteId ? 200 : 201).json({ ok: true, cliente });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Erro ao salvar mensalista.' });
  }
};

exports.listarContas = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const status = String(req.query.status || '').trim().toLowerCase();
    const clienteId = String(req.query.clienteId || '').trim();
    const inicio = dateOnly(req.query.inicio);
    const fim = dateOnly(req.query.fim);
    const params = [restId];
    const where = ["cr.restauranteId = ?", "cr.status <> 'cancelada'"];
    if (clienteId) { where.push('cr.clienteMensalistaId = ?'); params.push(clienteId); }
    if (inicio) { where.push('DATE(cr.vencimento) >= ?'); params.push(inicio); }
    if (fim) { where.push('DATE(cr.vencimento) <= ?'); params.push(fim); }
    if (status === 'paga') where.push('cr.saldo <= 0');
    else if (status === 'vencida') where.push('cr.saldo > 0 AND DATE(cr.vencimento) < CURDATE()');
    else if (status === 'em_aberto') where.push('cr.saldo > 0 AND DATE(cr.vencimento) >= CURDATE()');
    else if (status === 'parcial') where.push('cr.saldo > 0 AND cr.saldo < cr.valorOriginal');
    const [rows] = await queryWithRetry(
      `SELECT cr.*, cm.nome AS clienteNome, cm.telefone AS clienteTelefone
         FROM contas_receber cr
         INNER JOIN clientes_mensalistas cm ON cm.id = cr.clienteMensalistaId AND cm.restauranteId = cr.restauranteId
        WHERE ${where.join(' AND ')}
        ORDER BY cr.vencimento ASC, cr.created_at DESC
        LIMIT 1000`,
      params,
      { label: 'financeiro.contas.listar' }
    );
    res.json({ contas: (rows || []).map((row) => ({ ...row, _id: row.id, statusEfetivo: effectiveStatus(row) })) });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar contas a receber.', error: error.message });
  }
};

exports.criarContas = async (req, res) => {
  const criadas = [];
  try {
    const restId = restauranteId(req);
    const cliente = await assertCliente(req.body.clienteMensalistaId, restId);
    if (cliente.status !== 'ativo') return res.status(409).json({ message: 'O mensalista precisa estar ativo para receber uma nova conta.' });
    const valorTotal = round2(toNum(req.body.valor));
    const parcelas = Math.min(60, Math.max(1, Math.trunc(Number(req.body.parcelas || 1))));
    const primeiroVencimento = dateOnly(req.body.primeiroVencimento || req.body.vencimento);
    if (valorTotal <= 0) return res.status(400).json({ message: 'Informe um valor maior que zero.' });
    if (!primeiroVencimento) return res.status(400).json({ message: 'Informe o primeiro vencimento.' });
    if (toNum(cliente.limiteCredito) > 0) {
      const [debtRows] = await queryWithRetry(
        `SELECT COALESCE(SUM(saldo), 0) AS saldo FROM contas_receber
          WHERE restauranteId = ? AND clienteMensalistaId = ? AND status <> 'cancelada' AND saldo > 0`,
        [restId, String(cliente._id)],
        { label: 'financeiro.cliente.limite' }
      );
      const saldoAtual = round2(toNum(debtRows?.[0]?.saldo));
      if (round2(saldoAtual + valorTotal) > round2(toNum(cliente.limiteCredito))) {
        return res.status(409).json({ message: `Limite de crédito excedido. Disponível: R$ ${Math.max(0, toNum(cliente.limiteCredito) - saldoAtual).toFixed(2).replace('.', ',')}.` });
      }
    }
    const valorBase = Math.floor((valorTotal * 100) / parcelas) / 100;
    for (let index = 0; index < parcelas; index += 1) {
      const valorParcela = index === parcelas - 1 ? round2(valorTotal - valorBase * (parcelas - 1)) : valorBase;
      const vencimento = addMonths(primeiroVencimento, index);
      const conta = await ContaReceber.create({
        restauranteId: restId,
        clienteMensalistaId: cliente._id,
        pedidoId: req.body.pedidoId || null,
        descricao: String(req.body.descricao || 'Compra fiada').trim(),
        competencia: monthKey(vencimento),
        numeroParcela: index + 1,
        totalParcelas: parcelas,
        valorOriginal: valorParcela,
        saldo: valorParcela,
        vencimento,
        status: 'em_aberto',
        observacoes: String(req.body.observacoes || '').trim(),
        criadoPor: req.userId || null,
      });
      criadas.push(conta);
    }
    await registrarAuditoria(req, 'conta_receber.criada', 'conta_receber', criadas[0]?._id, { clienteMensalistaId: cliente._id, valorTotal, parcelas });
    res.status(201).json({ ok: true, contas: criadas });
  } catch (error) {
    for (const conta of criadas) {
      try { await ContaReceber.findByIdAndDelete(conta._id); } catch (_) {}
    }
    res.status(error.status || 500).json({ message: error.message || 'Erro ao criar conta a receber.' });
  }
};

async function recomputarConta(conta) {
  const [rows] = await queryWithRetry(
    `SELECT COALESCE(SUM(valor), 0) AS recebido FROM recebimentos_conta WHERE contaReceberId = ? AND status = 'confirmado'`,
    [String(conta._id)],
    { label: 'financeiro.conta.recomputar' }
  );
  const recebido = round2(toNum(rows?.[0]?.recebido));
  conta.saldo = round2(Math.max(0, toNum(conta.valorOriginal) - recebido));
  conta.status = conta.saldo <= 0 ? 'paga' : recebido > 0 ? 'parcial' : 'em_aberto';
  await conta.save();
  return conta;
}

exports.receberConta = async (req, res) => {
  let releaseAccount = () => {};
  try {
    const restId = restauranteId(req);
    releaseAccount = await acquireAccountLock(`${restId}:${String(req.params.contaId || '')}`);
    const conta = await assertConta(req.params.contaId, restId);
    if (String(conta.status) === 'cancelada') return res.status(409).json({ message: 'Conta cancelada não pode receber pagamento.' });
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body.idempotencyKey || `manual-${Date.now()}-${conta._id}`).slice(0, 120);
    let recebimento = await RecebimentoConta.findOne({ restauranteId: restId, idempotencyKey });
    if (recebimento && String(recebimento.contaReceberId) !== String(conta._id)) return res.status(409).json({ message: 'Chave de recebimento já utilizada.' });
    if (recebimento?.caixaMovimentoId) {
      await recomputarConta(conta);
      return res.json({ ok: true, idempotente: true, conta, recebimento });
    }
    const valor = recebimento ? round2(toNum(recebimento.valor)) : round2(toNum(req.body.valor));
    if (!recebimento && (valor <= 0 || valor > round2(toNum(conta.saldo)))) return res.status(400).json({ message: 'O valor deve ser maior que zero e não pode superar o saldo da conta.' });
    const metodo = recebimento?.metodo || normalizeFormaPagamento(req.body.metodo || 'dinheiro');
    const caixa = await exigirCaixaAberto(restId);
    if (!recebimento) {
      recebimento = await RecebimentoConta.create({
        restauranteId: restId,
        contaReceberId: conta._id,
        clienteMensalistaId: conta.clienteMensalistaId,
        valor,
        metodo,
        recebidoEm: new Date(),
        caixaSessaoId: caixa._id || caixa.id,
        operadorId: caixa.operadorId,
        observacoes: String(req.body.observacoes || '').trim(),
        idempotencyKey,
        criadoPor: req.userId || null,
        status: 'confirmado',
      });
    }
    const referenciaPagamento = `conta:${recebimento._id}`;
    let movimento = await CaixaMovimento.findOne({ referenciaPagamento });
    if (!movimento) {
      movimento = await CaixaMovimento.create({
        restauranteId: restId,
        caixaSessaoId: caixa._id || caixa.id,
        operadorId: caixa.operadorId,
        tipo: 'venda',
        valor: recebimento.valor,
        formaPagamento: metodo,
        origem: 'contas_receber',
        pedidoId: conta.pedidoId || null,
        referenciaPagamento,
        descricao: `Recebimento mensalista · ${String(conta.descricao || 'Conta').slice(0, 160)}`,
        data: recebimento.recebidoEm || new Date(),
      });
    }
    recebimento.caixaMovimentoId = movimento._id;
    recebimento.caixaSessaoId = caixa._id || caixa.id;
    await recebimento.save();
    await recomputarConta(conta);
    await recalcularCaixa(caixa._id || caixa.id);
    await registrarAuditoria(req, 'conta_receber.recebida', 'recebimento_conta', recebimento._id, { contaReceberId: conta._id, valor: recebimento.valor, metodo });
    res.status(201).json({ ok: true, conta, recebimento, movimento });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Erro ao registrar recebimento.', code: error.code });
  } finally {
    releaseAccount();
  }
};

exports.cancelarConta = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const conta = await assertConta(req.params.contaId, restId);
    const recebimentos = await RecebimentoConta.countDocuments({ contaReceberId: conta._id, status: 'confirmado' });
    if (recebimentos > 0) return res.status(409).json({ message: 'Uma conta com recebimentos não pode ser cancelada.' });
    conta.status = 'cancelada';
    conta.canceladoEm = new Date();
    conta.canceladoPor = req.userId || null;
    conta.motivoCancelamento = String(req.body.motivo || '').trim();
    await conta.save();
    await registrarAuditoria(req, 'conta_receber.cancelada', 'conta_receber', conta._id, { motivo: conta.motivoCancelamento });
    res.json({ ok: true, conta });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Erro ao cancelar conta.' });
  }
};

exports.extratoCliente = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const cliente = await assertCliente(req.params.clienteId, restId);
    const contas = await ContaReceber.find({ restauranteId: restId, clienteMensalistaId: cliente._id }).sort({ vencimento: -1 }).lean();
    const recebimentos = await RecebimentoConta.find({ restauranteId: restId, clienteMensalistaId: cliente._id }).sort({ recebidoEm: -1 }).lean();
    res.json({ cliente, contas: contas.map((item) => ({ ...item, statusEfetivo: effectiveStatus(item) })), recebimentos });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Erro ao gerar extrato.' });
  }
};

exports.resumo = async (req, res) => {
  try {
    const restId = restauranteId(req);
    const reference = /^\d{4}-\d{2}$/.test(String(req.query.referencia || ''))
      ? String(req.query.referencia)
      : new Date().toISOString().slice(0, 7);
    const [year, month] = reference.split('-').map(Number);
    const nextDate = new Date(year, month, 1, 12, 0, 0);
    const nextReference = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    const [totals] = await queryWithRetry(
      `SELECT
          COALESCE(SUM(CASE WHEN saldo > 0 AND status <> 'cancelada' THEN saldo ELSE 0 END), 0) AS totalAberto,
          COALESCE(SUM(CASE WHEN saldo > 0 AND status <> 'cancelada' AND DATE(vencimento) < CURDATE() THEN saldo ELSE 0 END), 0) AS totalVencido,
          COALESCE(SUM(CASE WHEN saldo > 0 AND status <> 'cancelada' AND DATE_FORMAT(vencimento, '%Y-%m') = ? THEN saldo ELSE 0 END), 0) AS receberMes,
          COALESCE(SUM(CASE WHEN saldo > 0 AND status <> 'cancelada' AND DATE_FORMAT(vencimento, '%Y-%m') = ? THEN saldo ELSE 0 END), 0) AS receberProximoMes,
          COUNT(DISTINCT CASE WHEN saldo > 0 AND status <> 'cancelada' THEN clienteMensalistaId END) AS clientesDevedores
         FROM contas_receber WHERE restauranteId = ?`,
      [reference, nextReference, restId],
      { label: 'financeiro.resumo.contas' }
    );
    const [received] = await queryWithRetry(
      `SELECT COALESCE(SUM(valor), 0) AS recebidoMes FROM recebimentos_conta
        WHERE restauranteId = ? AND status = 'confirmado' AND DATE_FORMAT(recebidoEm, '%Y-%m') = ?`,
      [restId, reference],
      { label: 'financeiro.resumo.recebimentos' }
    );
    const [projection] = await queryWithRetry(
      `SELECT DATE_FORMAT(vencimento, '%Y-%m') AS referencia, COALESCE(SUM(saldo), 0) AS valor
         FROM contas_receber
        WHERE restauranteId = ? AND saldo > 0 AND status <> 'cancelada'
        GROUP BY DATE_FORMAT(vencimento, '%Y-%m') ORDER BY referencia ASC LIMIT 12`,
      [restId],
      { label: 'financeiro.resumo.projecao' }
    );
    res.json({ referencia: reference, proximaReferencia: nextReference, resumo: { ...(totals?.[0] || {}), ...(received?.[0] || {}) }, projecao: projection || [] });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar resumo financeiro.', error: error.message });
  }
};
