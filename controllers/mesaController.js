// controllers/mesaController.js
const mongoose = require("../lib/mongoId");
const crypto = require("crypto");

const Mesa = require("../models/mesaModel");
const { pool } = require("../db/mysql");
const { queryWithRetry } = require("../lib/mysqlRetry");
const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");

const { criarPagamentoPix, consultarPagamento } = require("../services/mercadoPagoPixService");
const { exigirCaixaAberto, vincularPedidoAoCaixa, registrarMovimentoVenda, recalcularCaixa, normalizeFormaPagamento } = require("../services/caixaService");
// controllers/mesaController.js (no topo)
const { enviarMensagem, enviarMensagemMidia, estaConectado } = require("../utils/bot");

function boolLike(v) {
  return v === true || v === 1 || String(v || "").trim().toLowerCase() === "true";
}

function getMercadoPagoInfo(restaurante) {
  const mp = restaurante && restaurante.mercadoPago && typeof restaurante.mercadoPago === "object" ? restaurante.mercadoPago : {};
  const accessToken = mp.accessToken || mp.token || mp.access_token || null;
  const conectado = boolLike(mp.conectado) || !!accessToken;
  return { conectado, accessToken, mp };
}


/* =========================================================
   HELPERS DE PERFORMANCE - MOVYO HUB / APP GARÇOM
========================================================= */
const resumoHomeCache = new Map();
const RESUMO_HOME_CACHE_MS = Number(process.env.MOVYO_HUB_RESUMO_CACHE_MS || 0);


function emitirAtualizacaoAtendimento(req, restauranteId, payload = {}) {
  if (!req?.io || !restauranteId) return;
  const room = `restaurante-${String(restauranteId)}`;
  const data = { ...payload, restauranteId: String(restauranteId), atualizadoEm: new Date().toISOString() };
  [
    "atendimentoAtualizado",
    "resumoGarcomAtualizado",
    "filaPedidosAtualizada",
    "rankingGarconsAtualizado",
  ].forEach((evento) => req.io.to(room).emit(evento, data));
}

function parseJsonSafe(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToPedidoLean(row = {}) {
  const pedido = { ...row };
  pedido._id = row.id;
  pedido.id = row.id;
  pedido.valorTotal = Number(row.total ?? row.valorTotal ?? 0) || 0;
  pedido.total = Number(row.total ?? row.valorTotal ?? 0) || 0;
  pedido.valorPago = Number(row.valorPago ?? 0) || 0;
  pedido.valorPendente = Number(row.valorPendente ?? 0) || 0;
  pedido.formadePagamento = row.formaPagamento || row.formadePagamento || "";
  pedido.formaPagamento = row.formaPagamento || row.formadePagamento || "";
  pedido.itens = parseJsonSafe(row.itens, []);
  pedido.pagamentos = parseJsonSafe(row.pagamentos, []);
  pedido.pagamento = parseJsonSafe(row.pagamento, null);
  return pedido;
}

function hojeSqlLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { inicio: `${ymd} 00:00:00`, fim: `${ymd} 23:59:59`, ymd };
}

function mesaRowToLean(row = {}) {
  return {
    ...row,
    _id: row.id,
    id: row.id,
    ultimaPermanenciaSegundos: Number(row.ultimaPermanenciaSegundos || 0),
    sessaoExpiraEm: row.sessaoExpiraEm || null,
    sessaoInicialExpiraEm: row.sessaoInicialExpiraEm || null,
    ocupadaDesde: row.ocupadaDesde || null,
    ultimaFechadaEm: row.ultimaFechadaEm || null,
  };
}


async function registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId }) {
  if (!pedido || !caixa) return [];
  pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
  const criados = [];

  for (const pagamento of pedido.pagamentos) {
    const status = String(pagamento?.status || '').toLowerCase();
    if (!['confirmado', 'pago', 'approved', 'aprovado'].includes(status)) continue;
    if (pagamento.caixaMovimentoId) continue;

    const mov = await registrarMovimentoVenda({ pedido, pagamento, caixa, restauranteId });
    if (mov?._id) {
      pagamento.caixaMovimentoId = mov._id;
      pagamento.caixaSessaoId = caixa._id || caixa.id;
      criados.push(mov);
    }
  }

  return criados;
}

function normalizarNumeroMesa(valor) {
  return String(valor ?? "").trim().replace(/\s+/g, " ");
}

const mesaCreateCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

function getIdempotencyKey(req) {
  return String(req.headers?.["x-idempotency-key"] || req.body?.idempotencyKey || "").trim();
}

function cacheSet(key, value) {
  if (!key) return;
  mesaCreateCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  setTimeout(() => mesaCreateCache.delete(key), CACHE_TTL_MS + 5000).unref?.();
}

function cacheGet(key) {
  if (!key) return null;
  const item = mesaCreateCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    mesaCreateCache.delete(key);
    return null;
  }
  return item.value;
}

async function withMysqlLock(lockName, fn) {
  const safeName = String(lockName || "").slice(0, 190);
  const [lockRows] = await pool.query("SELECT GET_LOCK(?, 8) AS locked", [safeName]);
  if (Number(lockRows?.[0]?.locked) !== 1) {
    const err = new Error("Não foi possível obter trava de criação de mesa. Tente novamente.");
    err.status = 423;
    throw err;
  }

  try {
    return await fn();
  } finally {
    try { await pool.query("SELECT RELEASE_LOCK(?)", [safeName]); } catch (_) {}
  }
}

function dedupeMesasPorNumero(mesas) {
  const map = new Map();
  for (const mesa of Array.isArray(mesas) ? mesas : []) {
    const key = `${String(mesa?.restauranteId || "")}:${normalizarNumeroMesa(mesa?.numero).toLowerCase()}`;
    if (!key || key.endsWith(':')) continue;
    if (!map.has(key)) map.set(key, mesa);
  }
  return Array.from(map.values()).sort((a, b) =>
    String(a?.numero || "").localeCompare(String(b?.numero || ""), undefined, { numeric: true })
  );
}

async function existeMesaComNumero(restauranteId, numero) {
  if (!restauranteId || !numero) return false;
  const existente = await Mesa.findOne({
    restauranteId: String(restauranteId),
    numero: normalizarNumeroMesa(numero),
  }).lean();
  return !!existente;
}

/* -----------------------
   Helpers permanência
-------------------------*/
function marcarInicioSePrecisa(mesa) {
  if (mesa.status === "ocupada" && !mesa.ocupadaDesde) {
    mesa.ocupadaDesde = new Date();
  }
}

function finalizarPermanencia(mesa) {
  const agora = new Date();

  if (mesa.ocupadaDesde) {
    const duracaoSeg = Math.max(
      0,
      Math.floor((agora.getTime() - mesa.ocupadaDesde.getTime()) / 1000)
    );

    mesa.ultimaPermanenciaSegundos = duracaoSeg;
    mesa.ultimaFechadaEm = agora;
  }

  mesa.ocupadaDesde = null;
}

