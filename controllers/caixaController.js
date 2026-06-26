const OperadorCaixa = require('../models/OperadorCaixa');
const CaixaSessao = require('../models/CaixaSessao');
const CaixaMovimento = require('../models/CaixaMovimento');
const { registrarAuditoria } = require('../utils/audit');
const { formatOperationalDateISO } = require('../utils/operationalDateTime');
const { getCaixaAberto, exigirCaixaAberto, recalcularCaixa, montarCaixaComTotais, round2, toNum, normalizeFormaPagamento } = require('../services/caixaService');
const { queryWithRetry } = require('../lib/mysqlRetry');

function restauranteIdFromReq(req) {
  return req.params.restauranteId || req.body.restauranteId || req.query.restauranteId || req.userId || req.restauranteId;
}

function operadorExigePin(operador) {
  return !!String(operador?.pin || '').trim();
}
function pinConfere(operador, pinInformado) {
  const pin = String(operador?.pin || '').trim();
  if (!pin) return true;
  return String(pinInformado || '').trim() === pin;
}
function operadorPode(operador, permissao){
  const p=operador?.permissoes;
  if(!p || typeof p!=='object') return true;
  return p[permissao] !== false && p[permissao] !== 'false';
}

exports.listarOperadores = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    const operadores = await OperadorCaixa.find({ restauranteId: String(restauranteId) }).sort({ nome: 1 });
    res.json({ operadores });
  } catch (e) { res.status(500).json({ message: 'Erro ao listar operadores.', error: e.message }); }
};

exports.salvarOperador = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    const { nome, apelido, pin, ativo=true, observacao, permissoes={} } = req.body;
    if (!restauranteId) return res.status(400).json({ message: 'restauranteId é obrigatório.' });
    if (!String(nome || '').trim()) return res.status(400).json({ message: 'Nome do operador é obrigatório.' });
    let operador = req.params.operadorId ? await OperadorCaixa.findById(req.params.operadorId) : null;
    if (!operador) operador = new OperadorCaixa({ restauranteId });
    operador.nome = String(nome).trim();
    operador.apelido = String(apelido || '').trim();
    operador.pin = String(pin || '').trim();
    operador.ativo = ativo !== false;
    operador.observacao = String(observacao || '').trim();
    operador.permissoes = permissoes && typeof permissoes === 'object' ? permissoes : {};
    await operador.save();
    await registrarAuditoria(req, req.params.operadorId ? 'operador.atualizado' : 'operador.criado', 'operador', operador._id, { nome:operador.nome, ativo:operador.ativo, permissoes:operador.permissoes });
    res.json({ ok: true, operador });
  } catch (e) { res.status(500).json({ message: 'Erro ao salvar operador.', error: e.message }); }
};

exports.alternarOperador = async (req, res) => {
  try {
    const operador = await OperadorCaixa.findById(req.params.operadorId);
    if (!operador) return res.status(404).json({ message: 'Operador não encontrado.' });
    operador.ativo = req.body.ativo !== undefined ? !!req.body.ativo : !operador.ativo;
    await operador.save();
    await registrarAuditoria(req, 'operador.status_alterado', 'operador', operador._id, { nome:operador.nome, ativo:operador.ativo });
    res.json({ ok: true, operador });
  } catch (e) { res.status(500).json({ message: 'Erro ao alterar operador.', error: e.message }); }
};

const caixaAtualCache = new Map();
const CAIXA_ATUAL_CACHE_MS = Number(process.env.CAIXA_ATUAL_CACHE_MS || 5000);

function invalidarCacheCaixa(restauranteId) {
  if (restauranteId) caixaAtualCache.delete(String(restauranteId));
}

function emitirCaixa(req, restauranteId, evento, caixa) {
  const sala = `restaurante-${restauranteId}`;
  req.io?.to(sala).emit('caixaAtualizado', caixa);
  req.io?.to(sala).emit(evento, { caixa });
  req.io?.to(sala).emit(evento.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), { caixa });
}

