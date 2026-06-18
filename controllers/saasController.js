const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Restaurante = require('../models/Restaurante');
const PlanoSaas = require('../models/PlanoSaas');
const AdminSaas = require('../models/AdminSaas');
const Pedido = require('../models/Pedido');
const Produto = require('../models/Produto');
const CategoriaProduto = require('../models/CategoriaProduto');
const Mesa = require('../models/mesaModel');
const PedidoMesa = require('../models/pedidoMesaModel');
const CaixaSessao = require('../models/CaixaSessao');
const CaixaMovimento = require('../models/CaixaMovimento');
const OperadorCaixa = require('../models/OperadorCaixa');
const Entregador = require('../models/Entregador');
const EntregadorOnline = require('../models/EntregadorOnline');
const Insumo = require('../models/Insumo');
const MovimentoEstoque = require('../models/MovimentoEstoque');
const Receita = require('../models/Receita');
const PushSubscription = require('../models/PushSubscription');
const { pool, testConnection } = require('../db/mysql');
const apiMonitor = require('../utils/apiMonitor');
const AuditLog = require('../models/AuditLog');
const { registrarAuditoria } = require('../utils/audit');

const PLANOS_PADRAO = [
  { codigo:'free', nome:'Free', valorMensal:0, ordem:1, descricao:'Plano gratuito inicial para novos restaurantes.', recursos:['Cadastro inicial','Teste controlado','Recursos limitados'] },
  { codigo:'starter-mobile', nome:'Start Mobile', valorMensal:69.90, ordem:2, descricao:'Gestão completa pelo celular.', recursos:['Dashboard mobile','Produtos e categorias','Mesas','Caixa','Balcão','2 garçons'] },
  { codigo:'essencial', nome:'Essencial', valorMensal:129.90, ordem:3, descricao:'Operação profissional com desktop e caixa.', recursos:['Tudo do Start Mobile','Sistema Desktop','Controle de caixa','Relatórios avançados','Até 3 acessos'] },
  { codigo:'professional', nome:'Professional', valorMensal:199.90, ordem:4, descricao:'Gestão completa com entregas e app motorista.', recursos:['Tudo do Essencial','App Motorista/Entregador','Gestão de entregadores','Cozinha integrada','Suporte prioritário'] },
  { codigo:'premium', nome:'Premium', valorMensal:299.90, ordem:5, descricao:'Todas as funcionalidades comerciais liberadas.', recursos:['Todas as funcionalidades','Dashboard executivo','Relatórios corporativos','Prioridade máxima'] },
  { codigo:'full', nome:'Full SaaS Admin', valorMensal:0, ordem:6, descricao:'Plano interno administrativo sem limitações.', recursos:['Sem limites','Administração SaaS','Demonstrações','Homologação','Suporte interno'] }
];

function signAdmin(payload){ return jwt.sign(payload, process.env.JWT_SECRET || 'movyo-dev-secret', { expiresIn:'8h' }); }

const ADMIN_INICIAL_EMAIL = String(process.env.SAAS_ADMIN_INICIAL_EMAIL || '').trim().toLowerCase();
const ADMIN_INICIAL_SENHA = String(process.env.SAAS_ADMIN_INICIAL_SENHA || '');

function publicAdmin(a={}){
  const o = typeof a.toObject === 'function' ? a.toObject() : a;
  return { id:o.id || o._id, nome:o.nome || 'Administrador Movyo SaaS', email:o.email, tipo:o.tipo || 'full', ativo:o.ativo !== false };
}