/* -----------------------
   Helpers gerais
-------------------------*/
const toNum = (v) => {
  const n = Number(String(v ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function calcularTotalPedido(pedido) {
  const vt = toNum(pedido?.valorTotal);
  if (vt > 0) return round2(vt);

  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  const total = itens.reduce((acc, it) => {
    const qtd = Math.max(1, Number(it?.quantidade || 1));
    const unit = toNum(it?.precoUnitario);
    const tot = toNum(it?.precoTotal);
    return acc + (tot > 0 ? tot : unit * qtd);
  }, 0);

  return round2(total);
}

function isPaidStatus(st) {
  const s = String(st || "").toLowerCase();
  return s === "approved" || s === "paid" || s === "aprovado" || s === "confirmado";
}

/**
 * ✅ Pega garçom de forma robusta
 */
function getGarcomFromReq(req) {
  const u =
    req?.garcomDoc ||
    req?.garcom ||
    req?.garcomUser ||
    req?.auth?.garcom ||
    req?.auth?.user ||
    req?.user ||
    null;

  const idRaw =
    u?._id ||
    u?.id ||
    u?.garcomId ||
    req?.garcomId ||
    req?.user?.garcomId ||
    req?.auth?.garcomId ||
    null;

  const id = idRaw ? String(idRaw) : null;
  const nome = u?.apelido || u?.nome || req?.user?.apelido || req?.user?.nome || null;

  return { id, nome };
}

/* -----------------------
   ✅ Segurança (APP garçom)
-------------------------*/
async function assertMesaDoRestaurante(req, mesaId) {
  const mesa = await Mesa.findById(mesaId);
  if (!mesa) {
    const err = new Error("Mesa não encontrada");
    err.status = 404;
    throw err;
  }

  const mesaRestId = String(mesa.restauranteId || "");
  const tokenRestId = String(req.restauranteId || "");

  if (tokenRestId && mesaRestId && mesaRestId !== tokenRestId) {
    const err = new Error("Mesa não pertence a este restaurante.");
    err.status = 403;
    throw err;
  }

  return mesa;
}

/* -----------------------
   ✅ Pagamentos (balcão parcial)
-------------------------*/
function sumPagamentosConfirmados(pedido) {
  const arr = Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : [];
  return round2(
    arr.reduce((acc, p) => {
      if (!p) return acc;
      if (String(p.status || "").toLowerCase() !== "confirmado") return acc;
      return acc + toNum(p.valor);
    }, 0)
  );
}

/**
 * ✅ Recalcula e salva campos de apoio:
 * - valorPago (confirmado)
 * - valorPendente (restante)
 * - status (aguardando_pagamento / pago)
 *
 * Regra compat:
 * - Se pedido estiver "pago" e valorPago ainda 0, assume quitado (fluxo antigo)
 */
function recalcPagamentoPedido(pedido) {
  const total = calcularTotalPedido(pedido);

  let pago = sumPagamentosConfirmados(pedido);

  // compat fluxo antigo: pedido "pago" sem pagamentos[] (vitrine/app garçom)
  if (String(pedido?.status || "").toLowerCase() === "pago" && (!pago || pago <= 0)) {
    pago = total;
  }

  const pendente = Math.max(0, round2(total - pago));

  pedido.valorTotal = total;

  // ⚠️ estes campos precisam existir no schema (valorPago/valorPendente)
  pedido.valorPago = round2(pago);
  pedido.valorPendente = round2(pendente);

  if (pendente <= 0 && total > 0) {
    pedido.status = "pago";
    if (!pedido.pagoEm) pedido.pagoEm = new Date();
  } else {
    // não pisa em "em_producao"
    if (String(pedido.status || "").toLowerCase() === "pago") {
      pedido.status = "aguardando_pagamento";
    }
  }

  return { total, pago: pedido.valorPago, pendente: pedido.valorPendente };
}

async function liberarMesaGenerico({ req, mesa, pedido }) {
  const agora = new Date();
  if (!pedido.fechadoEm) pedido.fechadoEm = agora;

  const g = getGarcomFromReq(req);
  if (req.role === "garcom" && g.id) {
    pedido.fechadoPor = g.id;
    pedido.fechadoPorRole = "garcom";
    pedido.garcomId = pedido.garcomId || g.id;
    pedido.garcomNome = pedido.garcomNome || g.nome;
  } else if (req?.userId) {
    pedido.fechadoPor = req.userId;
    pedido.fechadoPorRole = "restaurante";
  }

  finalizarPermanencia(mesa);
  mesa.status = "livre";
  mesa.pedidoAtualId = null;

  mesa.sessaoToken = null;
  mesa.sessaoExpiraEm = null;
  mesa.sessaoInicialExpiraEm = null;

  await Promise.all([pedido.save(), mesa.save()]);

  if (req.io) {
    req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
    req.io.to(`mesa-${String(mesa._id)}`).emit("mesaAtualizada", mesa);
    emitirAtualizacaoAtendimento(req, mesa.restauranteId, { pedidoId: String(pedido?._id || pedido?.id || ""), mesaId: String(mesa?._id || mesa?.id || ""), origem: "mesa" });
  }

  return { mesa, pedido };
}

/* -----------------------
   ✅ Finalizar venda Pix (APP GARÇOM - total)
-------------------------*/
async function finalizarVendaPix({ req, mesa, pedido, statusPagamento }) {
  const agora = new Date();

  if (statusPagamento) pedido.statusPagamento = String(statusPagamento);

  pedido.status = "pago";
  pedido.formadePagamento = "pix";

  // compat: total pago
  pedido.valorTotal = calcularTotalPedido(pedido);
  pedido.valorPago = pedido.valorTotal;
  pedido.valorPendente = 0;

  const caixa = await exigirCaixaAberto(mesa.restauranteId);
  await vincularPedidoAoCaixa(pedido, caixa);

  pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
  const pixJaRegistrado = pedido.pagamentos.some((p) =>
    String(p?.metodo || "").toLowerCase() === "pix" &&
    (String(p?.mpPaymentId || "") === String(pedido.mpPaymentId || "") || p?.caixaMovimentoId)
  );
  if (!pixJaRegistrado) {
    pedido.pagamentos.push({
      metodo: "pix",
      valor: pedido.valorTotal,
      status: "confirmado",
      recebidoEm: agora,
      mpPaymentId: pedido.mpPaymentId || null,
      mpStatus: statusPagamento || "approved",
      recebidoPorRole: req.role === "garcom" ? "garcom" : "restaurante",
    });
  }

  await registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId: mesa.restauranteId });
  await recalcularCaixa(caixa._id || caixa.id);

  if (!pedido.pagoEm) pedido.pagoEm = agora;
  if (!pedido.fechadoEm) pedido.fechadoEm = agora;

  const g = getGarcomFromReq(req);

  if (g.id) {
    pedido.fechadoPor = g.id;
    pedido.fechadoPorRole = "garcom";
    pedido.garcomId = pedido.garcomId || g.id;
    pedido.garcomNome = pedido.garcomNome || g.nome;
  } else if (req?.userId) {
    pedido.fechadoPor = req.userId;
    pedido.fechadoPorRole = "restaurante";
  }

  await pedido.save();

  finalizarPermanencia(mesa);
  mesa.status = "livre";
  mesa.pedidoAtualId = null;

  mesa.sessaoToken = null;
  mesa.sessaoExpiraEm = null;
  mesa.sessaoInicialExpiraEm = null;

  await mesa.save();

  if (req.io) {
    req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
  }

  return { mesa, pedido };
}

/* =========================
   PAINEL ELECTRON: Mesas CRUD
========================= */

exports.listarMesas = async (req, res) => {
  try {
    const mesas = await Mesa.find({ restauranteId: req.params.restauranteId }).sort({ numero: 1 });
    return res.json(dedupeMesasPorNumero(mesas));
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar mesas", error });
  }
};

exports.criarMesa = async (req, res) => {
  const restauranteId = String(req.body?.restauranteId || "").trim();
  const numero = normalizarNumeroMesa(req.body?.numero);
  const idempotencyKey = getIdempotencyKey(req);

  if (!restauranteId) {
    return res.status(400).json({ message: "restauranteId é obrigatório." });
  }
  if (!numero) {
    return res.status(400).json({ message: "O número da mesa é obrigatório." });
  }

  const cached = cacheGet(idempotencyKey);
  if (cached) return res.status(201).json(cached);

  try {
    const novaMesa = await withMysqlLock(`mesa:create:${restauranteId}:${numero.toLowerCase()}`, async () => {
      const existente = await Mesa.findOne({ restauranteId, numero }).lean();
      if (existente) {
        const err = new Error(`A mesa ${numero} já existe para este restaurante.`);
        err.status = 409;
        err.existing = existente;
        throw err;
      }

      const mesa = new Mesa({
        numero,
        restauranteId,
        qrCodeIdentifier: crypto.randomBytes(16).toString("hex"),
      });

      await mesa.save();
      return mesa;
    });

    cacheSet(idempotencyKey, novaMesa);

    if (req.io) {
      req.io.to(`restaurante-${restauranteId}`).emit("mesaCriada", novaMesa);
    }

    return res.status(201).json(novaMesa);
  } catch (error) {
    if (error?.status === 409 || error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: error?.message || `A mesa ${numero} já existe para este restaurante.` });
    }
    return res.status(error?.status || 500).json({ message: "Erro ao criar mesa", error: error?.message || error });
  }
};