exports.caixaAtual = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    if (!restauranteId) return res.status(400).json({ message: 'restauranteId é obrigatório.' });

    const cacheKey = String(restauranteId);
    const cached = caixaAtualCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CAIXA_ATUAL_CACHE_MS && req.query.recalc !== '1') {
      return res.json({ ...cached.data, cache: true });
    }

    const caixa = await getCaixaAberto(restauranteId);
    const atualizado = caixa?._id ? await montarCaixaComTotais(caixa) : null;
    const payload = { aberto: !!atualizado, caixa: atualizado || null };
    caixaAtualCache.set(cacheKey, { ts: Date.now(), data: payload });
    res.json(payload);
  } catch (e) { res.status(500).json({ message: 'Erro ao consultar caixa atual.', error: e.message }); }
};

exports.abrirCaixa = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    const { operadorId, saldoInicial, observacaoAbertura, pin } = req.body;
    const dataOperacional = validarDataISO(req.body.dataOperacional) || hojeLocalISO();
    if (!restauranteId) return res.status(400).json({ message: 'restauranteId é obrigatório.' });
    const aberto = await getCaixaAberto(restauranteId);
    if (aberto) return res.status(409).json({ message: 'Já existe um caixa aberto.', caixa: aberto });
    const operador = await OperadorCaixa.findById(operadorId);
    if (!operador || String(operador.restauranteId) !== String(restauranteId) || operador.ativo === false) {
      return res.status(400).json({ message: 'Selecione um operador ativo para abrir o caixa.' });
    }
    if (!operadorPode(operador,'abrirCaixa')) return res.status(403).json({message:'Este operador não tem permissão para abrir o caixa.',code:'OPERADOR_SEM_PERMISSAO'});
    if (operadorExigePin(operador) && !pinConfere(operador, pin)) {
      return res.status(401).json({ message: 'PIN do operador inválido para abrir o caixa.', code: 'PIN_INVALIDO' });
    }
    const caixa = await CaixaSessao.create({
      restauranteId: String(restauranteId), operadorId: operador._id, operadorNome: operador.nome,
      saldoInicial: round2(toNum(saldoInicial)), status: 'aberto', dataOperacional, abertoEm: new Date(), observacaoAbertura: String(observacaoAbertura || '').trim(),
    });
    invalidarCacheCaixa(restauranteId);
    emitirCaixa(req, restauranteId, 'caixaAberto', caixa);
    await registrarAuditoria(req, 'caixa.aberto', 'caixa', caixa._id, { operadorId, operadorNome:operador.nome, saldoInicial:caixa.saldoInicial });
    res.status(201).json({ ok: true, caixa });
  } catch (e) { res.status(500).json({ message: 'Erro ao abrir caixa.', error: e.message }); }
};

exports.movimentarCaixa = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    const caixa = await exigirCaixaAberto(restauranteId);
    const operador = await OperadorCaixa.findById(caixa.operadorId);
    if (!operadorPode(operador,'movimentarCaixa')) return res.status(403).json({message:'Este operador não tem permissão para sangria ou suprimento.',code:'OPERADOR_SEM_PERMISSAO'});
    const tipo = String(req.body.tipo || '').toLowerCase();
    if (!['sangria','suprimento'].includes(tipo)) return res.status(400).json({ message: 'Tipo deve ser sangria ou suprimento.' });
    const valor = round2(toNum(req.body.valor));
    if (valor <= 0) return res.status(400).json({ message: 'Valor inválido.' });
    const movimento = await CaixaMovimento.create({ restauranteId, caixaSessaoId: caixa._id, operadorId: caixa.operadorId, tipo, valor, formaPagamento: 'dinheiro', origem: 'caixa', descricao: String(req.body.descricao || '').trim() });
    const atualizado = await recalcularCaixa(caixa._id);
    invalidarCacheCaixa(restauranteId);
    emitirCaixa(req, restauranteId, 'caixaMovimentoRegistrado', atualizado);
    await registrarAuditoria(req, `caixa.${tipo}`, 'movimento_caixa', movimento._id, { caixaSessaoId:caixa._id, valor, descricao:movimento.descricao });
    res.json({ ok: true, movimento, caixa: atualizado });
  } catch (e) { res.status(e.status || 500).json({ message: e.message || 'Erro ao movimentar caixa.', code: e.code }); }
};

