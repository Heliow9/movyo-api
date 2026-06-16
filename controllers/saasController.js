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

async function pedidosPeriodoQuery(restauranteId, inicio, fim){
  const rest = restauranteId ? ' AND restaurante = ?' : '';
  const params = restauranteId ? [String(restauranteId), sqlDate(inicio), sqlDate(fim)] : [sqlDate(inicio), sqlDate(fim)];
  // Fonte de verdade financeira: pagoEm quando existir; caso contrário criadoEm.
  // A confirmação final é aplicada por isVendaConfirmada para suportar pagamento na entrega.
  const [rows] = await pool.query(`
    SELECT * FROM pedidos
     WHERE 1=1${rest}
       AND COALESCE(pagoEm, criadoEm) BETWEEN ? AND ?
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
      const allowed = ['nome','email','cnpj','telefone','slugIdentificador','enderecoCidade','enderecoBairro','plano','statusAssinatura','dataInicioPlano','dataFimPlano','observacaoPlano','emailCobranca','ativo','sessaoVersao'];
      const update = {};
      for (const k of allowed) if (Object.prototype.hasOwnProperty.call(req.body,k)) update[k]=req.body[k];
      if(update.plano) update.plano = normalizePlano(update.plano);
      if(update.dataInicioPlano) update.dataInicioPlano = parseDate(update.dataInicioPlano);
      if(update.dataFimPlano) update.dataFimPlano = parseDate(update.dataFimPlano);
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
    try{
      const rid = req.query.restauranteId;
      const inicio = req.query.dataInicio || req.query.data ? startOfDayValue(req.query.dataInicio || req.query.data) : startOfToday();
      const fim = req.query.dataFim || req.query.data ? endOfDayValue(req.query.dataFim || req.query.data) : endOfToday();
      const [restaurantes, pedidos, caixas, produtos, categorias, mesas, pedidosMesa, operadores, entregadores, movimentos] = await Promise.all([
        Restaurante.find({}).lean(), Pedido.find({}).lean(), CaixaSessao.find({}).lean(), Produto.find({}).lean(), CategoriaProduto.find({}).lean(), Mesa.find({}).lean(), PedidoMesa.find({}).lean(), OperadorCaixa.find({}).lean(), Entregador.find({}).lean(), CaixaMovimento.find({}).lean()
      ]);
      const list = (arr)=> rid ? arr.filter(x=>belongsToRestaurante(x,rid)) : arr;
      const pedidosFil = list(pedidos), caixasFil=list(caixas), produtosFil=list(produtos), categoriasFil=list(categorias), mesasFil=list(mesas), pedidosMesaFil=list(pedidosMesa), operadoresFil=list(operadores), entregadoresFil=list(entregadores), movFil=list(movimentos);
      const pedidosPeriodo = pedidosFil.filter(p => isPedidoNoPeriodo(p, inicio, fim));
      const vendasPeriodo = pedidosFil.filter(p => isVendaConfirmada(p) && isVendaPedidoNoPeriodo(p, inicio, fim));
      const movimentosPeriodo = filterDateRange(movFil, inicio, fim, ['data','createdAt']);
      const cards = { pedidosHoje: pedidosPeriodo.length, vendasHoje: vendasPeriodo.reduce((acc,p)=>acc+num(p.total || p.valorTotal),0), pedidosPendentes: pedidosFil.filter(p=>['pendente','novo','preparando','em_preparo'].includes(String(p.status||'').toLowerCase())).length, caixasAbertos: caixasFil.filter(c=>String(c.status).toLowerCase()==='aberto').length, produtosAtivos: produtosFil.filter(p=>p.ativo !== false && p.disponivel !== false).length, categoriasAtivas: categoriasFil.filter(c=>c.ativa !== false).length, mesasOcupadas: mesasFil.filter(m=>String(m.status||'').toLowerCase() !== 'livre').length, mesasAbertas: pedidosMesaFil.filter(p=>String(p.status||'').toLowerCase()==='aberto').length, operadoresAtivos: operadoresFil.filter(o=>o.ativo !== false).length, entregadoresAtivos: entregadoresFil.filter(e=>e.status !== false && e.statusConta !== 'bloqueado').length, totalCaixaHoje: movimentosPeriodo.filter(m=>['entrada','venda'].includes(String(m.tipo||'').toLowerCase())).reduce((a,m)=>a+num(m.valor),0) };
      const recentes = pedidosPeriodo.sort((a,b)=>new Date(b.criadoEm||0)-new Date(a.criadoEm||0)).slice(0,15).map(p=>({id:docId(p), numeroPedido:p.numeroPedido, restaurante:p.restaurante, nomeCliente:p.nomeCliente, origem:p.origem, status:p.status, formaPagamento:p.formaPagamento, total:p.total || p.valorTotal, criadoEm:p.criadoEm}));
      return res.json({cards,recentes, restaurantes: restaurantes.map(publicRestaurante)});
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
      const pedidos = await pedidosPeriodoQuery(restauranteId, inicio, fim);
      const porForma = {};
      let total = 0;
      let quantidadePedidos = 0;
      const produtos = new Map();
      const porStatus = {};
      const porOrigem = {};
      const porDia = {};
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
        porStatus[statusNorm] = (porStatus[statusNorm] || 0) + 1;
        porOrigem[origemNorm] = (porOrigem[origemNorm] || 0) + valor;
        porDia[dia] = (porDia[dia] || 0) + valor;
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
      return res.json({ criterio:'vendas confirmadas; data financeira = pagoEm ou criadoEm', restauranteId: restauranteId || null, dataInicio: dateOnlyISO(inicio), dataFim: dateOnlyISO(fim), quantidadePedidos, total, ticketMedio: quantidadePedidos ? total/quantidadePedidos : 0, porForma, porStatus, porOrigem, porDia, produtosMaisVendidos, pedidos: pedidos.slice(0,100).map(p=>({ id:docId(p), numeroPedido:p.numeroPedido, cliente:p.nomeCliente, formaPagamento:p.formaPagamento, status:p.status, statusPagamento:p.statusPagamento, total:p.total || p.valorTotal, criadoEm:p.criadoEm || p.created_at, pagoEm:p.pagoEm })) });
    }catch(e){ console.error('relatorio vendas saas:', e); return res.status(500).json({ mensagem:'Erro ao gerar relatório de vendas.', erro:e.message }); }
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