exports.excluirMesa = async (req, res) => {
  try {
    const mesa = await Mesa.findByIdAndDelete(req.params.id);
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaExcluida", { id: req.params.id });
    }

    return res.status(200).json({ message: "Mesa excluída com sucesso" });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao excluir mesa", error });
  }
};

/* =========================
   FLUXO CLIENTE (QR)
========================= */

exports.iniciarSessaoMesa = async (req, res) => {
  try {
    const { qrIdentifier } = req.params;
    const mesa = await Mesa.findOne({ qrCodeIdentifier: qrIdentifier });
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada." });

    if (mesa.status === "ocupada" && mesa.sessaoToken && mesa.sessaoExpiraEm > new Date()) {
      return res.json({ sessaoToken: mesa.sessaoToken });
    }

    const token = crypto.randomBytes(20).toString("hex");
    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + 4 * 60 * 60 * 1000);
    const expiraInicialEm = new Date(agora.getTime() + 20 * 60 * 1000);

    mesa.sessaoToken = token;
    mesa.sessaoExpiraEm = expiraEm;
    mesa.sessaoInicialExpiraEm = expiraInicialEm;

    await mesa.save();

    return res.json({ sessaoToken: token });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao iniciar sessão", error });
  }
};

exports.criarPedidoMesa = async (req, res) => {
  const { mesaId, sessaoToken, itens, formadePagamento, nomeCliente } = req.body;

  try {
    const mesa = await Mesa.findById(mesaId);
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    if (mesa.sessaoToken !== sessaoToken) {
      return res.status(403).json({ message: "Sessão inválida ou expirada." });
    }
    if (!mesa.sessaoExpiraEm || mesa.sessaoExpiraEm <= new Date()) {
      return res.status(403).json({ message: "Sessão expirada." });
    }

    if (mesa.sessaoInicialExpiraEm && mesa.sessaoInicialExpiraEm <= new Date()) {
      mesa.sessaoToken = null;
      mesa.sessaoExpiraEm = null;
      mesa.sessaoInicialExpiraEm = null;
      await mesa.save();
      return res.status(403).json({
        message: "Sessão expirada por inatividade. Escaneie o QR code novamente.",
      });
    }

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ message: "Envie itens válidos." });
    }

    const itensNormalizados = itens.map((i) => {
      const qtd = Number(i.quantidade || 1);
      const unit = Number(i.precoUnitario || 0);
      const total = Number.isFinite(i.precoTotal) ? Number(i.precoTotal) : qtd * unit;
      return { ...i, quantidade: qtd, precoUnitario: unit, precoTotal: total };
    });

    const totalRodada = itensNormalizados.reduce((acc, i) => acc + Number(i.precoTotal || 0), 0);

    let pedido = null;

    if (mesa.pedidoAtualId) {
      pedido = await Pedido.findById(mesa.pedidoAtualId);
      if (!pedido) mesa.pedidoAtualId = null;
    }

    if (!pedido) {
      pedido = new Pedido({
        restaurante: mesa.restauranteId,
        mesaId: mesa._id,
        nomeCliente: nomeCliente || `Mesa ${mesa.numero}`,
        itens: [],
        valorTotal: 0,
        formadePagamento,
        origem: "salao",
        status: "em_producao",
      });
    }

    pedido.itens.push(...itensNormalizados);
    pedido.valorTotal = round2(Number(pedido.valorTotal || 0) + totalRodada);

    await pedido.save();

    mesa.status = "ocupada";
    mesa.pedidoAtualId = pedido._id;
    marcarInicioSePrecisa(mesa);

    mesa.sessaoInicialExpiraEm = null;
    mesa.sessaoExpiraEm = new Date(Date.now() + 4 * 60 * 60 * 1000);

    await mesa.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
      emitirAtualizacaoAtendimento(req, mesa.restauranteId, { pedidoId: String(pedido?._id || pedido?.id || ""), mesaId: String(mesa?._id || mesa?.id || ""), origem: "mesa" });
    }

    return res.status(201).json(pedido);
  } catch (error) {
    console.error("Erro ao criar/atualizar pedido da mesa:", error);
    return res.status(500).json({ message: "Erro interno ao processar pedido.", error });
  }
};

exports.fecharComanda = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const mesa = await Mesa.findById(mesaId);
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    const pedidoId = mesa.pedidoAtualId;

    mesa.sessaoToken = null;
    mesa.sessaoExpiraEm = null;
    mesa.sessaoInicialExpiraEm = null;

    finalizarPermanencia(mesa);

    mesa.status = "livre";
    mesa.pedidoAtualId = null;

    await mesa.save();

    if (pedidoId) {
      await Pedido.findByIdAndUpdate(pedidoId, { $set: { status: "entregue" } });
    }

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
    }

    return res.status(200).json({ message: "Comanda fechada com sucesso.", mesa });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao fechar comanda", error });
  }
};