async function ensureAdminInicial(){
  if (ADMIN_INICIAL_EMAIL) {
    const existing = await AdminSaas.findOne({ email: ADMIN_INICIAL_EMAIL });
    if (existing) return existing;
  }
  if (!ADMIN_INICIAL_EMAIL || !ADMIN_INICIAL_SENHA) {
    throw new Error('Configure SAAS_ADMIN_INICIAL_EMAIL e SAAS_ADMIN_INICIAL_SENHA para criar o primeiro administrador.');
  }
  const senhaHash = await bcrypt.hash(ADMIN_INICIAL_SENHA, 10);
  return AdminSaas.create({
    nome: 'Helio Desenvolvimento',
    email: ADMIN_INICIAL_EMAIL,
    senha: senhaHash,
    tipo: 'full',
    ativo: true
  });
}
function parseLocalDateInput(v, endOfDay=false){
  if(!v) return null;
  if(v instanceof Date) return new Date(v.getTime());
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function parseDate(v){ return parseLocalDateInput(v, false); }
function normalizePlano(v){ return String(v || 'free').trim().toLowerCase(); }
function isPlanoFree(plano){ return normalizePlano(plano) === 'free'; }
function prazoPlanoDias(plano, fallback=30){ return isPlanoFree(plano) ? 7 : Number(fallback || 30); }
function statusPadraoPlano(plano, informado){ return informado || (isPlanoFree(plano) ? 'teste' : 'ativo'); }

function addDays(date, days){ const d = new Date(date || Date.now()); d.setDate(d.getDate() + Number(days || 0)); return d; }
function startOfDayValue(v){ const d = parseLocalDateInput(v, false) || new Date(); d.setHours(0,0,0,0); return d; }
function endOfDayValue(v){ const d = parseLocalDateInput(v, true) || new Date(); d.setHours(23,59,59,999); return d; }
function inDateRange(v, inicio, fim){ const d = parseLocalDateInput(v, false); if(!d || isNaN(d.getTime())) return false; return d >= inicio && d <= fim; }
function filterDateRange(arr, inicio, fim, fields=['pagoEm','criadoEm','createdAt','data']){
  return (arr || []).filter(item => fields.some(f => inDateRange(item?.[f], inicio, fim)));
}
async function bloquearVencidos(){
  const [result] = await pool.query(`
    UPDATE restaurantes
       SET ativo = 0,
           statusAssinatura = 'bloqueado',
           sessaoVersao = COALESCE(sessaoVersao, 1) + 1,
           updated_at = NOW()
     WHERE dataFimPlano IS NOT NULL
       AND dataFimPlano < CURDATE()
       AND LOWER(COALESCE(statusAssinatura, 'ativo')) NOT IN ('bloqueado','cancelado')
  `);
  return Number(result?.affectedRows || 0);
}

function sqlDate(d){
  const v = d instanceof Date ? d : parseLocalDateInput(d, false);
  if (!v || isNaN(v.getTime())) return null;
  // Importante: usar horário LOCAL do servidor, não UTC/toISOString.
  // Evita o filtro 10/06 virar 09/06 ou deslocar o range em ambientes com timezone diferente.
  const pad = (n) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
}
function dateOnlyISO(d){
  const v = d instanceof Date ? d : parseLocalDateInput(d, false);
  if (!v || isNaN(v.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
}
const SQL_VENDA_CONFIRMADA = `
  LOWER(COALESCE(statusPagamento,'')) IN ('pago','paga','paid','aprovado','aprovada','approved','concluido','concluído')
  OR LOWER(COALESCE(status,'')) IN ('pago','paga','paid','aprovado','aprovada','approved','em_producao','em_produção','em produção','preparando','em_preparo','em entrega','em_entrega','entregue','concluido','concluído','finalizado','finalizada')
`;
function idFilter(column, id){
  return id ? { sql:` AND ${column} = ?`, params:[String(id)] } : { sql:'', params:[] };
}
function dateFilter(expr, inicio, fim){
  return { sql:` AND ${expr} BETWEEN ? AND ?`, params:[sqlDate(inicio), sqlDate(fim)] };
}
async function sqlOne(query, params=[]){
  const [rows] = await pool.query(query, params);
  return rows?.[0] || {};
}
async function sqlScalar(query, params=[], key='total'){
  const row = await sqlOne(query, params);
  return Number(row?.[key] || 0);
}

async function tableColumns(table){
  try {
    const [rows] = await pool.query(`SHOW COLUMNS FROM ${table}`);
    return new Set((rows || []).map((r) => r.Field));
  } catch {
    return new Set();
  }
}
function coalesceExisting(columns, candidates, fallback){
  const existing = candidates.filter((c) => columns.has(c));
  if (!existing.length) return fallback;
  return existing.length === 1 ? existing[0] : `COALESCE(${existing.join(', ')})`;
}


function startOfToday(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function endOfToday(){ const d = new Date(); d.setHours(23,59,59,999); return d; }
function isToday(v){ const d = v ? new Date(v) : null; if(!d || isNaN(d.getTime())) return false; return d >= startOfToday() && d <= endOfToday(); }
function num(v){ return Number(v || 0); }
function docId(v){ return String(v?._id || v?.id || v || ''); }
function belongsToRestaurante(doc, rid){ return String(doc.restaurante || doc.restauranteId || doc.restaurante_id || '') === String(rid); }

async function ensurePlanosPadrao(){
  for (const p of PLANOS_PADRAO) {
    const existing = await PlanoSaas.findOne({ codigo:p.codigo });
    if (!existing) await PlanoSaas.create(p);
  }
}

function publicRestaurante(r={}){
  const o = typeof r.toObject === 'function' ? r.toObject() : r;
  delete o.senha;
  return {
    ...o,
    id: o.id || o._id,
    plano: o.plano || 'free',
    statusAssinatura: o.statusAssinatura || 'ativo',
    dataInicioPlano: o.dataInicioPlano || null,
    dataFimPlano: o.dataFimPlano || null,
    sessaoVersao: Number(o.sessaoVersao || 1),
  };
}

function normalizeFormaPagamento(v){
  const s = String(v || 'outros').trim().toLowerCase();
  if (s.includes('pix')) return 'pix';
  if (s.includes('din')) return 'dinheiro';
  if (s.includes('deb')) return 'debito';
  if (s.includes('cred') || s.includes('créd')) return 'credito';
  if (s.includes('cart')) return 'cartao';
  if (s.includes('online')) return 'online';
  return s || 'outros';
}
function extractItensPedido(p){
  const raw = p?.itens || [];
  if (Array.isArray(raw)) return raw;
  try { const parsed = JSON.parse(String(raw || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function itemNome(i){ return i?.nome || i?.produtoNome || i?.produto?.nome || i?.descricao || 'Produto sem nome'; }
function itemQtd(i){ return Number(i?.quantidade || i?.qtd || i?.qty || 1) || 1; }
function parseStatusBot(r){
  const st = r?.statusBot;
  if (!st) return { ligado:false, estado:'desconhecido' };
  if (typeof st === 'object') return st;
  try { return JSON.parse(String(st)); } catch { return { ligado:false, estado:String(st) }; }
}
function safeObject(value, fallback={}){
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function boolLike(value, defaultValue=false){
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['true','1','sim','yes','on','ligado','ativo','conectado'].includes(s)) return true;
  if (['false','0','nao','no','off','desligado','inativo','desconectado'].includes(s)) return false;
  return defaultValue;
}
function matchesRestaurante(doc, rid){ return !rid || belongsToRestaurante(doc, rid); }
function isDocInRange(doc, inicio, fim, fields){
  return fields.some((field) => inDateRange(doc?.[field], inicio, fim));
}

function caixaSessaoIntersectsPeriodo(c, inicio, fim){
  if (!c) return false;
  const aberto = parseLocalDateInput(c.abertoEm || c.createdAt || c.dataOperacional, false);
  const fechado = parseLocalDateInput(c.fechadoEm, true);
  const dataOperacional = parseLocalDateInput(c.dataOperacional, false);
  if (aberto && !isNaN(aberto.getTime())) {
    const fimCaixa = fechado && !isNaN(fechado.getTime()) ? fechado : new Date(8640000000000000);
    return aberto <= fim && fimCaixa >= inicio;
  }
  return !!dataOperacional && dataOperacional >= inicio && dataOperacional <= fim;
}
function caixaSessaoLabel(c){
  const id = docId(c);
  const data = c?.dataOperacional || dateOnlyISO(c?.abertoEm) || 'sem-data';
  const operador = c?.operadorNome ? ` - ${c.operadorNome}` : '';
  return `${data} / Caixa ${id.slice(-6)}${operador}`;
}
function pedidoCaixaLabel(p, caixaMap){
  const caixaId = String(p?.caixaSessaoId || '');
  const caixa = caixaId ? caixaMap.get(caixaId) : null;
  return caixa ? caixaSessaoLabel(caixa) : 'Sem caixa vinculado';
}

function sumValues(rows, picker){
  return (rows || []).reduce((acc, row) => acc + Number(picker(row) || 0), 0);
}
function restauranteNomeMap(restaurantes=[]){
  return new Map((restaurantes || []).map((r) => [docId(r), r.nome || `Restaurante ${docId(r).slice(-6)}`]));
}
function getRestauranteNome(map, restauranteId){
  return map.get(String(restauranteId || '')) || (restauranteId ? `Restaurante ${String(restauranteId).slice(-6)}` : 'Sem restaurante');
}
function getInsumoQtdBase(insumo){ return Number(insumo?.estoqueAtualBase ?? insumo?.quantidadeBase ?? 0); }
function getInsumoMinimoBase(insumo){ return Number(insumo?.estoqueMinimoBase ?? insumo?.minimoBase ?? 0); }
function getInsumoCustoBase(insumo){ return Number(insumo?.custoMedioBase ?? insumo?.costBase ?? 0); }
function calcProducaoReceita(receita, insumoMap){
  const itens = Array.isArray(receita?.itens) ? receita.itens : safeObject(receita?.itens, []);
  const detalhes = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const insumo = insumoMap.get(String(item?.insumoId || item?.insumo || ''));
    const consumo = Number(item?.consumoBasePorUn || item?.quantidadeBase || item?.quantidade || 0);
    if (!insumo || consumo <= 0) continue;
    const estoque = getInsumoQtdBase(insumo);
    detalhes.push({
      insumoId: docId(insumo),
      nome: insumo.nome,
      baseUnit: insumo.baseUnit || insumo.unidadePadrao || '',
      estoqueBase: estoque,
      consumoBasePorUn: consumo,
      maxPorInsumo: Math.floor(estoque / consumo)
    });
  }
  detalhes.sort((a,b) => a.maxPorInsumo - b.maxPorInsumo);
  return {
    produzAte: detalhes.length ? Math.max(0, detalhes[0].maxPorInsumo) : 0,
    gargalo: detalhes[0] || null,
    detalhes
  };
}
function isStatusCanceladoPedido(p){
  const st = String(p?.status || '').toLowerCase();
  const sp = String(p?.statusPagamento || '').toLowerCase();
  return ['cancelado','cancelada','expirado','estornado'].includes(st) || ['cancelado','cancelada','expirado','estornado'].includes(sp);
}
function isStatusPagamentoConfirmado(p){
  const sp = String(p?.statusPagamento || '').toLowerCase();
  return ['pago','paga','paid','aprovado','aprovada','approved','concluido','concluído'].includes(sp);
}
function isVendaConfirmada(p){
  if (!p || isStatusCanceladoPedido(p)) return false;
  if (isStatusPagamentoConfirmado(p)) return true;
  const st = String(p?.status || '').trim().toLowerCase();
  return ['pago','paga','paid','aprovado','aprovada','approved','em_producao','em_produção','em produção','preparando','em_preparo','em entrega','em_entrega','entregue','concluido','concluído','finalizado','finalizada'].includes(st);
}
function isStatusOperacionalAberto(p){
  const st = String(p?.status || '').toLowerCase();
  return ['novo','pendente','aberto','em_aberto','preparando','em_preparo','em_producao','em_produção','producao','produção'].includes(st);
}
function dataPedidoOperacional(p){
  // Para filtros do Dashboard SaaS/Operação, a data verdadeira do pedido é `criadoEm`.
  // Não usar `createdAt/created_at` como fallback aqui, pois registros antigos/migrados podem
  // receber created_at do dia da migração e inflar vendas/pedidos do dia atual.
  return p?.criadoEm || null;
}
function isPedidoNoPeriodo(p, inicio, fim){
  if (!p || isStatusCanceladoPedido(p)) return false;
  const d = dataPedidoOperacional(p);
  return !!d && inDateRange(d, inicio, fim);
}
function dataVendaPedido(p){
  // Relatórios financeiros podem usar a data de pagamento quando existir.
  // Se não houver pagoEm, usa criadoEm apenas se o pedido não estiver cancelado.
  if (!p || isStatusCanceladoPedido(p)) return null;
  return p?.pagoEm || p?.criadoEm || null;
}
function isVendaPedidoNoPeriodo(p, inicio, fim){
  const d = dataVendaPedido(p);
  return !!d && inDateRange(d, inicio, fim);
}

async function pedidosPeriodoQuery(restauranteId, inicio, fim, caixaIds=[]){
  const rest = restauranteId ? ' AND restaurante = ?' : '';
  const params = restauranteId ? [String(restauranteId)] : [];
  const ids = Array.from(new Set((caixaIds || []).map(String).filter(Boolean)));
  let filtroPeriodo = 'COALESCE(pagoEm, criadoEm) BETWEEN ? AND ?';
  if (ids.length) {
    filtroPeriodo = `(caixaSessaoId IN (${ids.map(() => '?').join(',')}) OR ((caixaSessaoId IS NULL OR caixaSessaoId = '') AND COALESCE(pagoEm, criadoEm) BETWEEN ? AND ?))`;
    params.push(...ids, sqlDate(inicio), sqlDate(fim));
  } else {
    params.push(sqlDate(inicio), sqlDate(fim));
  }
  // Prioridade: sessão de caixa. Assim um caixa que abriu no dia 16 e fechou no dia 17
  // permanece inteiro no mesmo relatório, sem dividir pedidos por virada de data.
  const [rows] = await pool.query(`
    SELECT * FROM pedidos
     WHERE 1=1${rest}
       AND ${filtroPeriodo}
       AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
       AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
     ORDER BY COALESCE(pagoEm, criadoEm) DESC
  `, params);
  return (rows || []).filter(isVendaConfirmada);
}

module.exports = {
  async login(req,res){
    try{
      await ensureAdminInicial();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const senha = String(req.body?.senha || req.body?.password || '');
      const admin = await AdminSaas.findOne({ email });
      if(!admin || admin.ativo === false) return res.status(401).json({ mensagem:'Login SaaS inválido.' });
      const okSenha = await bcrypt.compare(senha, admin.senha || '');
      if(!okSenha) return res.status(401).json({ mensagem:'Login SaaS inválido.' });
      await AdminSaas.findByIdAndUpdate(admin._id || admin.id, { $set:{ ultimoLoginEm:new Date() } });
      return res.json({ token: signAdmin({ tipo:'saas-admin', adminId:admin._id || admin.id, email:admin.email, perfil:admin.tipo || 'full' }), admin: publicAdmin(admin) });
    }catch(e){ console.error('saas login:',e); return res.status(500).json({ mensagem:'Erro no login SaaS.' }); }
  },
  async seedAdmin(req,res){
    try{
      const admin = await ensureAdminInicial();
      return res.json({ ok:true, admin: publicAdmin(admin), mensagem:'Admin SaaS inicial verificado/criado.' });
    }catch(e){ console.error('seed admin saas:',e); return res.status(500).json({ mensagem:'Erro ao criar admin inicial.', erro:e.message }); }
  },
  async seedPlanos(req,res){ await ensurePlanosPadrao(); res.json({ ok:true, planos: await PlanoSaas.find({}).sort({ordem:1}).lean() }); },
  async listarPlanos(req,res){ await ensurePlanosPadrao(); res.json(await PlanoSaas.find({}).sort({ordem:1}).lean()); },
  async salvarPlano(req,res){
    try{
      await ensurePlanosPadrao();
      const codigo = normalizePlano(req.params.codigo || req.body.codigo);
      const payload = {
        codigo,
        nome: req.body.nome || codigo,
        valorMensal: Number(req.body.valorMensal ?? req.body.preco ?? 0),
        descricao: req.body.descricao || '',
        recursos: Array.isArray(req.body.recursos) ? req.body.recursos : String(req.body.recursos || '').split('\n').map(s=>s.trim()).filter(Boolean),
        ativo: req.body.ativo !== false,
        ordem: Number(req.body.ordem || 0)
      };
      const plano = await PlanoSaas.findOne({ codigo });
      if(plano){ await PlanoSaas.findByIdAndUpdate(plano._id || plano.id, { $set: payload }); return res.json(await PlanoSaas.findOne({codigo}).lean()); }
      return res.status(201).json(await PlanoSaas.create(payload));
    }catch(e){ console.error('salvar plano:',e); return res.status(500).json({ mensagem:'Erro ao salvar plano.', erro:e.message }); }
  },
  async listarRestaurantes(req,res){
    const q = String(req.query.q || '').toLowerCase();
    const rows = await Restaurante.find({}).sort({created_at:-1}).lean();
    const filtrados = !q ? rows : rows.filter(r => `${r.nome||''} ${r.email||''} ${r.slugIdentificador||''} ${r.plano||''}`.toLowerCase().includes(q));
    res.json(filtrados.map(publicRestaurante));
  },
  async criarRestaurante(req,res){
    try{
      const senha = req.body.senha || 'movyo123';
      const senhaHash = await bcrypt.hash(String(senha), 10);
      const planoNormalizado = normalizePlano(req.body.plano || 'free');
      const inicioPlano = parseDate(req.body.dataInicioPlano) || new Date();
      const fimPlano = parseDate(req.body.dataFimPlano) || (isPlanoFree(planoNormalizado) ? addDays(inicioPlano, 7) : null);
      const payload = {
        nome: req.body.nome,
        email: String(req.body.email || '').trim().toLowerCase(),
        senha: senhaHash,
        cnpj: req.body.cnpj || '',
        telefone: req.body.telefone || '',
        slugIdentificador: String(req.body.slugIdentificador || req.body.slug || req.body.nome || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''),
        enderecoCidade: req.body.enderecoCidade || req.body.cidade || '',
        enderecoBairro: req.body.enderecoBairro || req.body.bairro || '',
        plano: planoNormalizado,
        statusAssinatura: statusPadraoPlano(planoNormalizado, req.body.statusAssinatura),
        dataInicioPlano: inicioPlano,
        dataFimPlano: fimPlano,
        observacaoPlano: req.body.observacaoPlano || '',
        ativo: req.body.ativo !== false,
        emailCobranca: String(req.body.emailCobranca || req.body.email_cobranca || req.body.email || '').trim().toLowerCase(),
        taxaConvenienciaPix: Number(req.body.taxaConvenienciaPix ?? 0.5),
        descontoMensalidadePercentual: Number(req.body.descontoMensalidadePercentual ?? 0),
        valorMensalidadeCustomizado: Number(req.body.valorMensalidadeCustomizado ?? 0),
      };
      if(!payload.nome || !payload.email) return res.status(400).json({ mensagem:'Nome e email são obrigatórios.' });
      const exists = await Restaurante.findOne({ email: payload.email });
      if(exists) return res.status(409).json({ mensagem:'Email já cadastrado.' });
      const novo = await Restaurante.create(payload);
      res.status(201).json(publicRestaurante(novo));
    }catch(e){ console.error('criar restaurante saas:',e); res.status(500).json({ mensagem:'Erro ao criar restaurante.', erro:e.message }); }
  },
  async atualizarRestaurante(req,res){
    try{
      const id = req.params.id;
      const allowed = ['nome','email','cnpj','telefone','slugIdentificador','enderecoCidade','enderecoBairro','plano','statusAssinatura','dataInicioPlano','dataFimPlano','observacaoPlano','emailCobranca','ativo','sessaoVersao','taxaConvenienciaPix','descontoMensalidadePercentual','valorMensalidadeCustomizado'];
      const update = {};
      for (const k of allowed) if (Object.prototype.hasOwnProperty.call(req.body,k)) update[k]=req.body[k];
      if(update.plano) update.plano = normalizePlano(update.plano);
      if(update.dataInicioPlano) update.dataInicioPlano = parseDate(update.dataInicioPlano);
      if(update.dataFimPlano) update.dataFimPlano = parseDate(update.dataFimPlano);
      ['taxaConvenienciaPix','descontoMensalidadePercentual','valorMensalidadeCustomizado'].forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(update, k)) {
          const n = Number(String(update[k] ?? 0).replace(',', '.'));
          update[k] = Number.isFinite(n) ? Math.max(0, n) : 0;
        }
      });
      if(update.plano && isPlanoFree(update.plano)){
        const inicioFree = update.dataInicioPlano || new Date();
        update.statusAssinatura = statusPadraoPlano(update.plano, update.statusAssinatura);
        update.dataInicioPlano = inicioFree;
        update.dataFimPlano = update.dataFimPlano || addDays(inicioFree, 7);
      }
      const exigeLogout = ['plano','statusAssinatura','dataInicioPlano','dataFimPlano','ativo'].some(k => Object.prototype.hasOwnProperty.call(update,k));
      await Restaurante.findByIdAndUpdate(id, exigeLogout ? { $set:update, $inc:{ sessaoVersao:1 } } : { $set:update });
      res.json(publicRestaurante(await Restaurante.findById(id).lean()));
    }catch(e){ console.error('atualizar restaurante saas:',e); res.status(500).json({ mensagem:'Erro ao atualizar restaurante.', erro:e.message }); }
  },
  async liberarTeste(req,res){
    const dias = Number(req.body.dias || 7);
    const inicio = new Date();
    const fim = addDays(inicio, dias);
    await Restaurante.findByIdAndUpdate(req.params.id, { $set:{ statusAssinatura:'teste', dataInicioPlano:inicio, dataFimPlano:fim, ativo:true, observacaoPlano:req.body.observacaoPlano || 'Teste liberado pelo SaaS' }, $inc:{ sessaoVersao:1 } });
    res.json(publicRestaurante(await Restaurante.findById(req.params.id).lean()));
  },
  async liberarPlano(req,res){
    const plano = normalizePlano(req.body.plano || 'starter-mobile');
    const inicio = parseDate(req.body.dataInicioPlano) || new Date();
    const fim = parseDate(req.body.dataFimPlano) || addDays(inicio, prazoPlanoDias(plano, req.body.dias || 30));
    await Restaurante.findByIdAndUpdate(req.params.id, { $set:{ plano, statusAssinatura:statusPadraoPlano(plano, req.body.statusAssinatura), dataInicioPlano:inicio, dataFimPlano:fim, ativo:true, observacaoPlano:req.body.observacaoPlano || '' }, $inc:{ sessaoVersao:1 } });
    res.json(publicRestaurante(await Restaurante.findById(req.params.id).lean()));
  },
  async overview(req,res){
    const t0 = Date.now();
    try{
      await ensurePlanosPadrao();
      await bloquearVencidos();

      const restauranteFiltro = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicioFiltro = req.query.dataInicio || req.query.data || null;
      const fimFiltro = req.query.dataFim || req.query.data || null;
      const inicio = inicioFiltro ? startOfDayValue(inicioFiltro) : startOfToday();
      const fim = fimFiltro ? endOfDayValue(fimFiltro) : endOfToday();

      const restWhere = idFilter('id', restauranteFiltro);
      const pedidoRestWhere = idFilter('restaurante', restauranteFiltro);
      const caixaRestWhere = idFilter('restauranteId', restauranteFiltro);
      const mesaRestWhere = idFilter('restauranteId', restauranteFiltro);
      const produtoRestWhere = idFilter('restaurante', restauranteFiltro);
      const operadorRestWhere = idFilter('restauranteId', restauranteFiltro);
      const entregadorRestWhere = idFilter('restaurante', restauranteFiltro);
      // Vendas/Pedidos no período do SaaS são filtrados pela data operacional `criadoEm`.
      // Não usar created_at/updated_at nem pagoEm como filtro principal, para não puxar pedido antigo/migrado.
      const pedidoDateSql = ` AND COALESCE(pagoEm, criadoEm) BETWEEN ? AND ?`;
      const pedidoDateParams = [sqlDate(inicio), sqlDate(fim)];

      const [
        planos,
        totalRestaurantes,
        restaurantesAtivos,
        restaurantesBloqueados,
        mrrRow,
        vencendo7,
        pedidosRow,
        caixasAbertos,
        produtos,
        mesas,
        operadores,
        entregadores,
        porPlanoRows,
        porStatusRows
      ] = await Promise.all([
        PlanoSaas.find({}).sort({ordem:1}).lean(),
        sqlScalar(`SELECT COUNT(*) total FROM restaurantes WHERE 1=1${restWhere.sql}`, restWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM restaurantes WHERE COALESCE(ativo,1) <> 0${restWhere.sql}`, restWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM restaurantes WHERE (COALESCE(ativo,1) = 0 OR LOWER(COALESCE(statusAssinatura,'')) = 'bloqueado')${restWhere.sql}`, restWhere.params),
        sqlOne(`
          SELECT COALESCE(SUM(COALESCE(p.valorMensal,0)),0) mrr
            FROM restaurantes r
            LEFT JOIN planos_saas p ON p.codigo = COALESCE(r.plano, 'free')
           WHERE COALESCE(r.ativo,1) <> 0
             AND LOWER(COALESCE(r.statusAssinatura,'ativo')) NOT IN ('bloqueado','cancelado','vencido')
             ${restWhere.sql.replace(/id/g, 'r.id')}
        `, restWhere.params),
        sqlScalar(`
          SELECT COUNT(*) total
            FROM restaurantes
           WHERE dataFimPlano IS NOT NULL
             AND dataFimPlano >= NOW()
             AND dataFimPlano <= DATE_ADD(NOW(), INTERVAL 7 DAY)
             ${restWhere.sql}
        `, restWhere.params),
        sqlOne(`
          SELECT COUNT(*) pedidosHoje, COALESCE(SUM(COALESCE(total,0)),0) vendasHoje
            FROM pedidos
           WHERE 1=1${pedidoRestWhere.sql}${pedidoDateSql}
             AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND (${SQL_VENDA_CONFIRMADA})
        `, [...pedidoRestWhere.params, ...pedidoDateParams]),
        sqlScalar(`SELECT COUNT(*) total FROM caixa_sessoes WHERE LOWER(COALESCE(status,''))='aberto'${caixaRestWhere.sql}`, caixaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM produtos WHERE 1=1${produtoRestWhere.sql}`, produtoRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM mesas WHERE 1=1${mesaRestWhere.sql}`, mesaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM operadores_caixa WHERE 1=1${operadorRestWhere.sql}`, operadorRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM entregadores WHERE 1=1${entregadorRestWhere.sql}`, entregadorRestWhere.params),
        pool.query(`SELECT COALESCE(plano,'free') plano, COUNT(*) total FROM restaurantes WHERE 1=1${restWhere.sql} GROUP BY COALESCE(plano,'free')`, restWhere.params).then(([rows])=>rows),
        pool.query(`SELECT COALESCE(statusAssinatura,'ativo') status, COUNT(*) total FROM restaurantes WHERE 1=1${restWhere.sql} GROUP BY COALESCE(statusAssinatura,'ativo')`, restWhere.params).then(([rows])=>rows)
      ]);

      const porPlano = Object.fromEntries((porPlanoRows || []).map(r => [r.plano || 'free', Number(r.total || 0)]));
      const porStatus = Object.fromEntries((porStatusRows || []).map(r => [r.status || 'ativo', Number(r.total || 0)]));

      const payload = {
        totalRestaurantes,
        restaurantesAtivos,
        restaurantesBloqueados,
        mrr: Number(mrrRow?.mrr || 0),
        vencendo7,
        pedidosHoje: Number(pedidosRow?.pedidosHoje || 0),
        vendasHoje: Number(pedidosRow?.vendasHoje || 0),
        caixasAbertos,
        produtos,
        mesas,
        operadores,
        entregadores,
        porPlano,
        porStatus,
        planos,
        performanceMs: Date.now() - t0
      };
      return res.json(payload);
    }catch(e){ console.error('saas overview:',e); res.status(500).json({mensagem:'Erro ao carregar visão geral SaaS.', erro:e.message}); }
  },
  async operacao(req,res){
    const started = Date.now();
    try{
      const rid = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = req.query.dataInicio || req.query.data ? startOfDayValue(req.query.dataInicio || req.query.data) : startOfToday();
      const fim = req.query.dataFim || req.query.data ? endOfDayValue(req.query.dataFim || req.query.data) : endOfToday();
      const inicioSql = sqlDate(inicio);
      const fimSql = sqlDate(fim);
      const pedidoColumns = await tableColumns('pedidos');
      const pedidoDataExpr = coalesceExisting(pedidoColumns, ['criadoEm','createdAt','created_at','data'], 'criadoEm');
      const vendaDataExpr = pedidoColumns.has('pagoEm') ? `COALESCE(pagoEm, ${pedidoDataExpr})` : pedidoDataExpr;
      const pedidoOrderExpr = coalesceExisting(pedidoColumns, ['criadoEm','createdAt','created_at','data'], pedidoDataExpr);
      const pedidoIdExpr = coalesceExisting(pedidoColumns, ['id','_id'], 'id');

      const pedidoRestWhere = idFilter('restaurante', rid);
      const caixaRestWhere = idFilter('restauranteId', rid);
      const produtoRestWhere = idFilter('restaurante', rid);
      const categoriaRestWhere = idFilter('restaurante', rid);
      const mesaRestWhere = idFilter('restauranteId', rid);
      const pedidoMesaRestWhere = idFilter('restauranteId', rid);
      const operadorRestWhere = idFilter('restauranteId', rid);
      const entregadorRestWhere = idFilter('restaurante', rid);
      const movimentoRestWhere = idFilter('restauranteId', rid);
      const notCanceledSql = `
        AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
        AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
      `;

      const [
        restaurantes,
        pedidosPeriodoRow,
        vendasPeriodoRow,
        pedidosPendentes,
        caixasAbertos,
        produtosAtivos,
        categoriasAtivas,
        mesasOcupadas,
        mesasAbertas,
        operadoresAtivos,
        entregadoresAtivos,
        caixaHojeRow,
        recentesRows
      ] = await Promise.all([
        Restaurante.find({}).lean(),
        sqlOne(`
          SELECT COUNT(*) pedidosHoje
            FROM pedidos
           WHERE 1=1${pedidoRestWhere.sql}
             AND ${pedidoDataExpr} BETWEEN ? AND ?
             ${notCanceledSql}
        `, [...pedidoRestWhere.params, inicioSql, fimSql]),
        sqlOne(`
          SELECT COUNT(*) quantidadeVendas, COALESCE(SUM(COALESCE(total,0)),0) vendasHoje
            FROM pedidos
           WHERE 1=1${pedidoRestWhere.sql}
             AND ${vendaDataExpr} BETWEEN ? AND ?
             ${notCanceledSql}
             AND (${SQL_VENDA_CONFIRMADA})
        `, [...pedidoRestWhere.params, inicioSql, fimSql]),
        sqlScalar(`
          SELECT COUNT(*) total
            FROM pedidos
           WHERE 1=1${pedidoRestWhere.sql}
             AND LOWER(COALESCE(status,'')) IN ('pendente','novo','preparando','em_preparo')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
        `, pedidoRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM caixa_sessoes WHERE LOWER(COALESCE(status,''))='aberto'${caixaRestWhere.sql}`, caixaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM produtos WHERE COALESCE(ativo,1) <> 0 AND COALESCE(disponivel,1) <> 0${produtoRestWhere.sql}`, produtoRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM categorias_produto WHERE COALESCE(ativa,1) <> 0${categoriaRestWhere.sql}`, categoriaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM mesas WHERE LOWER(COALESCE(status,'')) <> 'livre'${mesaRestWhere.sql}`, mesaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM pedidos_mesa WHERE LOWER(COALESCE(status,''))='aberto'${pedidoMesaRestWhere.sql}`, pedidoMesaRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM operadores_caixa WHERE COALESCE(ativo,1) <> 0${operadorRestWhere.sql}`, operadorRestWhere.params),
        sqlScalar(`SELECT COUNT(*) total FROM entregadores WHERE COALESCE(status,1) <> 0 AND LOWER(COALESCE(statusConta,'ativo')) <> 'bloqueado'${entregadorRestWhere.sql}`, entregadorRestWhere.params),
        sqlOne(`
          SELECT COALESCE(SUM(COALESCE(valor,0)),0) totalCaixaHoje
            FROM caixa_movimentos
           WHERE 1=1${movimentoRestWhere.sql}
             AND data BETWEEN ? AND ?
             AND LOWER(COALESCE(tipo,'')) IN ('entrada','venda')
        `, [...movimentoRestWhere.params, inicioSql, fimSql]),
        pool.query(`
          SELECT ${pedidoIdExpr} AS id, numeroPedido, restaurante, nomeCliente, origem, status, formaPagamento, total, ${pedidoDataExpr} AS criadoEm
            FROM pedidos
           WHERE 1=1${pedidoRestWhere.sql}
             AND ${pedidoDataExpr} BETWEEN ? AND ?
             ${notCanceledSql}
           ORDER BY ${pedidoOrderExpr} DESC, id DESC
           LIMIT 15
        `, [...pedidoRestWhere.params, inicioSql, fimSql]).then(([rows]) => rows || [])
      ]);

      const cards = {
        pedidosHoje: Number(pedidosPeriodoRow?.pedidosHoje || 0),
        vendasHoje: Number(vendasPeriodoRow?.vendasHoje || 0),
        pedidosPendentes,
        caixasAbertos,
        produtosAtivos,
        categoriasAtivas,
        mesasOcupadas,
        mesasAbertas,
        operadoresAtivos,
        entregadoresAtivos,
        totalCaixaHoje: Number(caixaHojeRow?.totalCaixaHoje || 0)
      };
      const recentes = (recentesRows || []).map(p=>({id:docId(p), numeroPedido:p.numeroPedido, restaurante:p.restaurante, nomeCliente:p.nomeCliente, origem:p.origem, status:p.status, formaPagamento:p.formaPagamento, total:p.total || p.valorTotal, criadoEm:p.criadoEm}));
      return res.json({cards,recentes, restaurantes: restaurantes.map(publicRestaurante), performanceMs: Date.now() - started});
    }catch(e){ console.error('saas operacao:',e); res.status(500).json({mensagem:'Erro ao carregar operação SaaS.', erro:e.message}); }
  },
  async detalheRestaurante(req,res){
    const started = Date.now();
    try{
      const r = await Restaurante.findById(req.params.id).lean();
      if(!r) return res.status(404).json({mensagem:'Restaurante não encontrado.'});

      const rid = docId(r);
      const inicio = startOfToday();
      const fim = endOfToday();
      const inicioSql = sqlDate(inicio);
      const fimSql = sqlDate(fim);

      // Otimização importante: antes esta rota carregava TODOS os pedidos/produtos/mesas/etc.
      // do restaurante na memória e só depois filtrava. Em restaurantes com muitos pedidos isso
      // podia levar mais de 1 minuto. Agora a API retorna apenas agregados SQL + últimos pedidos.
      const [
        pedidosTotal,
        pedidosHojeRow,
        caixasAbertos,
        produtos,
        categorias,
        mesas,
        mesasOcupadas,
        mesasAbertas,
        operadores,
        entregadores,
        caixaHojeRow,
        pedidosRecentesRows,
        pedidosAbertos
      ] = await Promise.all([
        sqlScalar(`
          SELECT COUNT(*) total
            FROM pedidos
           WHERE restaurante = ?
             AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
        `, [rid]),
        sqlOne(`
          SELECT COUNT(*) pedidosHoje, COALESCE(SUM(COALESCE(total,0)),0) vendasHoje
            FROM pedidos
           WHERE restaurante = ?
             AND COALESCE(pagoEm, criadoEm) BETWEEN ? AND ?
             AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND (${SQL_VENDA_CONFIRMADA})
        `, [rid, inicioSql, fimSql]),
        sqlScalar(`SELECT COUNT(*) total FROM caixa_sessoes WHERE restauranteId = ? AND LOWER(COALESCE(status,''))='aberto'`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM produtos WHERE restaurante = ?`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM categorias_produto WHERE restaurante = ?`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM mesas WHERE restauranteId = ?`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM mesas WHERE restauranteId = ? AND LOWER(COALESCE(status,'')) <> 'livre'`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM pedidos_mesa WHERE restauranteId = ? AND LOWER(COALESCE(status,''))='aberto'`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM operadores_caixa WHERE restauranteId = ?`, [rid]),
        sqlScalar(`SELECT COUNT(*) total FROM entregadores WHERE restaurante = ?`, [rid]),
        sqlOne(`
          SELECT COALESCE(SUM(COALESCE(valor,0)),0) caixaHoje
            FROM caixa_movimentos
           WHERE restauranteId = ?
             AND data BETWEEN ? AND ?
        `, [rid, inicioSql, fimSql]),
        pool.query(`
          SELECT id, numeroPedido, nomeCliente, status, statusPagamento, formaPagamento, origem, total, criadoEm
            FROM pedidos
           WHERE restaurante = ?
             AND criadoEm BETWEEN ? AND ?
             AND LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
           ORDER BY criadoEm DESC
           LIMIT 10
        `, [rid, inicioSql, fimSql]).then(([rows]) => rows || []),
        sqlScalar(`
          SELECT COUNT(*) total
            FROM pedidos
           WHERE restaurante = ?
             AND LOWER(COALESCE(status,'')) IN ('novo','pendente','aberto','em_aberto','preparando','em_preparo','em_producao','em_produção','producao','produção')
             AND LOWER(COALESCE(statusPagamento,'')) NOT IN ('cancelado','cancelada','expirado','estornado')
        `, [rid])
      ]);

      return res.json({
        restaurante: publicRestaurante(r),
        resumo:{
          pedidos: pedidosTotal,
          pedidosHoje: Number(pedidosHojeRow?.pedidosHoje || 0),
          vendasHoje: Number(pedidosHojeRow?.vendasHoje || 0),
          pedidosAbertos,
          caixasAbertos,
          produtos,
          categorias,
          mesas,
          mesasOcupadas,
          mesasAbertas,
          operadores,
          entregadores,
          caixaHoje: Number(caixaHojeRow?.caixaHoje || 0),
          performanceMs: Date.now() - started
        },
        pedidosRecentes: pedidosRecentesRows
      });
    }catch(e){ console.error('saas detalhe restaurante:',e); res.status(500).json({mensagem:'Erro ao carregar restaurante.', erro:e.message }); }
  },
  async bloquearRestaurante(req,res){
    try{ await Restaurante.findByIdAndUpdate(req.params.id, {$set:{ativo:false,statusAssinatura:'bloqueado'}, $inc:{ sessaoVersao:1 }}); await registrarAuditoria(req,'saas.restaurante_bloqueado','restaurante',req.params.id,{restauranteId:req.params.id}); res.json(publicRestaurante(await Restaurante.findById(req.params.id).lean())); }
    catch(e){ res.status(500).json({mensagem:'Erro ao bloquear restaurante.', erro:e.message}); }
  },
  async ativarRestaurante(req,res){
    try{ await Restaurante.findByIdAndUpdate(req.params.id, {$set:{ativo:true,statusAssinatura:req.body.statusAssinatura || 'ativo'}, $inc:{ sessaoVersao:1 }}); await registrarAuditoria(req,'saas.restaurante_ativado','restaurante',req.params.id,{restauranteId:req.params.id}); res.json(publicRestaurante(await Restaurante.findById(req.params.id).lean())); }
    catch(e){ res.status(500).json({mensagem:'Erro ao ativar restaurante.', erro:e.message}); }
  },
  async excluirRestaurante(req,res){
    try{ const r=await Restaurante.findByIdAndDelete(req.params.id); await registrarAuditoria(req,'saas.restaurante_excluido','restaurante',req.params.id,{restauranteId:req.params.id,nome:r?.nome}); res.json({ok:true, restaurante:publicRestaurante(r||{})}); }
    catch(e){ res.status(500).json({mensagem:'Erro ao excluir restaurante.', erro:e.message}); }
  },

  async resetarSenhaRestaurante(req,res){
    try{
      const id = req.params.id;
      const novaSenha = String(req.body?.senha || req.body?.novaSenha || '').trim();
      if (!novaSenha || novaSenha.length < 6) return res.status(400).json({ mensagem:'Informe uma senha com pelo menos 6 caracteres.' });
      const senhaHash = await bcrypt.hash(novaSenha, 10);
      await Restaurante.findByIdAndUpdate(id, { $set:{ senha: senhaHash, ultimoResetSenhaEm:new Date() }, $inc:{ sessaoVersao:1 } });
      return res.json({ ok:true, restaurante: publicRestaurante(await Restaurante.findById(id).lean()), mensagem:'Senha redefinida e sessões antigas invalidadas.' });
    }catch(e){ console.error('reset senha restaurante:', e); return res.status(500).json({ mensagem:'Erro ao redefinir senha.', erro:e.message }); }
  },
  async atualizarEmailCobranca(req,res){
    try{
      const emailCobranca = String(req.body?.emailCobranca || '').trim().toLowerCase();
      await Restaurante.findByIdAndUpdate(req.params.id, { $set:{ emailCobranca } });
      return res.json(publicRestaurante(await Restaurante.findById(req.params.id).lean()));
    }catch(e){ return res.status(500).json({ mensagem:'Erro ao atualizar email de cobrança.', erro:e.message }); }
  },
  async statusBotRestaurante(req,res){
    try{
      const r = await Restaurante.findById(req.params.id).lean();
      if(!r) return res.status(404).json({ mensagem:'Restaurante não encontrado.' });
      const statusBot = parseStatusBot(r);
      return res.json({ restauranteId: docId(r), nome: r.nome, statusBot, ligado: !!statusBot.ligado, atualizadoEm: statusBot.atualizadoEm || statusBot.updatedAt || null });
    }catch(e){ return res.status(500).json({ mensagem:'Erro ao consultar status do bot.', erro:e.message }); }
  },
  async saudeApi(req,res){
    const started = Date.now();
    let db = { ok:false };
    try { await testConnection(); db = { ok:true, ms: Date.now() - started }; } catch(e){ db = { ok:false, erro:e.message }; }
    return res.json({ ...apiMonitor.snapshot(), db, now:new Date().toISOString(), node:process.version, env:process.env.NODE_ENV || 'development' });
  },
  async errosApi(req,res){
    return res.json({ errors: apiMonitor.snapshot().errors, slowRequests: apiMonitor.snapshot().slowRequests });
  },
  async relatorioVendas(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = startOfDayValue(req.query.dataInicio || req.query.data || new Date());
      const fim = endOfDayValue(req.query.dataFim || req.query.data || new Date());
      const caixasRaw = await CaixaSessao.find({}).sort({abertoEm:-1}).lean();
      const caixas = (caixasRaw || []).filter((c) => matchesRestaurante(c, restauranteId) && caixaSessaoIntersectsPeriodo(c, inicio, fim));
      const caixaMap = new Map(caixas.map((c) => [docId(c), c]));
      const caixaIds = Array.from(caixaMap.keys());
      const pedidos = await pedidosPeriodoQuery(restauranteId, inicio, fim, caixaIds);
      const porForma = {};
      let total = 0;
      let quantidadePedidos = 0;
      const produtos = new Map();
      const porStatus = {};
      const porOrigem = {};
      const porDia = {};
      const porCaixa = {};
      for (const p of pedidos) {
        if (!isVendaConfirmada(p)) continue;
        const valor = Number(p.total || p.valorTotal || 0);
        const status = String(p.statusPagamento || p.status || '').toLowerCase();
        // mantém compatível: se não houver status de pagamento, ainda conta pedido fechado/entregue/pago
        if (status && ['cancelado','expirado'].includes(status)) continue;
        quantidadePedidos += 1;
        total += valor;
        const forma = normalizeFormaPagamento(p.formaPagamento || p.formadePagamento || p.pagamento?.formaPagamento);
        porForma[forma] = (porForma[forma] || 0) + valor;
        const statusNorm = String(p.status || p.statusPagamento || 'sem_status').toLowerCase();
        const origemNorm = String(p.origem || 'nao_informada').toLowerCase();
        const dia = dateOnlyISO(dataVendaPedido(p)) || 'sem_data';
        const caixaLabel = pedidoCaixaLabel(p, caixaMap);
        porStatus[statusNorm] = (porStatus[statusNorm] || 0) + 1;
        porOrigem[origemNorm] = (porOrigem[origemNorm] || 0) + valor;
        porDia[dia] = (porDia[dia] || 0) + valor;
        porCaixa[caixaLabel] = (porCaixa[caixaLabel] || 0) + valor;
        for (const item of extractItensPedido(p)) {
          const nome = itemNome(item);
          const qtd = itemQtd(item);
          const unit = Number(item.preco || item.valorUnitario || item.valor || 0);
          const atual = produtos.get(nome) || { nome, quantidade:0, total:0 };
          atual.quantidade += qtd;
          atual.total += Number(item.total || item.valorTotal || (unit * qtd) || 0);
          produtos.set(nome, atual);
        }
      }
      const produtosMaisVendidos = Array.from(produtos.values()).sort((a,b)=>b.quantidade-a.quantidade).slice(0,15);
      return res.json({
        criterio:'vendas confirmadas por sessão de caixa; se o caixa virar o dia, os pedidos continuam no mesmo caixa',
        criterioCaixa:true,
        restauranteId: restauranteId || null,
        dataInicio: dateOnlyISO(inicio),
        dataFim: dateOnlyISO(fim),
        quantidadePedidos,
        total,
        ticketMedio: quantidadePedidos ? total/quantidadePedidos : 0,
        porForma,
        porStatus,
        porOrigem,
        porDia,
        porCaixa,
        produtosMaisVendidos,
        caixas: caixas.slice(0,80).map(c=>({id:docId(c), restauranteId:c.restauranteId, operadorNome:c.operadorNome, status:c.status, dataOperacional:c.dataOperacional, abertoEm:c.abertoEm, fechadoEm:c.fechadoEm, totalVendas:Number(c.totalVendas||0), totalPedidos:Number(c.totalPedidos||0)})),
        pedidos: pedidos.slice(0,100).map(p=>({ id:docId(p), numeroPedido:p.numeroPedido, cliente:p.nomeCliente, formaPagamento:p.formaPagamento, status:p.status, statusPagamento:p.statusPagamento, total:p.total || p.valorTotal, criadoEm:p.criadoEm || p.created_at, pagoEm:p.pagoEm, caixaSessaoId:p.caixaSessaoId, caixa: pedidoCaixaLabel(p, caixaMap) }))
      });
    }catch(e){ console.error('relatorio vendas saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatório de vendas.', erro:e.message }); }
  },
  async relatorioCancelamentos(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = startOfDayValue(req.query.dataInicio || req.query.data || new Date());
      const fim = endOfDayValue(req.query.dataFim || req.query.data || new Date());
      const [restaurantesRaw, pedidosRaw] = await Promise.all([
        Restaurante.find({}).lean(),
        Pedido.find({}).sort({canceladoEm:-1}).lean()
      ]);
      const restMap = new Map((restaurantesRaw || []).map(r => [String(docId(r)), r.nome || 'Restaurante']));
      const pedidos = (pedidosRaw || []).filter((p) => {
        if (restauranteId && String(p.restaurante) !== restauranteId && String(p.restauranteId) !== restauranteId) return false;
        const st = String(p.status || '').toLowerCase();
        const sp = String(p.statusPagamento || '').toLowerCase();
        if (!['cancelado','estornado'].includes(st) && !['cancelado','estornado'].includes(sp) && !p.canceladoEm) return false;
        const d = new Date(p.canceladoEm || p.updatedAt || p.updated_at || p.criadoEm || 0);
        return d >= inicio && d <= fim;
      });
      const porRestaurante = {};
      let valorCancelado = 0;
      let valorEstornado = 0;
      let estornosConcluidos = 0;
      for (const p of pedidos) {
        const rid = String(p.restaurante || p.restauranteId || '');
        const nome = restMap.get(rid) || rid || 'Sem restaurante';
        const cancelado = Number(p.valorCancelado || p.pedidoOriginalSnapshot?.valorTotal || p.pedidoOriginalSnapshot?.total || p.total || p.valorTotal || 0);
        const estornado = Number(p.estornoValor || 0);
        valorCancelado += cancelado;
        valorEstornado += estornado;
        if (String(p.estornoStatus || '').toLowerCase() === 'concluido') estornosConcluidos += 1;
        porRestaurante[rid] = porRestaurante[rid] || { restauranteId: rid, restaurante: nome, cancelados:0, estornosConcluidos:0, valorCancelado:0, valorEstornado:0 };
        porRestaurante[rid].cancelados += 1;
        porRestaurante[rid].valorCancelado += cancelado;
        porRestaurante[rid].valorEstornado += estornado;
        if (String(p.estornoStatus || '').toLowerCase() === 'concluido') porRestaurante[rid].estornosConcluidos += 1;
      }
      return res.json({
        restauranteId: restauranteId || null,
        dataInicio: dateOnlyISO(inicio),
        dataFim: dateOnlyISO(fim),
        cancelados: pedidos.length,
        estornosConcluidos,
        valorCancelado,
        valorEstornado,
        porRestaurante: Object.values(porRestaurante).sort((a,b)=>b.cancelados-a.cancelados),
        pedidos: pedidos.slice(0,150).map(p=>({
          id: docId(p),
          numeroPedido: p.numeroPedido,
          restauranteId: String(p.restaurante || p.restauranteId || ''),
          restaurante: restMap.get(String(p.restaurante || p.restauranteId || '')) || '',
          cliente: p.nomeCliente,
          formaPagamento: p.formaPagamento || p.formadePagamento,
          status: p.status,
          statusPagamento: p.statusPagamento,
          motivoCancelamento: p.motivoCancelamento,
          cancelamentoTipo: p.cancelamentoTipo,
          valorCancelado: Number(p.valorCancelado || p.pedidoOriginalSnapshot?.valorTotal || p.pedidoOriginalSnapshot?.total || 0),
          estornoStatus: p.estornoStatus || 'nao_aplicavel',
          estornoValor: Number(p.estornoValor || 0),
          estornoEm: p.estornoEm || null,
          estornoErro: p.estornoErro || '',
          canceladoEm: p.canceladoEm || null,
        }))
      });
    }catch(e){ console.error('relatorio cancelamentos saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatorio de cancelamentos.', erro:e.message }); }
  },
  async relatorioCaixa(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = startOfDayValue(req.query.dataInicio || req.query.inicio || req.query.data || new Date());
      const fim = endOfDayValue(req.query.dataFim || req.query.fim || req.query.data || new Date());
      const [restaurantes, caixasRaw, movimentosRaw] = await Promise.all([
        Restaurante.find({}).lean(),
        CaixaSessao.find({}).sort({abertoEm:-1}).lean(),
        CaixaMovimento.find({}).sort({data:-1}).lean()
      ]);
      const nomes = restauranteNomeMap(restaurantes);
      const caixas = (caixasRaw || []).filter((c) => matchesRestaurante(c, restauranteId) && caixaSessaoIntersectsPeriodo(c, inicio, fim));
      const caixasIds = new Set(caixas.map((c) => docId(c)));
      const movimentos = (movimentosRaw || []).filter((m) => matchesRestaurante(m, restauranteId) && ((m.caixaSessaoId && caixasIds.has(String(m.caixaSessaoId))) || (!m.caixaSessaoId && isDocInRange(m, inicio, fim, ['data','createdAt']))));
      const resumo = {
        caixas: caixas.length,
        caixasAbertos: caixas.filter((c) => String(c.status || '').toLowerCase() === 'aberto').length,
        caixasFechados: caixas.filter((c) => String(c.status || '').toLowerCase() === 'fechado').length,
        totalVendas: sumValues(caixas, (c) => c.totalVendas),
        dinheiro: sumValues(caixas, (c) => c.totalDinheiro),
        pix: sumValues(caixas, (c) => c.totalPix),
        credito: sumValues(caixas, (c) => c.totalCredito),
        debito: sumValues(caixas, (c) => c.totalDebito),
        online: sumValues(caixas, (c) => c.totalOnline),
        outros: sumValues(caixas, (c) => c.totalOutros),
        sangrias: sumValues(caixas, (c) => c.totalSangrias),
        suprimentos: sumValues(caixas, (c) => c.totalSuprimentos),
        pedidos: sumValues(caixas, (c) => c.totalPedidos),
        movimentos: movimentos.length
      };
      resumo.saldoDinheiroProjetado = resumo.dinheiro + resumo.suprimentos - resumo.sangrias;
      const porForma = { dinheiro: resumo.dinheiro, pix: resumo.pix, credito: resumo.credito, debito: resumo.debito, online: resumo.online, outros: resumo.outros };
      const porTipoMovimento = {};
      for (const m of movimentos) {
        const tipo = String(m.tipo || 'outros').toLowerCase();
        porTipoMovimento[tipo] = (porTipoMovimento[tipo] || 0) + Number(m.valor || 0);
      }
      const porRestauranteMap = new Map();
      for (const c of caixas) {
        const rid = String(c.restauranteId || '');
        if (!porRestauranteMap.has(rid)) porRestauranteMap.set(rid, { restauranteId:rid, nome:getRestauranteNome(nomes, rid), caixas:0, vendas:0, pedidos:0 });
        const item = porRestauranteMap.get(rid);
        item.caixas += 1;
        item.vendas += Number(c.totalVendas || 0);
        item.pedidos += Number(c.totalPedidos || 0);
      }
      return res.json({
        criterio:'sessões de caixa que cruzam o período selecionado; movimentos vinculados ao caixa entram por inteiro',
        restauranteId: restauranteId || null,
        dataInicio: dateOnlyISO(inicio),
        dataFim: dateOnlyISO(fim),
        resumo,
        porForma,
        porTipoMovimento,
        porRestaurante: Array.from(porRestauranteMap.values()).sort((a,b) => b.vendas - a.vendas).slice(0,20),
        caixas: caixas.slice(0,80).map((c) => ({
          id: docId(c),
          restauranteId: c.restauranteId,
          restaurante: getRestauranteNome(nomes, c.restauranteId),
          operadorNome: c.operadorNome,
          status: c.status,
          dataOperacional: c.dataOperacional,
          totalVendas: Number(c.totalVendas || 0),
          totalPedidos: Number(c.totalPedidos || 0),
          abertoEm: c.abertoEm,
          fechadoEm: c.fechadoEm
        })),
        movimentosRecentes: movimentos.slice(0,60).map((m) => ({
          id: docId(m),
          restaurante: getRestauranteNome(nomes, m.restauranteId),
          tipo: m.tipo,
          formaPagamento: m.formaPagamento,
          valor: Number(m.valor || 0),
          origem: m.origem,
          descricao: m.descricao,
          data: m.data
        }))
      });
    }catch(e){ console.error('relatorio caixa saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatorio de caixa.', erro:e.message }); }
  },
  async relatorioEstoque(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = startOfDayValue(req.query.dataInicio || req.query.inicio || req.query.data || addDays(new Date(), -30));
      const fim = endOfDayValue(req.query.dataFim || req.query.fim || req.query.data || new Date());
      const [restaurantes, insumosRaw, receitasRaw, movimentosRaw] = await Promise.all([
        Restaurante.find({}).lean(),
        Insumo.find({}).lean(),
        Receita.find({}).lean(),
        MovimentoEstoque.find({}).sort({data:-1}).lean()
      ]);
      const nomes = restauranteNomeMap(restaurantes);
      const insumos = (insumosRaw || []).filter((i) => matchesRestaurante(i, restauranteId) && i.ativo !== false);
      const receitas = (receitasRaw || []).filter((r) => matchesRestaurante(r, restauranteId) && r.ativo !== false);
      const movimentos = (movimentosRaw || []).filter((m) => matchesRestaurante(m, restauranteId) && isDocInRange(m, inicio, fim, ['data','createdAt']));
      const insumoMap = new Map(insumos.map((i) => [docId(i), i]));
      const abaixoMinimo = insumos.filter((i) => getInsumoQtdBase(i) <= getInsumoMinimoBase(i)).sort((a,b) => getInsumoQtdBase(a) - getInsumoQtdBase(b));
      const receitasCriticas = receitas
        .map((r) => ({ receitaId:docId(r), restauranteId:r.restauranteId, restaurante:getRestauranteNome(nomes, r.restauranteId), nome:r.nome, ...calcProducaoReceita(r, insumoMap) }))
        .filter((r) => r.gargalo)
        .sort((a,b) => a.produzAte - b.produzAte)
        .slice(0,30);
      const porRestauranteMap = new Map();
      for (const i of insumos) {
        const rid = String(i.restauranteId || '');
        if (!porRestauranteMap.has(rid)) porRestauranteMap.set(rid, { restauranteId:rid, nome:getRestauranteNome(nomes, rid), insumos:0, abaixoMinimo:0, custoEstoque:0 });
        const item = porRestauranteMap.get(rid);
        item.insumos += 1;
        item.custoEstoque += getInsumoQtdBase(i) * getInsumoCustoBase(i);
        if (getInsumoQtdBase(i) <= getInsumoMinimoBase(i)) item.abaixoMinimo += 1;
      }
      const porTipoMovimento = {};
      for (const m of movimentos) {
        const tipo = String(m.tipo || 'outros').toLowerCase();
        porTipoMovimento[tipo] = (porTipoMovimento[tipo] || 0) + Math.abs(Number(m.quantidadeBase || 0));
      }
      return res.json({
        criterio:'insumos ativos, alertas e movimentos de estoque no periodo selecionado',
        restauranteId: restauranteId || null,
        dataInicio: dateOnlyISO(inicio),
        dataFim: dateOnlyISO(fim),
        resumo:{
          insumos: insumos.length,
          receitas: receitas.length,
          abaixoMinimo: abaixoMinimo.length,
          custoEstoque: sumValues(insumos, (i) => getInsumoQtdBase(i) * getInsumoCustoBase(i)),
          movimentos: movimentos.length,
          receitasCriticas: receitasCriticas.length
        },
        porTipoMovimento,
        porRestaurante: Array.from(porRestauranteMap.values()).sort((a,b) => b.abaixoMinimo - a.abaixoMinimo).slice(0,20),
        abaixoMinimo: abaixoMinimo.slice(0,40).map((i) => ({
          id: docId(i),
          restaurante: getRestauranteNome(nomes, i.restauranteId),
          nome: i.nome,
          baseUnit: i.baseUnit || i.unidadePadrao || '',
          estoqueAtualBase: getInsumoQtdBase(i),
          estoqueMinimoBase: getInsumoMinimoBase(i),
          custoMedioBase: getInsumoCustoBase(i)
        })),
        receitasCriticas,
        movimentosRecentes: movimentos.slice(0,60).map((m) => ({
          id: docId(m),
          restaurante: getRestauranteNome(nomes, m.restauranteId),
          insumoId: m.insumoId,
          tipo: m.tipo,
          quantidadeBase: Number(m.quantidadeBase || 0),
          origem: m.origem,
          observacao: m.observacao,
          data: m.data
        }))
      });
    }catch(e){ console.error('relatorio estoque saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatorio de estoque.', erro:e.message }); }
  },
  async relatorioEntregas(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const inicio = startOfDayValue(req.query.dataInicio || req.query.inicio || req.query.data || new Date());
      const fim = endOfDayValue(req.query.dataFim || req.query.fim || req.query.data || new Date());
      const hoje = dateOnlyISO(new Date());
      const [restaurantes, entregadoresRaw, onlineRaw, pedidosRaw] = await Promise.all([
        Restaurante.find({}).lean(),
        Entregador.find({}).lean(),
        EntregadorOnline.find({}).lean(),
        Pedido.find({}).sort({criadoEm:-1}).lean()
      ]);
      const nomes = restauranteNomeMap(restaurantes);
      const entregadores = (entregadoresRaw || []).filter((e) => matchesRestaurante(e, restauranteId));
      const onlineHoje = (onlineRaw || []).filter((o) => matchesRestaurante(o, restauranteId) && (String(o.dia || '') === hoje || isToday(o.dataEntrada)));
      const pedidosEntrega = (pedidosRaw || []).filter((p) => {
        const origem = String(p.origem || '').toLowerCase();
        const status = String(p.status || '').toLowerCase();
        const entregaLike = origem.includes('delivery') || origem.includes('entrega') || !!p.entregador || !!p.enderecoCliente;
        return matchesRestaurante(p, restauranteId) && entregaLike && !isStatusCanceladoPedido(p) && isDocInRange(p, inicio, fim, ['criadoEm','pagoEm','createdAt']) && status !== 'cancelado';
      });
      const porStatus = {};
      const porEntregadorMap = new Map();
      const entregadorNome = new Map(entregadores.map((e) => [docId(e), e.nome || `Entregador ${docId(e).slice(-6)}`]));
      for (const p of pedidosEntrega) {
        const status = String(p.status || 'sem_status').toLowerCase();
        porStatus[status] = (porStatus[status] || 0) + 1;
        const eid = String(p.entregador || p.entregadorId || '');
        if (!eid) continue;
        if (!porEntregadorMap.has(eid)) porEntregadorMap.set(eid, { entregadorId:eid, nome:entregadorNome.get(eid) || `Entregador ${eid.slice(-6)}`, pedidos:0, total:0 });
        const item = porEntregadorMap.get(eid);
        item.pedidos += 1;
        item.total += Number(p.total || p.valorTotal || 0);
      }
      const isEntregue = (p) => ['entregue','concluido','finalizado','finalizada'].includes(String(p.status || '').toLowerCase());
      const isEmRota = (p) => ['em_entrega','em entrega','saiu_para_entrega','saiu para entrega'].includes(String(p.status || '').toLowerCase());
      return res.json({
        criterio:'pedidos de delivery/entrega no periodo selecionado',
        restauranteId: restauranteId || null,
        dataInicio: dateOnlyISO(inicio),
        dataFim: dateOnlyISO(fim),
        resumo:{
          entregadores: entregadores.length,
          entregadoresAtivos: entregadores.filter((e) => e.status !== false && e.statusConta !== 'bloqueado').length,
          onlineHoje: onlineHoje.length,
          pedidosEntrega: pedidosEntrega.length,
          entregues: pedidosEntrega.filter(isEntregue).length,
          emRota: pedidosEntrega.filter(isEmRota).length,
          semEntregador: pedidosEntrega.filter((p) => !p.entregador && !p.entregadorId).length,
          totalEntrega: sumValues(pedidosEntrega, (p) => p.total || p.valorTotal)
        },
        porStatus,
        porEntregador: Array.from(porEntregadorMap.values()).sort((a,b) => b.pedidos - a.pedidos).slice(0,20),
        onlineHoje: onlineHoje.slice(0,40).map((o) => ({
          id: docId(o),
          restaurante: getRestauranteNome(nomes, o.restauranteId),
          entregadorId: o.entregadorId,
          online: o.online !== false,
          dataEntrada: o.dataEntrada,
          dia: o.dia
        })),
        pedidosRecentes: pedidosEntrega.slice(0,80).map((p) => ({
          id: docId(p),
          numeroPedido: p.numeroPedido,
          restaurante: getRestauranteNome(nomes, p.restaurante),
          cliente: p.nomeCliente,
          status: p.status,
          entregador: entregadorNome.get(String(p.entregador || p.entregadorId || '')) || '',
          total: p.total || p.valorTotal,
          criadoEm: p.criadoEm
        }))
      });
    }catch(e){ console.error('relatorio entregas saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatorio de entregas.', erro:e.message }); }
  },
  async relatorioIntegracoes(req,res){
    try{
      const restauranteId = req.query.restauranteId ? String(req.query.restauranteId) : '';
      const [restaurantesRaw, pushRaw] = await Promise.all([
        Restaurante.find({}).sort({created_at:-1}).lean(),
        PushSubscription.find({}).lean()
      ]);
      const restaurantes = (restaurantesRaw || []).filter((r) => !restauranteId || docId(r) === restauranteId);
      const pushAtivosPorRestaurante = new Map();
      for (const p of (pushRaw || [])) {
        if (p.ativo === false) continue;
        const rid = String(p.restauranteId || '');
        pushAtivosPorRestaurante.set(rid, (pushAtivosPorRestaurante.get(rid) || 0) + 1);
      }
      const linhas = restaurantes.map((r) => {
        const mp = safeObject(r.mercadoPago);
        const ifood = safeObject(r.ifood);
        const bot = parseStatusBot(r);
        const mercadoPagoConectado = boolLike(mp.conectado) || !!(mp.accessToken || mp.token || mp.access_token);
        const ifoodConectado = boolLike(r.ifoodStatus) || boolLike(ifood.conectado) || !!ifood.accessToken;
        return {
          restauranteId: docId(r),
          nome: r.nome,
          plano: r.plano || 'free',
          statusAssinatura: r.statusAssinatura || 'ativo',
          botLigado: boolLike(bot.ligado),
          botEstado: bot.estado || bot.status || (boolLike(bot.ligado) ? 'ligado' : 'desligado'),
          ifoodConectado,
          mercadoPagoConectado,
          pagamentoCartaoAtivo: boolLike(r.pagamentoCartaoAtivo, true),
          pushAtivos: pushAtivosPorRestaurante.get(docId(r)) || 0,
          mercadoPagoUserId: mp.userId || null,
          ifoodMerchantId: ifood.merchantId || ifood.merchant_id || r.ifoodIdentificador || null
        };
      });
      const resumo = {
        restaurantes: linhas.length,
        botsLigados: linhas.filter((r) => r.botLigado).length,
        ifoodConectados: linhas.filter((r) => r.ifoodConectado).length,
        mercadoPagoConectados: linhas.filter((r) => r.mercadoPagoConectado).length,
        cartaoAtivo: linhas.filter((r) => r.pagamentoCartaoAtivo).length,
        pushAtivos: sumValues(linhas, (r) => r.pushAtivos),
        pendencias: linhas.filter((r) => !r.mercadoPagoConectado || !r.botLigado || !r.pagamentoCartaoAtivo).length
      };
      return res.json({
        criterio:'status consolidado de bot, marketplace, pagamentos e push',
        restauranteId: restauranteId || null,
        resumo,
        linhas
      });
    }catch(e){ console.error('relatorio integracoes saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatorio de integracoes.', erro:e.message }); }
  },
  async listarAuditoria(req,res){
    try{
      const query = {};
      if(req.query.restauranteId) query.restauranteId=String(req.query.restauranteId);
      if(req.query.acao) query.acao=String(req.query.acao);
      const limit=Math.min(Math.max(Number(req.query.limit||200),1),500);
      const logs=await AuditLog.find(query).sort({criadoEm:-1}).limit(limit).lean();
      return res.json({total:logs.length,logs});
    }catch(e){ return res.status(500).json({mensagem:'Erro ao carregar auditoria.',erro:e.message}); }
  },
  async listarAdmins(req,res){
    try{ const rows = await AdminSaas.find({}).sort({created_at:-1}).lean(); res.json(rows.map(publicAdmin)); }
    catch(e){ res.status(500).json({mensagem:'Erro ao listar admins.', erro:e.message}); }
  },
  async salvarAdmin(req,res){
    try{
      const id=req.params.id;
      const payload={ nome:req.body.nome || 'Administrador Movyo SaaS', email:String(req.body.email||'').trim().toLowerCase(), tipo:req.body.tipo || 'full', ativo:req.body.ativo !== false };
      if(!payload.email) return res.status(400).json({mensagem:'Email obrigatório.'});
      if(req.body.senha) payload.senha=await bcrypt.hash(String(req.body.senha),10);
      if(id){ await AdminSaas.findByIdAndUpdate(id, {$set:payload}); return res.json(publicAdmin(await AdminSaas.findById(id).lean())); }
      if(!payload.senha) payload.senha=await bcrypt.hash('movyo123',10);
      const exists=await AdminSaas.findOne({email:payload.email});
      if(exists) return res.status(409).json({mensagem:'Admin já cadastrado.'});
      res.status(201).json(publicAdmin(await AdminSaas.create(payload)));
    }catch(e){ res.status(500).json({mensagem:'Erro ao salvar admin.', erro:e.message}); }
  }
};