exports.fecharCaixa = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    const caixa = await exigirCaixaAberto(restauranteId);
    const operador = await OperadorCaixa.findById(caixa.operadorId);
    if (!operadorPode(operador,'fecharCaixa')) return res.status(403).json({message:'Este operador não tem permissão para fechar o caixa.',code:'OPERADOR_SEM_PERMISSAO'});
    if (operadorExigePin(operador) && !pinConfere(operador, req.body.pin)) {
      return res.status(401).json({ message: 'PIN do operador inválido para fechar o caixa.', code: 'PIN_INVALIDO' });
    }
    const doc = await recalcularCaixa(caixa._id);
    doc.status = 'fechado';
    doc.fechadoEm = new Date();
    doc.saldoFinalInformado = round2(toNum(req.body.saldoFinalInformado));
    doc.observacaoFechamento = String(req.body.observacaoFechamento || '').trim();
    doc.fechadoPor = req.userId || req.body.fechadoPor || '';
    await doc.save();
    invalidarCacheCaixa(restauranteId);
    emitirCaixa(req, restauranteId, 'caixaFechado', doc);
    await registrarAuditoria(req, 'caixa.fechado', 'caixa', doc._id, { operadorId:doc.operadorId, operadorNome:doc.operadorNome, saldoFinalInformado:doc.saldoFinalInformado, totalVendas:doc.totalVendas });
    res.json({ ok: true, caixa: doc });
  } catch (e) { res.status(e.status || 500).json({ message: e.message || 'Erro ao fechar caixa.', code: e.code }); }
};