exports.criarMesasEmLote = async (req, res) => {
  const restauranteId = String(req.body?.restauranteId || "").trim();
  const quantidade = Number(req.body?.quantidade || 0);
  const numeroInicial = Number(req.body?.numeroInicial || 1);
  const prefixo = String(req.body?.prefixo ?? "Mesa ").trim();
  const idempotencyKey = getIdempotencyKey(req);

  if (!restauranteId) {
    return res.status(400).json({ message: "restauranteId é obrigatório." });
  }
  if (!quantidade || quantidade < 1 || quantidade > 100) {
    return res.status(400).json({ message: "A quantidade deve ser entre 1 e 100." });
  }
  if (!Number.isFinite(numeroInicial)) {
    return res.status(400).json({ message: "Número inicial inválido." });
  }

  const cached = cacheGet(idempotencyKey);
  if (cached) return res.status(201).json(cached);

  try {
    const mesasCriadas = await withMysqlLock(`mesa:lote:${restauranteId}`, async () => {
    const novasMesas = [];
    const numerosSolicitados = new Set();

    for (let i = 0; i < quantidade; i++) {
      const numeroDaMesa = normalizarNumeroMesa(`${prefixo || "Mesa"} ${numeroInicial + i}`);
      if (numerosSolicitados.has(numeroDaMesa)) {
        const err = new Error(`Número duplicado no lote: ${numeroDaMesa}`);
        err.status = 409;
        throw err;
      }
      numerosSolicitados.add(numeroDaMesa);
      novasMesas.push({
        numero: numeroDaMesa,
        restauranteId,
        qrCodeIdentifier: crypto.randomBytes(16).toString("hex"),
      });
    }

    const existentes = await Mesa.find({
      restauranteId,
      numero: { $in: Array.from(numerosSolicitados) },
    }).lean();

    if (Array.isArray(existentes) && existentes.length) {
      const nums = existentes.map((m) => m.numero).filter(Boolean).join(", ");
      const err = new Error(`Já existem mesas com estes números: ${nums}.`);
      err.status = 409;
      throw err;
    }

    return await Mesa.insertMany(novasMesas);
    });

    cacheSet(idempotencyKey, mesasCriadas);

    if (req.io) {
      req.io.to(`restaurante-${restauranteId}`).emit("mesasCriadasEmLote", mesasCriadas);
    }

    return res.status(201).json(mesasCriadas);
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }
    if (error?.code === "ER_DUP_ENTRY" || error?.code === 11000) {
      return res.status(409).json({
        message:
          "Erro: Uma ou mais mesas com esses números já existem. Tente um número inicial ou prefixo diferente.",
      });
    }
    return res.status(500).json({ message: "Erro ao criar mesas em lote", error: error?.message || error });
  }
};

/* =========================
   FLUXO PAINEL (Electron) - ações em mesa
========================= */

exports.abrirMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const { nomeCliente } = req.body;

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);

    if (mesa.status === "ocupada" && mesa.pedidoAtualId) {
      const pedido = await Pedido.findById(mesa.pedidoAtualId);
      if (pedido) {
        recalcPagamentoPedido(pedido);
        await pedido.save().catch(() => {});
      }
      return res.json({ mesa, pedido, jaEstavaAberta: true });
    }

    const novoPedido = new Pedido({
      restaurante: mesa.restauranteId,
      mesaId: mesa._id,
      nomeCliente: nomeCliente || `Mesa ${mesa.numero}`,
      itens: [],
      valorTotal: 0,
      origem: "salao",
      status: "em_producao",
      formadePagamento: "pendente",
      pagamentos: [],
      valorPago: 0,
      valorPendente: 0,
    });

    if (req.role === "garcom") {
      const g = getGarcomFromReq(req);
      if (g.id) {
        novoPedido.garcomId = g.id;
        novoPedido.garcomNome = g.nome;
      }
    }

    await vincularPedidoAoCaixa(novoPedido, caixa);

    await novoPedido.save();

    mesa.status = "ocupada";
    mesa.pedidoAtualId = novoPedido._id;

    marcarInicioSePrecisa(mesa);

    mesa.sessaoToken = null;
    mesa.sessaoExpiraEm = null;
    mesa.sessaoInicialExpiraEm = null;

    await mesa.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("novoPedido", novoPedido);
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", novoPedido);
      emitirAtualizacaoAtendimento(req, mesa.restauranteId, { pedidoId: String(novoPedido?._id || novoPedido?.id || ""), mesaId: String(mesa?._id || mesa?.id || ""), origem: "mesa" });
    }

    return res.status(201).json({ mesa, pedido: novoPedido });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao abrir mesa (painel)", error });
  }
};

exports.adicionarItensMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const { itens } = req.body;

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ message: "Envie um array de itens válido." });
    }

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    if (req.role === "garcom") {
      const g = getGarcomFromReq(req);
      if (g.id && !pedido.garcomId) {
        pedido.garcomId = g.id;
        pedido.garcomNome = g.nome;
      }
    }

    const itensNormalizados = itens.map((i) => {
      const qtd = Number(i.quantidade || 1);
      const unit = Number(i.precoUnitario || 0);
      const total = Number.isFinite(i.precoTotal) ? Number(i.precoTotal) : qtd * unit;
      return { ...i, quantidade: qtd, precoUnitario: unit, precoTotal: total };
    });

    const totalRodada = itensNormalizados.reduce((acc, i) => acc + Number(i.precoTotal || 0), 0);

    pedido.itens.push(...itensNormalizados);
    pedido.valorTotal = round2(Number(pedido.valorTotal || 0) + totalRodada);

    recalcPagamentoPedido(pedido);
    await pedido.save();

    mesa.status = "ocupada";
    marcarInicioSePrecisa(mesa);
    await mesa.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
      emitirAtualizacaoAtendimento(req, mesa.restauranteId, { pedidoId: String(pedido?._id || pedido?.id || ""), mesaId: String(mesa?._id || mesa?.id || ""), origem: "mesa" });
    }

    return res.json({ mesa, pedido });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao adicionar itens na mesa", error });
  }
};

exports.buscarComandaAtualMesa = async (req, res) => {
  try {
    const { mesaId } = req.params;

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    if (!mesa.pedidoAtualId) return res.json({ mesa, pedido: null });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);

    if (pedido) {
      recalcPagamentoPedido(pedido);
      await pedido.save().catch(() => {});
    }

    return res.json({ mesa, pedido });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao buscar comanda da mesa", error });
  }
};

/* =========================
   ✅ NOVO (PAINEL): Registrar pagamento parcial (dinheiro/cartão)
========================= */
exports.registrarPagamentoMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const { metodo, valor, obs } = req.body;

    const m = String(metodo || "").toLowerCase();
    if (!["dinheiro", "cartao", "credito", "debito", "c.credito", "c.debito", "C.Crédito", "C.Debito"].map(x => String(x).toLowerCase()).includes(m)) {
      return res.status(400).json({ message: "Método inválido. Use dinheiro, cartão, crédito ou débito." });
    }

    const v = round2(toNum(valor));
    if (!Number.isFinite(v) || v <= 0) {
      return res.status(400).json({ message: "Valor inválido." });
    }

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);
    await vincularPedidoAoCaixa(pedido, caixa);

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    const g = getGarcomFromReq(req);
    const recebidoPorRole = req.role === "garcom" ? "garcom" : "restaurante";
    const recebidoPorId =
      recebidoPorRole === "garcom" ? (g.id || null) : (req.userId ? String(req.userId) : null);

    pedido.pagamentos.push({
      metodo: m,
      valor: v,
      status: "confirmado",
      recebidoEm: new Date(),
      recebidoPor: recebidoPorId && mongoose.Types.ObjectId.isValid(recebidoPorId)
        ? new mongoose.Types.ObjectId(recebidoPorId)
        : null,
      recebidoPorRole,
      obs: String(obs || "").trim(),
    });

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);
    await registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId: mesa.restauranteId });
    await recalcularCaixa(caixa._id || caixa.id);

    const metodosConfirmados = new Set(
      (pedido.pagamentos || [])
        .filter((p) => String(p.status || "").toLowerCase() === "confirmado")
        .map((p) => String(p.metodo || "").toLowerCase())
        .filter(Boolean)
    );
    if (metodosConfirmados.size > 1) pedido.formadePagamento = "misto";
    else if (metodosConfirmados.size === 1) pedido.formadePagamento = [...metodosConfirmados][0];

    if (pendente <= 0 && total > 0) {
      await registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId: mesa.restauranteId });
      await recalcularCaixa(caixa._id || caixa.id);
      await liberarMesaGenerico({ req, mesa, pedido });
      return res.json({ ok: true, fechado: true, mesa, pedido, total, pago, pendente: 0 });
    }

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({ ok: true, fechado: false, mesa, pedido, total, pago, pendente });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({
      message: error?.message || "Erro ao registrar pagamento.",
      error: error?.message,
    });
  }
};

/* =========================
   ✅ NOVO (PAINEL): Gerar PIX parcial (balcão)
========================= */
exports.gerarPixMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const valorReq = req.body?.valor;

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);
    await vincularPedidoAoCaixa(pedido, caixa);

    const { pendente: pendenteAntes, total } = recalcPagamentoPedido(pedido);
    await pedido.save().catch(() => {});

    const valorPix = round2(toNum(valorReq != null ? valorReq : pendenteAntes));
    if (!Number.isFinite(valorPix) || valorPix <= 0) {
      return res.status(400).json({ message: "Valor PIX inválido." });
    }
    if (valorPix > total) {
      return res.status(400).json({ message: "Valor PIX não pode ser maior que o total." });
    }

    const restaurante = await Restaurante.findById(mesa.restauranteId).select("nome mercadoPago telefone");
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const { conectado, accessToken } = getMercadoPagoInfo(restaurante);

    if (!conectado || !accessToken) {
      return res.status(400).json({
        message: "Pix indisponível: restaurante não conectado ao Mercado Pago.",
        code: "MP_NAO_CONECTADO",
      });
    }

    const nomeCliente = pedido?.nomeCliente || `Mesa ${mesa.numero || ""}`.trim() || "Cliente";
    const telefoneCliente = pedido?.telefoneCliente || restaurante?.telefone || "";

    const pix = await criarPagamentoPix({
      accessToken,
      pedidoId: pedido?.numeroPedido || String(pedido._id),
      valorTotal: valorPix,
      nomeCliente,
      telefoneCliente,
    });

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    const g = getGarcomFromReq(req);
    const recebidoPorRole = req.role === "garcom" ? "garcom" : "restaurante";
    const recebidoPorId =
      recebidoPorRole === "garcom" ? (g.id || null) : (req.userId ? String(req.userId) : null);

    pedido.pagamentos.push({
      metodo: "pix",
      valor: valorPix,
      status: "pendente",
      recebidoEm: new Date(),
      recebidoPor: recebidoPorId && mongoose.Types.ObjectId.isValid(recebidoPorId)
        ? new mongoose.Types.ObjectId(recebidoPorId)
        : null,
      recebidoPorRole,
      mpPaymentId: pix?.paymentId ? String(pix.paymentId) : null,
      mpStatus: pix?.status || "pending",
      pixQrCode: pix?.qrCode || "",
      pixQrCodeBase64: pix?.qrCodeBase64 || "",
    });

    pedido.formadePagamento = (pedido.pagamentos || []).length > 1 ? "misto" : "pix";

    recalcPagamentoPedido(pedido);
    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({
      ok: true,
      pedidoId: String(pedido._id),
      paymentId: pix?.paymentId ? String(pix.paymentId) : null,
      statusPagamento: pix?.status || "pending",
      valor: valorPix,
      qrCode: pix?.qrCode || "",
      qrCodeBase64: pix?.qrCodeBase64 || "",
      total: pedido.valorTotal,
      pago: pedido.valorPago,
      pendente: pedido.valorPendente,
    });
  } catch (error) {
    const mpStatus = error?.response?.status;
    const mpData = error?.response?.data;

    console.error("🔥 gerarPixMesaPainel MP:", mpStatus, mpData || error);

    return res.status(mpStatus || 500).json({
      message: mpData?.message || mpData?.error || error?.message || "Erro ao gerar Pix.",
      error: mpData || error?.message,
    });
  }
};

/* =========================
   ✅ NOVO (PAINEL): Consultar PIX parcial (balcão) e confirmar
========================= */
exports.statusPixMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;

    // ✅ aceita query OU param (rota /pix/:paymentId/status)
    const paymentId =
      String(req.params?.paymentId || "").trim() ||
      String(req.query?.paymentId || "").trim();

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(404).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);
    await vincularPedidoAoCaixa(pedido, caixa);

    const restaurante = await Restaurante.findById(mesa.restauranteId).select("mercadoPago");
    const { accessToken } = getMercadoPagoInfo(restaurante);

    if (!accessToken) {
      return res.status(400).json({ message: "Restaurante não conectado ao Mercado Pago." });
    }

    const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    // se veio paymentId, busca ele; senão pega o pix pendente mais recente
    let alvo = null;

    if (paymentId) {
      alvo = pagamentos.find((p) => p?.mpPaymentId && String(p.mpPaymentId) === paymentId) || null;
    } else {
      // pega o último pendente
      for (let i = pagamentos.length - 1; i >= 0; i--) {
        const p = pagamentos[i];
        if (String(p?.metodo || "").toLowerCase() === "pix" && String(p?.status || "") === "pendente") {
          alvo = p;
          break;
        }
      }
    }

    if (!alvo?.mpPaymentId) {
      return res.status(404).json({ message: "Pagamento PIX pendente não encontrado." });
    }

    const mp = await consultarPagamento({ accessToken, paymentId: String(alvo.mpPaymentId) });
    const st = String(mp?.status || "").toLowerCase() || alvo.mpStatus || "pending";

    if (mp?.point_of_interaction?.transaction_data?.qr_code) {
      alvo.pixQrCode = mp.point_of_interaction.transaction_data.qr_code;
    }
    if (mp?.point_of_interaction?.transaction_data?.qr_code_base64) {
      alvo.pixQrCodeBase64 = mp.point_of_interaction.transaction_data.qr_code_base64;
    }

    alvo.mpStatus = st;

    if (isPaidStatus(st)) {
      alvo.status = "confirmado";
      // (se você quiser guardar, adicione confirmadoEm no schema de PagamentoSchema)
      // alvo.confirmadoEm = new Date();
    }

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);

    if (pendente <= 0 && total > 0) {
      await registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId: mesa.restauranteId });
      await recalcularCaixa(caixa._id || caixa.id);
      await liberarMesaGenerico({ req, mesa, pedido });
      return res.json({
        ok: true,
        paid: true,
        fechado: true,
        status: st,
        paymentId: String(alvo.mpPaymentId),
        total,
        pago,
        pendente: 0,
        mesa,
        pedido,
      });
    }

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({
      ok: true,
      paid: isPaidStatus(st),
      fechado: false,
      status: st,
      paymentId: String(alvo.mpPaymentId),
      total,
      pago,
      pendente,
      qrCode: alvo.pixQrCode || "",
      qrCodeBase64: alvo.pixQrCodeBase64 || "",
    });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({
      message: error?.message || "Erro ao consultar status do Pix (balcão).",
      error: error?.message,
    });
  }
};