function hojeLocalISO() {
  return formatOperationalDateISO(new Date());
}
function validarDataISO(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function dataLocalISOFromDate(value) {
  return value ? formatOperationalDateISO(value) : '';
}
function dataOperacionalCaixa(caixa) {
  return validarDataISO(caixa?.dataOperacional) || dataLocalISOFromDate(caixa?.abertoEm);
}
function labelDataBR(dataISO) {
  const s = validarDataISO(dataISO);
  if (!s) return '';
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function rangeDatas(query) {
  const start = validarDataISO(query.inicio) || null;
  const end = validarDataISO(query.fim) || null;
  return { start, end };
}
function inRangeDataOperacional(c, start, end) {
  const k = dataOperacionalCaixa(c);
  return (!start || k >= start) && (!end || k <= end);
}

function withId(row = {}) {
  const id = row._id || row.id;
  return { ...row, _id: id, id };
}

function inClause(values = []) {
  return values.map(() => '?').join(',');
}

async function buscarCaixasRelatorio(restauranteId, start, end) {
  const [rows] = await queryWithRetry(
    `SELECT *
       FROM caixa_sessoes
      WHERE restauranteId = ?
      ORDER BY COALESCE(abertoEm, created_at) DESC`,
    [String(restauranteId)],
    { label: 'caixa.relatorios.caixas' }
  );

  return (rows || [])
    .map(withId)
    .filter((caixa) => inRangeDataOperacional(caixa, start, end));
}

async function contarPedidosPorCaixa(restauranteId, caixaIds) {
  const ids = Array.from(new Set((caixaIds || []).map(String).filter(Boolean)));
  if (!ids.length) return new Map();

  const cancelados = ['cancelado', 'cancelada', 'canceled', 'cancelled', 'expirado', 'estornado'];
  const [rows] = await queryWithRetry(
    `SELECT caixaSessaoId, COUNT(*) AS pedidos
       FROM pedidos
      WHERE restaurante = ?
        AND caixaSessaoId IN (${inClause(ids)})
        AND LOWER(COALESCE(status, '')) NOT IN (${inClause(cancelados)})
      GROUP BY caixaSessaoId`,
    [String(restauranteId), ...ids, ...cancelados],
    { label: 'caixa.relatorios.pedidosCount' }
  );

  return new Map((rows || []).map((row) => [String(row.caixaSessaoId || ''), Number(row.pedidos || 0)]));
}

async function listarPedidosRelatorio(restauranteId, caixaIds) {
  const ids = Array.from(new Set((caixaIds || []).map(String).filter(Boolean)));
  if (!ids.length) return [];

  const [rows] = await queryWithRetry(
    `SELECT id, numeroPedido, nomeCliente, formaPagamento, status, statusPagamento,
            total, valorPago, criadoEm, pagoEm, caixaSessaoId
       FROM pedidos
      WHERE restaurante = ?
        AND caixaSessaoId IN (${inClause(ids)})
      ORDER BY COALESCE(pagoEm, criadoEm, created_at) DESC
      LIMIT 300`,
    [String(restauranteId), ...ids],
    { label: 'caixa.relatorios.pedidosPreview' }
  );

  return (rows || []).map(withId);
}

async function listarMovimentosRelatorio(restauranteId, caixaIds) {
  const ids = Array.from(new Set((caixaIds || []).map(String).filter(Boolean)));
  if (!ids.length) return [];

  const [rows] = await queryWithRetry(
    `SELECT *
       FROM caixa_movimentos
      WHERE restauranteId = ?
        AND caixaSessaoId IN (${inClause(ids)})
      ORDER BY COALESCE(data, created_at) DESC
      LIMIT 500`,
    [String(restauranteId), ...ids],
    { label: 'caixa.relatorios.movimentosPreview' }
  );

  return (rows || []).map(withId);
}

exports.relatorios = async (req, res) => {
  try {
    const restauranteId = restauranteIdFromReq(req);
    if (!restauranteId) return res.status(400).json({ message: 'restauranteId e obrigatorio.' });
    const tipo = String(req.query.tipo || 'data').toLowerCase();
    const { start, end } = rangeDatas(req.query);
    let caixas = await buscarCaixasRelatorio(restauranteId, start, end);
    for (const c of caixas) {
      try {
        await recalcularCaixa(c._id || c.id);
      } catch (error) {
        console.warn('caixa.relatorios.recalcular:', c._id || c.id, error?.message || error);
      }
    }

    caixas = await buscarCaixasRelatorio(restauranteId, start, end);
    const caixaIds = caixas.map((c) => String(c._id || c.id)).filter(Boolean);
    const [pedidosPorCaixa, pedidos, movimentos] = await Promise.all([
      contarPedidosPorCaixa(restauranteId, caixaIds),
      listarPedidosRelatorio(restauranteId, caixaIds),
      listarMovimentosRelatorio(restauranteId, caixaIds),
    ]);

    const resumo = { totalVendas:0, dinheiro:0, pix:0, credito:0, debito:0, online:0, outros:0, sangrias:0, suprimentos:0, pedidos:0, caixas: caixas.length };
    const by = new Map();
    const keyFor = (c) => {
      if (tipo === 'caixa') return String(c._id || c.id);
      if (tipo === 'operador') return String(c.operadorId || 'sem_operador');
      return dataOperacionalCaixa(c) || 'sem_data';
    };
    const labelFor = (c) => tipo === 'caixa' ? `Caixa ${String(c._id || c.id).slice(-6)}` : tipo === 'operador' ? (c.operadorNome || 'Sem operador') : (labelDataBR(dataOperacionalCaixa(c)) || 'Sem data');
    for (const c of caixas) {
      const k = keyFor(c);
      if (!by.has(k)) by.set(k, { chave:k, label:labelFor(c), caixas:0, pedidos:0, totalVendas:0, dinheiro:0, pix:0, credito:0, debito:0, online:0, outros:0, sangrias:0, suprimentos:0 });
      const row = by.get(k); row.caixas += 1;
      const totalPedidosCaixa = Number(pedidosPorCaixa.get(String(c._id || c.id)) || 0);
      row.pedidos += totalPedidosCaixa;
      resumo.pedidos += totalPedidosCaixa;
      const vals = { totalVendas:c.totalVendas, dinheiro:c.totalDinheiro, pix:c.totalPix, credito:c.totalCredito, debito:c.totalDebito, online:c.totalOnline, outros:c.totalOutros, sangrias:c.totalSangrias, suprimentos:c.totalSuprimentos };
      for (const [kk,v] of Object.entries(vals)) { row[kk] = round2(row[kk]+toNum(v)); resumo[kk] = round2(resumo[kk]+toNum(v)); }
    }
    res.json({ tipo, resumo, linhas: [...by.values()], caixas, pedidos, movimentos });
  } catch (e) { res.status(500).json({ message: 'Erro ao gerar relatório de caixa.', error: e.message }); }
};