/* =========================
   ✅ FECHAR/ENCERRAR MESA (PAINEL) - respeita parcial
========================= */
exports.fecharMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);
    await vincularPedidoAoCaixa(pedido, caixa);

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);

    if (pendente > 0) {
      await pedido.save().catch(() => {});
      return res.status(409).json({
        message: "Ainda falta pagar para encerrar a mesa.",
        total,
        pago,
        pendente,
        pedido,
      });
    }

    await registrarPagamentosConfirmadosNoCaixa({ pedido, caixa, restauranteId: mesa.restauranteId });
    await recalcularCaixa(caixa._id || caixa.id);

    await liberarMesaGenerico({ req, mesa, pedido });

    return res.json({
      message: "Mesa encerrada com sucesso.",
      total,
      pago,
      pendente: 0,
      mesa,
      pedido,
    });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao fechar mesa (painel)", error });
  }
};

/* =========================
   ✅ APP DO GARÇOM
========================= */

exports.listarMesasApp = async (req, res) => {
  try {
    const restauranteId = req.restauranteId || req.user?.restauranteId || req.userId;
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não autenticado." });

    // Performance: usa SQL direto com WHERE restauranteId. O adapter Mongoose/MySQL
    // fazia SELECT * em mesas e filtrava em memória.
    const [rows] = await queryWithRetry(
      `SELECT * FROM mesas WHERE restauranteId = ? ORDER BY CAST(numero AS UNSIGNED), numero`,
      [String(restauranteId)]
    );
    return res.json(rows.map(mesaRowToLean));
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar mesas (app).", error: error.message });
  }
};

exports.getComandaMesaApp = async (req, res) => {
  req.role = "garcom";
  return exports.buscarComandaAtualMesa(req, res);
};

exports.adicionarItensMesaApp = async (req, res) => {
  req.role = "garcom";
  return exports.adicionarItensMesaPainel(req, res);
};

/* =========================
   ✅ PIX - GERAR (APP GARÇOM)  [TOTAL APENAS]
========================= */
exports.gerarPixMesaApp = async (req, res) => {
  try {
    req.role = "garcom";

    const { mesaId } = req.params;

    const mesa = await assertMesaDoRestaurante(req, mesaId);
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const caixa = await exigirCaixaAberto(mesa.restauranteId);
    await vincularPedidoAoCaixa(pedido, caixa);

    const g = getGarcomFromReq(req);
    let changed = false;

    if (g.id && !pedido.garcomId) {
      pedido.garcomId = g.id;
      pedido.garcomNome = g.nome;
      changed = true;
    }

    const restaurante = await Restaurante.findById(mesa.restauranteId).select("nome mercadoPago telefone");
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const { conectado, accessToken } = getMercadoPagoInfo(restaurante);

    if (!conectado || !accessToken) {
      return res.status(400).json({
        message: "Pix indisponível: restaurante não conectado ao Mercado Pago.",
        code: "MP_NAO_CONECTADO",
      });
    }

    if (pedido?.mpPaymentId && (pedido?.pixQrCodeBase64 || pedido?.pixQrCode)) {
      if (changed) await pedido.save();

      return res.json({
        ok: true,
        reused: true,
        pedidoId: String(pedido._id),
        paymentId: String(pedido.mpPaymentId),
        statusPagamento: pedido.statusPagamento || "pending",
        qrCode: pedido.pixQrCode || "",
        qrCodeBase64: pedido.pixQrCodeBase64 || "",
      });
    }

    const total = calcularTotalPedido(pedido);
    if (!total || total <= 0) return res.status(400).json({ message: "Total inválido para Pix." });

    const nomeCliente = pedido?.nomeCliente || `Mesa ${mesa.numero || ""}`.trim() || "Cliente";
    const telefoneCliente = pedido?.telefoneCliente || restaurante?.telefone || "";

    const pix = await criarPagamentoPix({
      accessToken,
      pedidoId: pedido?.numeroPedido || String(pedido._id),
      valorTotal: total,
      nomeCliente,
      telefoneCliente,
    });

    pedido.formadePagamento = "pix";
    pedido.status = "aguardando_pagamento";
    pedido.mpPaymentId = pix?.paymentId ? String(pix.paymentId) : null;
    pedido.statusPagamento = pix?.status || "pending";
    pedido.pixQrCode = pix?.qrCode || "";
    pedido.pixQrCodeBase64 = pix?.qrCodeBase64 || "";
    pedido.valorTotal = total;

    // compat campos novos
    pedido.valorPago = 0;
    pedido.valorPendente = total;

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${mesa.restauranteId}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({
      ok: true,
      reused: false,
      pedidoId: String(pedido._id),
      paymentId: String(pedido.mpPaymentId),
      statusPagamento: pedido.statusPagamento,
      qrCode: pedido.pixQrCode,
      qrCodeBase64: pedido.pixQrCodeBase64,
    });
  } catch (error) {
    const mpStatus = error?.response?.status;
    const mpData = error?.response?.data;

    console.error("🔥 gerarPixMesaApp MP:", mpStatus, mpData || error);

    return res.status(mpStatus || 500).json({
      message: mpData?.message || mpData?.error || error?.message || "Erro ao gerar Pix.",
      error: mpData || error?.message,
    });
  }
};

/* =========================
   ✅ PIX - STATUS (APP GARÇOM)
========================= */
exports.statusPixMesaApp = async (req, res) => {
  try {
    req.role = "garcom";
    const { mesaId } = req.params;

    const mesa = await assertMesaDoRestaurante(req, mesaId);
    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });

    if (!mesa.pedidoAtualId) return res.status(404).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    if (!pedido.mpPaymentId) {
      return res.status(404).json({
        message: "Pagamento Pix ainda não foi gerado para este pedido.",
      });
    }

    const restaurante = await Restaurante.findById(mesa.restauranteId).select("mercadoPago");
    const { accessToken } = getMercadoPagoInfo(restaurante);

    if (!accessToken) {
      return res.status(400).json({
        message: "Restaurante não conectado ao Mercado Pago.",
        code: "MP_NAO_CONECTADO",
      });
    }

    const mp = await consultarPagamento({ accessToken, paymentId: String(pedido.mpPaymentId) });
    const st = String(mp?.status || "").toLowerCase() || pedido.statusPagamento || "pending";

    if (mp?.point_of_interaction?.transaction_data?.qr_code) {
      pedido.pixQrCode = mp.point_of_interaction.transaction_data.qr_code;
    }
    if (mp?.point_of_interaction?.transaction_data?.qr_code_base64) {
      pedido.pixQrCodeBase64 = mp.point_of_interaction.transaction_data.qr_code_base64;
    }

    if (isPaidStatus(st)) {
      await finalizarVendaPix({ req, mesa, pedido, statusPagamento: st });

      return res.json({
        ok: true,
        status: st,
        statusPagamento: st,
        paid: true,
        paymentId: String(pedido.mpPaymentId),
        qrCode: pedido.pixQrCode || "",
        qrCodeBase64: pedido.pixQrCodeBase64 || "",
      });
    }

    const g = getGarcomFromReq(req);
    let changed = false;

    if (g.id && !pedido.garcomId) {
      pedido.garcomId = g.id;
      pedido.garcomNome = g.nome;
      changed = true;
    }

    if (String(pedido.statusPagamento || "").toLowerCase() !== st) {
      pedido.statusPagamento = st;
      changed = true;
    }

    pedido.valorTotal = calcularTotalPedido(pedido);
    pedido.valorPago = 0;
    pedido.valorPendente = pedido.valorTotal;

    if (changed) await pedido.save();

    return res.json({
      ok: true,
      status: st,
      statusPagamento: st,
      paid: false,
      paymentId: String(pedido.mpPaymentId),
      qrCode: pedido.pixQrCode || "",
      qrCodeBase64: pedido.pixQrCodeBase64 || "",
    });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({
      message: error?.message || "Erro ao consultar status do Pix.",
      error: error?.message,
    });
  }
};

/* =========================
   ✅ RESUMO HOME (APP GARÇOM)
========================= */
exports.resumoHomeApp = async (req, res) => {
  try {
    const restauranteId = req.restauranteId || req.user?.restauranteId || req.userId;
    const gReq = getGarcomFromReq(req);
    const garcomId = gReq?.id ? String(gReq.id) : null;
    const garcomNomeReq = gReq?.nome || req.user?.nome || req.user?.apelido || "Garçom";

    if (!restauranteId) return res.status(401).json({ message: "Restaurante não autenticado." });

    // Cache curto para segurar rajadas do Hub quando a Home remonta/atualiza várias vezes.
    // Mantém atualização praticamente em tempo real, mas evita 5 consultas iguais simultâneas.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const cacheKey = `${restauranteId}:${garcomId || "all"}`;
    const forceFresh = req.query?.fresh || req.query?.noCache || req.query?._t;
    const cached = resumoHomeCache.get(cacheKey);
    if (!forceFresh && RESUMO_HOME_CACHE_MS > 0 && cached && Date.now() - cached.ts < RESUMO_HOME_CACHE_MS) {
      return res.json({ ...cached.data, cache: true });
    }

    const { inicio, fim, ymd } = hojeSqlLocal();

    const norm = (v) => String(v || "").trim().toLowerCase();
    const sameId = (a, b) => a && b && String(a) === String(b);
    const valorPedido = (p) => Number(p?.valorTotal ?? p?.total ?? p?.valor ?? 0) || 0;

    const STATUS_AGUARDANDO_PAGAMENTO = new Set(["aguardando_pagamento", "pagamento_pendente", "pending_payment"]);
    const STATUS_FINALIZADOS = new Set(["entregue", "finalizado", "cancelado", "cancelado_cliente", "cancelado_restaurante"]);
    const STATUS_ATIVOS = new Set([
      "pendente", "novo", "em_aberto", "aberto", "aguardando_resposta", "aceito", "recebido",
      "em_preparo", "preparando", "producao", "em_producao", "pronto", "em_entrega", "em_rota",
    ]);
    const STATUS_MESA_ABERTA = new Set(["ocupada", "ocupado", "aberta", "aberto", "em_aberto"]);

    const [mesasRows, pedidosRows] = await Promise.all([
      queryWithRetry(
        `SELECT id, numero, status, pedidoAtualId, ocupadaDesde
           FROM mesas
          WHERE restauranteId = ?`,
        [String(restauranteId)]
      ).then(([rows]) => rows),
      queryWithRetry(
        `SELECT id, numeroPedido, restaurante, mesaId, mesaNumero, nomeCliente, itens, total,
                formaPagamento, status, statusPagamento, origem, pagamentos, valorPago, valorPendente,
                garcomId, garcomNome, recebidoPor, recebidoPorNome, fechadoPor, fechadoPorNome,
                criadoPor, criadoPorNome, criadoEm, pagoEm, entregueEm, canceladoEm, created_at
           FROM pedidos
          WHERE restaurante = ?
            AND criadoEm >= ? AND criadoEm <= ?
          ORDER BY criadoEm DESC, created_at DESC
          LIMIT 600`,
        [String(restauranteId), inicio, fim]
      ).then(([rows]) => rows),
    ]);

    const todosPedidos = pedidosRows.map(rowToPedidoLean);
    const pedidosPorId = new Map(todosPedidos.map((p) => [String(p?._id || p?.id || ""), p]));

    const isAguardandoPagamento = (pedido) =>
      STATUS_AGUARDANDO_PAGAMENTO.has(norm(pedido?.status)) ||
      STATUS_AGUARDANDO_PAGAMENTO.has(norm(pedido?.statusPagamento));

    const isFinalizado = (pedido) =>
      STATUS_FINALIZADOS.has(norm(pedido?.status)) || !!pedido?.canceladoEm;

    const isAtivoOperacional = (pedido) => {
      const st = norm(pedido?.status);
      if (isAguardandoPagamento(pedido) || isFinalizado(pedido)) return false;
      return STATUS_ATIVOS.has(st) || (!st && !isFinalizado(pedido));
    };

    const mesasAbertas = (Array.isArray(mesasRows) ? mesasRows : []).filter((mesa) => {
      if (!STATUS_MESA_ABERTA.has(norm(mesa?.status))) return false;
      const pedidoId = mesa?.pedidoAtualId ? String(mesa.pedidoAtualId) : "";
      if (!pedidoId) return true;
      const pedido = pedidosPorId.get(pedidoId);
      return !pedido || !isFinalizado(pedido);
    }).length;

    const pedidosOperacionaisHoje = todosPedidos.filter(isAtivoOperacional);
    const pedidosPendentes = pedidosOperacionaisHoje.length;

    const isPago = (pedido) => {
      const stPag = norm(pedido?.statusPagamento);
      const st = norm(pedido?.status);
      return stPag === "pago" || stPag === "confirmado" || st === "pago" || Number(pedido?.valorPago || 0) > 0;
    };

    const pagamentoConfirmadoGarcom = (pedido) => {
      const pagamentos = Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : [];
      return [...pagamentos].reverse().find((p) => {
        const status = norm(p?.status);
        const role = norm(p?.recebidoPorRole || p?.role);
        return (status === "confirmado" || status === "pago" || status === "approved") && role === "garcom";
      }) || null;
    };

    const atribuirGarcomPedido = (pedido) => {
      const pag = pagamentoConfirmadoGarcom(pedido);
      const idRaw = pedido?.garcomId || pedido?.fechadoPor || pedido?.recebidoPor || pedido?.criadoPor || pag?.recebidoPor || pag?.garcomId || null;
      const nomeRaw = pedido?.garcomNome || pedido?.fechadoPorNome || pedido?.recebidoPorNome || pedido?.criadoPorNome || pag?.recebidoPorNome || pag?.garcomNome || null;

      let id = idRaw ? String(idRaw) : null;
      let nome = nomeRaw || null;

      if (!id && garcomId && ["balcao", "mesa", "garcom"].includes(norm(pedido?.origem))) {
        id = garcomId;
        nome = garcomNomeReq;
      }
      if (sameId(id, garcomId)) nome = garcomNomeReq || nome;
      if (!id && nome) id = `nome:${String(nome).trim().toLowerCase()}`;
      return id ? { id, nome: nome || (sameId(id, garcomId) ? garcomNomeReq : "Sem garçom") } : null;
    };

    const pedidosValidosParaTurno = todosPedidos.filter((pedido) => !isFinalizado(pedido) || isPago(pedido));

    const pedidosHojeGarcom = pedidosValidosParaTurno.filter((pedido) => {
      const atrib = atribuirGarcomPedido(pedido);
      return atrib && sameId(atrib.id, garcomId);
    });
    const pedidosPagosHojeGarcom = pedidosHojeGarcom.filter(isPago);
    const vendasHojeGarcom = pedidosPagosHojeGarcom.reduce((acc, p) => acc + valorPedido(p), 0);
    const vendasLancadasHojeGarcom = pedidosHojeGarcom.reduce((acc, p) => acc + valorPedido(p), 0);

    const rankingMap = new Map();
    pedidosValidosParaTurno.forEach((pedido) => {
      const atrib = atribuirGarcomPedido(pedido);
      if (!atrib) return;
      const atual = rankingMap.get(atrib.id) || { id: atrib.id, nome: atrib.nome, pedidos: 0, total: 0 };
      atual.nome = sameId(atrib.id, garcomId) ? garcomNomeReq : (atrib.nome || atual.nome);
      atual.pedidos += 1;
      atual.total += valorPedido(pedido);
      rankingMap.set(atrib.id, atual);
    });

    if (garcomId && !rankingMap.has(garcomId)) {
      rankingMap.set(garcomId, { id: garcomId, nome: garcomNomeReq, pedidos: pedidosPagosHojeGarcom.length, total: vendasHojeGarcom });
    }

    const rankingGarcons = Array.from(rankingMap.values())
      .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
      .slice(0, 5);

    const data = {
      mesasAbertas,
      mesasOcupadas: mesasAbertas,
      pedidosPendentes,
      pedidosFila: pedidosPendentes,
      pedidosHojeGarcom: pedidosHojeGarcom.length,
      vendasHojeGarcom,
      vendasLancadasHojeGarcom,
      rankingGarcons,
      rankingGarconsHoje: rankingGarcons,
      filtros: {
        pedidosAtivos: Array.from(STATUS_ATIVOS),
        ignorados: Array.from(STATUS_AGUARDANDO_PAGAMENTO),
        hoje: { inicio, fim, data: ymd },
      },
    };

    resumoHomeCache.set(cacheKey, { ts: Date.now(), data });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao gerar resumo da home",
      error: error?.message,
    });
  }
};

// ✅ enviar PIX (copia/cola) via BOT (WhatsApp) — mensagem dividida + QR (se tiver)
exports.enviarPixWhatsappMesaPainel = async (req, res) => {
  try {
    const { mesaId } = req.params;
    const { numero, paymentId } = req.body;

    const soDigitos = String(numero || "").replace(/\D/g, "");
    if (!soDigitos || soDigitos.length < 10) {
      return res.status(400).json({ message: "Número inválido. Envie com DDD (ex: 81999999999)." });
    }

    // ⚠️ você pode mandar "soDigitos" direto e deixar o bot normalizar.
    // Mantive sua regra aqui pra não mudar comportamento.
    let numeroFinal = soDigitos;
    if (!numeroFinal.startsWith("55") && (numeroFinal.length === 10 || numeroFinal.length === 11)) {
      numeroFinal = `55${numeroFinal}`;
    }

    const mesa =
      req.role === "garcom"
        ? await assertMesaDoRestaurante(req, mesaId)
        : await Mesa.findById(mesaId);

    if (!mesa) return res.status(404).json({ message: "Mesa não encontrada" });
    if (!mesa.pedidoAtualId) return res.status(409).json({ message: "Mesa sem comanda aberta." });

    const pedido = await Pedido.findById(mesa.pedidoAtualId);
    if (!pedido) return res.status(404).json({ message: "Pedido atual não encontrado." });

    const restauranteId = String(mesa.restauranteId);
    const conectado = estaConectado(restauranteId);

    if (!conectado) {
      return res.status(409).json({
        message: "Bot não está conectado. Ligue/conecte o bot antes de enviar o PIX no WhatsApp.",
        code: "BOT_OFFLINE",
      });
    }

    const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    let alvo = null;
    if (paymentId) {
      alvo = pagamentos.find((p) => String(p?.mpPaymentId || "") === String(paymentId)) || null;
    } else {
      for (let i = pagamentos.length - 1; i >= 0; i--) {
        const p = pagamentos[i];
        if (String(p?.metodo || "").toLowerCase() === "pix" && String(p?.status || "") === "pendente") {
          alvo = p;
          break;
        }
      }
    }

    if (!alvo) {
      return res.status(404).json({
        message: "Não encontrei um PIX pendente para enviar. Gere um PIX primeiro.",
        code: "PIX_PENDENTE_NAO_ENCONTRADO",
      });
    }

    const valorPix = Number(alvo.valor || 0);
    if (!valorPix || valorPix < 1) {
      return res.status(400).json({ message: "Valor do PIX precisa ser no mínimo R$ 1,00." });
    }

    const copiaCola = String(alvo.pixQrCode || "").trim();
    if (!copiaCola) {
      return res.status(409).json({
        message: "PIX gerado, mas o código copia/cola ainda não está disponível. Tente consultar o status primeiro.",
        code: "PIX_SEM_COPIA_COLA",
      });
    }

    // (opcional) recalcula pra mostrar no texto
    const { total, pago, pendente } = recalcPagamentoPedido(pedido);
    await pedido.save().catch(() => {});

    const nomeCliente = pedido?.nomeCliente || `${mesa.numero || ""}`.trim() || "Cliente";
    const qrBase64 = String(alvo.pixQrCodeBase64 || "").trim();

    // 1) RESUMO (com QR se tiver)
    const resumo = [
      "📲 *PAGAMENTO VIA PIX*",
      `🍽️ *Mesa:* ${mesa?.numero || "-"}`,
      `👤 *Cliente:* ${nomeCliente}`,
      "",
      `💰 *Valor do PIX:* R$ ${Number(valorPix).toFixed(2)}`,
      `🧾 *Total:* R$ ${Number(total || 0).toFixed(2)}`,
      `✅ *Pago:* R$ ${Number(pago || 0).toFixed(2)}`,
      `⏳ *Pendente:* R$ ${Number(pendente || 0).toFixed(2)}`,
      "",
      "Abra o app do banco e escaneie o QR ✅",
    ].join("\n");

    if (qrBase64) {
      await enviarMensagemMidia(restauranteId, numeroFinal, qrBase64, resumo);
    } else {
      await enviarMensagem(restauranteId, numeroFinal, resumo);
    }

    // 2) LABEL (separada)
    await enviarMensagem(restauranteId, numeroFinal, "📋 *PIX Copia e Cola:*");

    // 3) CÓDIGO PURO (pra copiar fácil)
    await enviarMensagem(restauranteId, numeroFinal, copiaCola);

    // 4) AVISO (separado)
    await enviarMensagem(restauranteId, numeroFinal, "⚠️ *Após pagar, aguarde a confirmação.*");

    return res.json({
      ok: true,
      message: "Mensagem PIX enviada no WhatsApp pelo bot (em partes).",
      numero: numeroFinal,
      paymentId: String(alvo?.mpPaymentId || ""),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao enviar PIX pelo WhatsApp (bot).",
      error: error?.message,
    });
  }
};
