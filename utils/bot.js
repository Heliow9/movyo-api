// utils/bot.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const Restaurante = require("../models/Restaurante");
const Produto = require("../models/Produto");
const CategoriaProduto = require("../models/CategoriaProduto");
const Pedido = require("../models/Pedido");
const { criarPagamentoPix } = require("../services/mercadoPagoPixService");

// ✅ NOVO: horários de atendimento (horariosFuncionamento)
const { statusAtendimento } = require("./atendimento");

/* =========================================================
   ESTADO GLOBAL
========================================================= */
const instanciasAtivas = {};
const emExecucao = {};
const botsEncerrados = {};
const qrs = {};

// Estado de conexão
const botConnState = {}; // restauranteId -> "open" | "close" | "connecting"
const lastConnUpdate = {}; // restauranteId -> ts
const reconnectAttempts = {}; // restauranteId -> n

// Fila por restaurante (envio sequencial)
const sendQueue = new Map(); // restauranteId -> Promise

// Dedup PIX
const pixDedup = new Map(); // key -> ts
const PIX_DEDUP_TTL = 90_000; // 90s

// Cache restaurante
const restauranteCache = new Map(); // restauranteId -> { data, ts }
const REST_CACHE_TTL_MS = 5_000; // menor para não responder fechado com status antigo

// Anti-flood caches
const MAX_CACHE_ENTRIES = 10_000;

// Saudação
const ultimoCumprimento = new Map(); // `${restauranteId}:${jid}` -> ts
const GREETING_COOLDOWN_MS_FALLBACK = 2 * 60 * 60 * 1000; // 2h

// Q&A spam curto (não atrapalha perguntas em sequência)
const ultimoQna = new Map(); // `${restauranteId}:${jid}` -> ts
const QNA_SPAM_MS = 1200;

// ✅ NOVO: evita spam de "estamos fechados"
const ultimoFechadoAviso = new Map(); // `${restauranteId}:${jid}` -> ts
const FECHADO_COOLDOWN_MS = 10 * 60 * 1000; // 10 min

// Repetir último pedido pelo WhatsApp
const reorderIntent = new Map(); // `${restauranteId}:${jid}` -> { pedidoId, ts }
const REORDER_INTENT_TTL_MS = 10 * 60 * 1000;

// Dedup por msgId
const handledMsgIds = new Map(); // msgId -> ts
const HANDLED_TTL_MS = 2 * 60 * 1000;

// Gap entre envios do sistema (PIX partes)
const DEFAULT_SEND_GAP_MS = Number(process.env.BOT_SEND_GAP_MS || 900);
const BOT_TYPING_MIN_MS = Number(process.env.BOT_TYPING_MIN_MS || 900);
const BOT_TYPING_MAX_MS = Number(process.env.BOT_TYPING_MAX_MS || 3200);
const BOT_REACTION_DELAY_MIN_MS = Number(process.env.BOT_REACTION_DELAY_MIN_MS || 250);
const BOT_REACTION_DELAY_MAX_MS = Number(process.env.BOT_REACTION_DELAY_MAX_MS || 750);

// Conexão WhatsApp/Baileys
const BOT_CONNECT_TIMEOUT_MS = Number(process.env.BOT_CONNECT_TIMEOUT_MS || 70_000);
const BOT_RESTART_REQUIRED_DELAY_MS = Number(process.env.BOT_RESTART_REQUIRED_DELAY_MS || 1_500);
const BOT_MAX_RECONNECT_ATTEMPTS = Number(process.env.BOT_MAX_RECONNECT_ATTEMPTS || 50);
const BOT_KEEP_ALIVE_MS = Number(process.env.BOT_KEEP_ALIVE_MS || 20_000);
const BOT_CONNECT_TIMEOUT_SOCKET_MS = Number(process.env.BOT_CONNECT_TIMEOUT_SOCKET_MS || 60_000);
const CARDAPIO_BASE_URL = String(process.env.CARDAPIO_BASE_URL || process.env.VITRINE_BASE_URL || "https://app.movyo.delivery").trim().replace(/\/+$/, "");
const BOT_RESPONDER_GRUPOS = normalizeBoolean(process.env.BOT_RESPONDER_GRUPOS, false);

// Watchdog de conexão por restaurante
const connectionWatchdogs = {};
const reconnectTimers = {};
const lastQrRequestAt = {};

/* =========================================================
   UTILS
========================================================= */
function now() {
  return Date.now();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function randomBetween(min, max) {
  const a = Math.max(0, Number(min || 0));
  const b = Math.max(a, Number(max || a));
  return Math.floor(a + Math.random() * (b - a + 1));
}

function clearRestauranteCache(restauranteId) {
  if (restauranteId) restauranteCache.delete(restauranteId);
}

function getDisconnectCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.statusCode ||
    lastDisconnect?.error?.data?.statusCode ||
    lastDisconnect?.error?.data?.status ||
    lastDisconnect?.error?.code ||
    null
  );
}

function getDisconnectMessage(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.payload?.message ||
    lastDisconnect?.error?.message ||
    lastDisconnect?.error?.toString?.() ||
    "desconhecido"
  );
}

function limparWatchdog(restauranteId) {
  if (connectionWatchdogs[restauranteId]) {
    clearTimeout(connectionWatchdogs[restauranteId]);
    delete connectionWatchdogs[restauranteId];
  }
}

function fecharSocketSeguro(sock) {
  if (!sock) return;
  try { sock.ev?.removeAllListeners?.("connection.update"); } catch {}
  try { sock.ev?.removeAllListeners?.("creds.update"); } catch {}
  try { sock.ev?.removeAllListeners?.("messages.upsert"); } catch {}
  try { sock.ws?.close?.(); } catch {}
  try { sock.end?.(); } catch {}
}

function limparInstancia(restauranteId, { fechar = true } = {}) {
  const sock = instanciasAtivas[restauranteId];
  if (fechar) fecharSocketSeguro(sock);
  delete instanciasAtivas[restauranteId];
  botConnState[restauranteId] = "close";
  limparWatchdog(restauranteId);
}


function isBotLigado(restaurante) {
  // Em MySQL, statusBot pode vir como objeto, string JSON, 0/1 ou sem a chave ligado.
  // Só consideramos desligado quando vier false/0/off de forma explícita.
  const st = safeJson(restaurante?.statusBot, restaurante?.statusBot || {});
  return normalizeBoolean(st?.ligado, true);
}

function isRestartableDisconnect(code, message) {
  const c = Number(code);
  const msg = String(message || "").toLowerCase();
  return (
    c === 515 ||
    c === 408 ||
    c === DisconnectReason.restartRequired ||
    c === DisconnectReason.timedOut ||
    msg.includes("stream errored") ||
    msg.includes("restart required") ||
    msg.includes("timed out") ||
    msg.includes("request time-out")
  );
}

function getRestartDelayMs(restauranteId, isFastRestart = false) {
  if (isFastRestart) return BOT_RESTART_REQUIRED_DELAY_MS;
  return getReconnectDelayMs(restauranteId);
}

async function atualizarStatusBot(restauranteId, patch = {}) {
  try {
    clearRestauranteCache(restauranteId);
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        ...patch,
        "statusBot.atualizadoEm": new Date(),
      },
    });
    clearRestauranteCache(restauranteId);
  } catch (e) {
    console.warn("⚠️ Falha atualizando status do bot:", e?.message || e);
  }
}

function agendarReconexao(restauranteId, callbacks = {}, delayMs, motivo = "") {
  if (botsEncerrados[restauranteId]) return;

  limparWatchdog(restauranteId);

  if (reconnectTimers[restauranteId]) {
    clearTimeout(reconnectTimers[restauranteId]);
    delete reconnectTimers[restauranteId];
  }

  const tentativas = reconnectAttempts[restauranteId] || 0;
  if (tentativas >= BOT_MAX_RECONNECT_ATTEMPTS) {
    console.warn(`⛔ Bot ${restauranteId}: limite de reconexões atingido (${tentativas}).`);
    atualizarStatusBot(restauranteId, {
      "statusBot.conectado": false,
      "statusBot.erroConexao": `Limite de reconexões atingido. Último motivo: ${motivo}`,
    });
    return;
  }

  console.log(`🔁 Reagendando conexão do bot ${restauranteId} em ${Math.round(delayMs / 1000)}s. Motivo: ${motivo}`);
  reconnectTimers[restauranteId] = setTimeout(() => {
    delete reconnectTimers[restauranteId];
    iniciarBot(restauranteId, callbacks.onQRCode, callbacks.onConectado, { force: true }).catch((e) => {
      console.error("❌ Falha ao reiniciar bot:", e?.message || e);
    });
  }, Math.max(250, Number(delayMs || 1000)));
}

function iniciarWatchdogConexao(restauranteId, callbacks = {}) {
  limparWatchdog(restauranteId);

  connectionWatchdogs[restauranteId] = setTimeout(() => {
    const st = botConnState[restauranteId];
    if (st === "open") return;

    console.warn(`⏱️ Bot ${restauranteId}: conexão travada em '${st || "desconhecido"}'. Reiniciando socket...`);
    reconnectAttempts[restauranteId] = (reconnectAttempts[restauranteId] || 0) + 1;
    limparInstancia(restauranteId, { fechar: true });
    atualizarStatusBot(restauranteId, {
      "statusBot.conectado": false,
      "statusBot.erroConexao": `Timeout de conexão (${BOT_CONNECT_TIMEOUT_MS}ms)`,
    });
    agendarReconexao(restauranteId, callbacks, getReconnectDelayMs(restauranteId), "watchdog_timeout");
  }, BOT_CONNECT_TIMEOUT_MS);
}
function trimCache(map) {
  if (map.size > MAX_CACHE_ENTRIES) {
    const remover = Math.floor(MAX_CACHE_ENTRIES * 0.1);
    let i = 0;
    for (const k of map.keys()) {
      map.delete(k);
      if (++i >= remover) break;
    }
  }
}
function trimHandled() {
  const t = now();
  for (const [k, ts] of handledMsgIds.entries()) {
    if (t - ts > HANDLED_TTL_MS) handledMsgIds.delete(k);
  }
}

function safeJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['false', '0', 'nao', 'não', 'no', 'off', 'desligado'].includes(s)) return false;
  if (['true', '1', 'sim', 'yes', 'on', 'ligado'].includes(s)) return true;
  return defaultValue;
}

function normalizarRestauranteBot(doc) {
  if (!doc) return doc;
  const base = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

  base.statusBot = safeJson(base.statusBot, base.statusBot || {});
  base.horariosFuncionamento = safeJson(base.horariosFuncionamento, base.horariosFuncionamento || null);
  base.mensagensPersonalizadas = safeJson(base.mensagensPersonalizadas, base.mensagensPersonalizadas || {});
  base.config = safeJson(base.config, base.config || {});

  if (!base.statusBot || typeof base.statusBot !== 'object') base.statusBot = {};

  // No MySQL antigo, statusBot pode vir vazio/string. Só considera desligado se for explicitamente false/0/off.
  base.statusBot.ligado = normalizeBoolean(base.statusBot.ligado, true);
  base.statusBot.conectado = normalizeBoolean(base.statusBot.conectado, false);

  return base;
}

function botLigado(restaurante) {
  const st = safeJson(restaurante?.statusBot, restaurante?.statusBot || {});
  return normalizeBoolean(st?.ligado, true);
}

function limparCacheRestaurante(restauranteId) {
  if (restauranteId) restauranteCache.delete(String(restauranteId));
}

async function getRestaurante(restauranteId, options = {}) {
  const id = String(restauranteId || '');
  if (!options.force) {
    const cached = restauranteCache.get(id);
    if (cached && now() - cached.ts < REST_CACHE_TTL_MS) return cached.data;
  }

  const doc = await Restaurante.findById(id);
  const normalized = normalizarRestauranteBot(doc);
  if (normalized) restauranteCache.set(id, { data: normalized, ts: now() });
  return normalized;
}

/**
 * ✅ LEGADO (fallback): horárioInicio/horarioFim
 * (mantém compatibilidade se algum restaurante ainda usa esses campos)
 */
function isBusinessHoursLegacy(restaurante) {
  if (!restaurante) return false;
  const on = Number(restaurante.horarioInicio ?? 0);
  const off = Number(restaurante.horarioFim ?? 24);
  const h = new Date().getHours();

  return (on < off && h >= on && h < off) || (on > off && (h >= on || h < off));
}

/**
 * ✅ NOVO: usa horariosFuncionamento (segunda..domingo) + fechado + cruza meia-noite
 * Retorna: { aberto: boolean, texto: string }
 */
function getAtendimentoStatus(restaurante) {
  if (!restaurante) return { aberto: false, texto: "⛔ Estamos fechados no momento." };
  // Não bloqueia atendimento por statusBot.ligado aqui.
  // Se o socket está recebendo mensagem, o bot está ativo; statusBot no MySQL pode estar atrasado/string.
  // O controle de ligar/desligar fica no iniciarBot/pararBot.

  // Se tem o bloco novo de horários, usa ele.
  if (restaurante?.horariosFuncionamento) {
    const st = statusAtendimento(restaurante, new Date());
    return { aberto: !!st?.aberto, texto: st?.texto || "⛔ Estamos fechados no momento." };
  }

  // Fallback legado
  const abertoLegacy = isBusinessHoursLegacy(restaurante);
  return {
    aberto: abertoLegacy,
    texto: abertoLegacy ? "✅ Estamos abertos agora." : "⛔ Estamos fechados no momento.",
  };
}

function podeAvisarFechado(restauranteId, remoteJid) {
  const key = `${restauranteId}:${remoteJid}`;
  const last = ultimoFechadoAviso.get(key) || 0;
  if (now() - last < FECHADO_COOLDOWN_MS) return false;
  ultimoFechadoAviso.set(key, now());
  trimCache(ultimoFechadoAviso);
  return true;
}

/* =========================================================
   NORMALIZAÇÃO BR
========================================================= */
function normalizarNumeroE164BR(numero) {
  const dig = String(numero || "").replace(/\D/g, "");
  if (!dig) return "";
  if (dig.startsWith("55") && (dig.length === 12 || dig.length === 13)) return dig;
  if (dig.length === 10 || dig.length === 11) return `55${dig}`;
  return dig;
}
function normalizarJid(numero) {
  const e164 = normalizarNumeroE164BR(numero);
  return `${e164}@s.whatsapp.net`;
}
function cleanBase64(b64) {
  if (!b64) return "";
  const s = String(b64);
  const idx = s.indexOf("base64,");
  return idx >= 0 ? s.slice(idx + "base64,".length) : s;
}

function formatBRL(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getProdutoPreco(produto) {
  return produto?.precoBase ?? produto?.preco ?? produto?.valor ?? produto?.precoVenda ?? 0;
}

function buildProdutoLinha(p) {
  const preco = getProdutoPreco(p);
  return `• ${p.nome}${preco ? ` — ${formatBRL(preco)}` : ''}`;
}

function escolherReacao(texto) {
  const s = normalizeText(texto);
  if (s.includes('hamburg') || s.includes('burguer') || s.includes('burger')) return '🍔';
  if (s.includes('pizza') || s.includes('sabor')) return '🍕';
  if (s.includes('guarana') || s.includes('refri') || s.includes('coca') || s.includes('bebida') || s.includes('suco')) return '🥤';
  if (s.includes('promo') || s.includes('oferta')) return '🔥';
  if (s.includes('cardapio') || s.includes('menu')) return '❤️';
  if (s.includes('horario') || s.includes('aberto') || s.includes('fecha')) return '🕒';
  return '❤️';
}

async function reagirAntesDeResponder(sock, msg, texto) {
  try {
    await sleep(randomBetween(BOT_REACTION_DELAY_MIN_MS, BOT_REACTION_DELAY_MAX_MS));
    await sock.sendMessage(msg.key.remoteJid, { react: { text: escolherReacao(texto), key: msg.key } });
  } catch {}
}


/* =========================================================
   FILA POR RESTAURANTE
========================================================= */
function enqueueSend(restauranteId, fn) {
  const prev = sendQueue.get(restauranteId) || Promise.resolve();
  const next = prev
    .then(() => fn())
    .catch((e) => {
      console.error("❌ Erro em fila de envio:", e?.message || e);
      throw e;
    })
    .finally(() => {
      if (sendQueue.get(restauranteId) === next) sendQueue.delete(restauranteId);
    });

  sendQueue.set(restauranteId, next);
  return next;
}

/* =========================================================
   DEDUP PIX
========================================================= */
function canSendPixOnce(key) {
  const t = pixDedup.get(key) || 0;
  const n = now();
  if (n - t < PIX_DEDUP_TTL) return false;
  pixDedup.set(key, n);

  if (pixDedup.size > 50000) {
    for (const [k, ts] of pixDedup.entries()) {
      if (n - ts > PIX_DEDUP_TTL * 2) pixDedup.delete(k);
    }
  }
  return true;
}

/* =========================================================
   GUARD DE CONEXÃO
========================================================= */
function assertBotOnline(restauranteId) {
  const sock = instanciasAtivas[restauranteId];
  const st = botConnState[restauranteId];
  if (!sock) throw new Error("Bot não conectado");
  if (st !== "open") throw new Error("Bot offline (sessão não está OPEN)");
  if (!sock.user) throw new Error("Bot ainda não está pronto (sem user)");
  return sock;
}

/* =========================================================
   HELPERS WA
========================================================= */
async function getJidFromNumero(sock, numero) {
  const e164 = normalizarNumeroE164BR(numero);
  if (!e164) throw new Error("Número inválido");

  const [check] = await sock.onWhatsApp(e164);
  if (!check || !check.exists) {
    console.log("❌ Número não existe no WhatsApp:", e164);
    throw new Error("Número não existe no WhatsApp");
  }
  return check.jid;
}

function extrairTexto(msg) {
  if (!msg?.message) return "";
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.buttonsResponseMessage?.selectedDisplayText ||
    msg.message.buttonsResponseMessage?.selectedButtonId ||
    msg.message.templateButtonReplyMessage?.selectedDisplayText ||
    msg.message.templateButtonReplyMessage?.selectedId ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    ""
  );
}

function extrairNomeCliente(sock, remoteJid, msg) {
  const raw =
    String(msg?.pushName || "").trim() ||
    String(sock?.contacts?.[remoteJid]?.name || "").trim() ||
    String(sock?.contacts?.[remoteJid]?.notify || "").trim();
  if (!raw) return "";
  return raw.split(" ")[0].slice(0, 20);
}

function getCardapioUrl(restaurante) {
  const slug = String(restaurante?.slugIdentificador || "").trim().replace(/^\/+|\/+$/g, "");
  return slug ? `${CARDAPIO_BASE_URL}/p/${encodeURIComponent(slug)}` : `${CARDAPIO_BASE_URL}/p/`;
}

function deveIgnorarMensagem(remoteJid) {
  const jid = String(remoteJid || "");
  if (!jid) return true;
  if (jid.endsWith("@broadcast")) return true;
  if (jid.endsWith("@g.us") && !BOT_RESPONDER_GRUPOS) return true;
  if (jid === "status@broadcast") return true;
  return false;
}

function isPedidoCardapio(t) {
  const s = normalizeText(t);
  return (
    s === "cardapio" ||
    s === "menu" ||
    s.includes("manda o cardapio") ||
    s.includes("envia o cardapio") ||
    s.includes("ver cardapio") ||
    s.includes("link do cardapio") ||
    s.includes("fazer pedido") ||
    s.includes("pedido online")
  );
}

function isPerguntaHorario(t) {
  const s = normalizeText(t);
  return (
    s.includes("horario") ||
    s.includes("funcionamento") ||
    s.includes("ta aberto") ||
    s.includes("esta aberto") ||
    s.includes("aberto agora") ||
    s.includes("fecha que horas") ||
    s.includes("abre que horas")
  );
}

/* =========================================================
   PRESENCE (digitando...)
========================================================= */
async function typingDelay(sock, jid, ms) {
  const requested = Number(ms);
  const duration = Number.isFinite(requested)
    ? Math.max(BOT_TYPING_MIN_MS, Math.min(BOT_TYPING_MAX_MS, requested))
    : randomBetween(BOT_TYPING_MIN_MS, BOT_TYPING_MAX_MS);
  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {}
  await sleep(duration + randomBetween(120, 480));
  try {
    await sock.sendPresenceUpdate("paused", jid);
  } catch {}
}

/* =========================================================
   ✅ Envio sequencial com gap (PIX partes)
========================================================= */
async function enviarEmPartes({ restauranteId, jid, parts = [], gapMs = DEFAULT_SEND_GAP_MS }) {
  const sock = assertBotOnline(restauranteId);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.type === "image") {
      const b64 = cleanBase64(part.base64);
      if (!b64) continue;
      const buffer = Buffer.from(b64, "base64");
      await sock.sendMessage(jid, {
        image: buffer,
        caption: String(part.caption || "").slice(0, 900),
      });
    } else {
      await sock.sendMessage(jid, { text: String(part.text || "") });
    }

    if (gapMs && i < parts.length - 1) await sleep(gapMs);
  }
}

/* =========================================================
   BACKOFF RECONEXÃO
========================================================= */
function getReconnectDelayMs(restauranteId) {
  const n = reconnectAttempts[restauranteId] || 0;
  const seq = [3000, 5000, 8000, 13000, 21000, 34000, 55000, 60000];
  return seq[Math.min(n, seq.length - 1)];
}

/* =========================================================
   (Opcional) ESTOQUE: tenta chamar service se existir
========================================================= */
function tryRequire(mod) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(mod);
  } catch {
    return null;
  }
}

const estoqueSvc =
  tryRequire("../services/estoqueService") ||
  tryRequire("../services/estoqueDisponibilidadeService") ||
  null;

async function produtoDisponivelPorEstoque(restauranteId, produtoDoc) {
  try {
    if (!produtoDoc?.ativo) return false;

    if (estoqueSvc?.temEstoqueProduto && typeof estoqueSvc.temEstoqueProduto === "function") {
      const ok = await estoqueSvc.temEstoqueProduto(restauranteId, String(produtoDoc._id));
      return !!ok;
    }
    if (estoqueSvc?.produtoDisponivel && typeof estoqueSvc.produtoDisponivel === "function") {
      const ok = await estoqueSvc.produtoDisponivel(restauranteId, produtoDoc);
      return !!ok;
    }

    // Sem service -> assume disponível (não quebra)
    return true;
  } catch (e) {
    console.warn("⚠️ Falha checando estoque, assumindo disponível:", e?.message || e);
    return true;
  }
}

/* =========================================================
   NLP simples (melhorado)
========================================================= */
const STOPWORDS = new Set([
  "voces",
  "vocês",
  "vcs",
  "vc",
  "tem",
  "têm",
  "temos",
  "ai",
  "aí",
  "por",
  "favor",
  "pf",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "no",
  "na",
  "nos",
  "nas",
  "pra",
  "para",
  "com",
  "sem",
  "me",
  "manda",
  "quero",
  "queria",
  "gostaria",
  "saber",
  "se",
  "sim",
  "não",
  "nao",
  "eh",
  "é",
  "e",
  "isso",
  "essa",
  "esse",
  "este",
  "esta",
  "temai",
  "qual",
  "quais",
  "ultimo",
  "último",
  "pedido",
  "novamente",
  "refazer",
  "repetir",
  "outro",
  "mais",
]);

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(s) {
  return normalizeText(s).replace(/\s+/g, "");
}

function expandirTermosBusca(texto) {
  const base = extractQueryTerm ? extractQueryTerm(texto) : normalizeText(texto);
  const norm = normalizeText(base || texto);
  const termos = new Set([norm]);
  const compact = compactText(norm);
  if (compact) termos.add(compact);

  const mapa = [
    [/coca|cocacola|coca cola|coca-cola/, ["coca", "coca cola", "coca-cola", "cocacola", "refrigerante coca"]],
    [/guarana|guaraná/, ["guarana", "guaraná", "refri guarana", "refrigerante guarana"]],
    [/hamburg|hamburguer|hambúrguer|burger|burguer/, ["hamburguer", "hambúrguer", "burger", "burguer", "lanche"]],
    [/parmegiana|parmegiana|permegiana|parmeggiana/, ["parmegiana", "permegiana", "parmeggiana"]],
    [/refri|refrigerante|bebida/, ["refrigerante", "refri", "bebida"]],
  ];
  for (const [re, vals] of mapa) {
    if (re.test(norm) || re.test(compact)) vals.forEach((v) => termos.add(normalizeText(v)));
  }
  return [...termos].filter(Boolean);
}

function levenshtein(a, b) {
  a = compactText(a); b = compactText(b);
  if (!a || !b) return Math.max(a.length, b.length);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function scoreProdutoBusca(produto, texto) {
  const termos = expandirTermosBusca(texto);
  const nome = normalizeText(produto?.nome || "");
  const desc = normalizeText(produto?.descricao || "");
  const nomeCompact = compactText(nome);
  const hay = `${nome} ${desc} ${nomeCompact}`;
  let score = 0;
  for (const termo of termos) {
    const t = normalizeText(termo);
    const tc = compactText(t);
    if (!t) continue;
    if (nome === t) score += 100;
    if (nome.includes(t)) score += 60;
    if (nomeCompact.includes(tc)) score += 55;
    if (hay.includes(t)) score += 35;
    for (const token of t.split(" ").filter(Boolean)) {
      if (nome.includes(token) || desc.includes(token)) score += 8;
    }
    const dist = levenshtein(nome, t);
    if (dist <= 2 && Math.min(nomeCompact.length, tc.length) >= 5) score += 45 - dist * 8;
  }
  if (produto?.destaque) score += 3;
  return score;
}

function extractQueryTerm(texto) {
  const t = normalizeText(texto);
  if (!t) return "";
  const tokens = t.split(" ").filter(Boolean).filter((w) => !STOPWORDS.has(w));
  return tokens.join(" ").trim();
}

// Pega “sabor” mesmo em frases:
// - "tem pizza de calabresa?"
// - "pizza napolitana"
// - "e de calabresa?"
// - "calabresa"
function extractFlavorCandidate(texto) {
  const t = normalizeText(texto);
  if (!t) return "";

  // "e de calabresa"
  const mE = t.match(/^e\s+(de\s+)?(.+)$/i);
  if (mE?.[2]) return mE[2].trim();

  // "pizza de X" / "sabor X" / "sabores X"
  const m1 = t.match(/(?:pizza|sabor|sabores)\s*(?:de|do|da)?\s+(.+)$/i);
  if (m1?.[1]) return m1[1].trim();

  // fallback: tira stopwords e devolve
  return extractQueryTerm(texto);
}

function isPerguntaDestaques(t) {
  const s = normalizeText(t);
  return (
    s.includes("em destaque") ||
    s.includes("destaque") ||
    s.includes("principais") ||
    s.includes("recomend") ||
    s.includes("mais pedidos") ||
    s.includes("top") ||
    s.includes("sugest")
  );
}

function isPerguntaPromos(t) {
  const s = normalizeText(t);
  return s.includes("promo") || s.includes("promoc") || s.includes("oferta") || s.includes("desconto");
}

function isPerguntaPizzaOuSabor(t) {
  const s = normalizeText(t);
  return s.includes("pizza") || s.includes("sabor") || s.includes("sabores") || s.includes("borda") || /^e\s+(de\s+)?/.test(s);
}

function parecePerguntaDeDisponibilidade(t) {
  const s = normalizeText(t);
  return (
    s.includes("tem ") ||
    s.startsWith("tem") ||
    s.includes("voces tem") ||
    s.includes("vocês tem") ||
    s.includes("vcs tem") ||
    s.includes("tem ai") ||
    s.includes("tem aí") ||
    s.includes("?")
  );
}

function buildTokenRegex(q) {
  const t = normalizeText(q);
  if (!t) return null;
  const tokens = t.split(" ").filter(Boolean).slice(0, 5);
  return tokens.map((tok) => new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

async function findProdutoPorTexto(restauranteId, queryText) {
  const q = extractQueryTerm(queryText);
  if (!q) return null;

  const regs = buildTokenRegex(q);
  if (!regs?.length) return null;

  const andClauses = regs.map((re) => ({
    $or: [{ nome: re }, { descricao: re }],
  }));

  const doc = await Produto.findOne({
    restaurante: restauranteId,
    ativo: true,
    ativoVitrine: { $ne: false },
    disponivel: { $ne: false },
    $and: andClauses,
  }).lean();

  if (doc) return { produto: doc, matched: q, matchType: "produto" };

  const orClauses = regs.flatMap((re) => [{ nome: re }, { descricao: re }]);
  const doc2 = await Produto.findOne({
    restaurante: restauranteId,
    ativo: true,
    ativoVitrine: { $ne: false },
    disponivel: { $ne: false },
    $or: orClauses,
  }).lean();

  if (doc2) return { produto: doc2, matched: q, matchType: "produto" };

  const fuzzy = await listarProdutosPorTermo(restauranteId, queryText, 1);
  if (fuzzy?.[0]) return { produto: fuzzy[0], matched: q, matchType: "produto" };

  return null;
}


async function findCategoriaPorTexto(restauranteId, texto) {
  const q = extractQueryTerm(texto);
  if (!q) return null;

  const regs = buildTokenRegex(q);
  if (!regs?.length) return null;

  const categorias = await CategoriaProduto.find({
    restaurante: restauranteId,
    ativa: { $ne: false },
  }).lean();

  const scored = [];
  for (const cat of categorias || []) {
    const nomeNorm = normalizeText(cat?.nome || '');
    if (!nomeNorm) continue;
    let score = 0;
    for (const re of regs) {
      if (re.test(nomeNorm)) score += 2;
    }
    if (nomeNorm.includes(q)) score += 5;
    // sinônimos comuns de vitrine
    if ((q.includes('hamburg') || q.includes('burguer') || q.includes('burger')) && nomeNorm.includes('hamburg')) score += 6;
    if ((q.includes('bebida') || q.includes('refri') || q.includes('refrigerante') || q.includes('guarana')) && (nomeNorm.includes('bebida') || nomeNorm.includes('refrigerante'))) score += 6;
    if (score > 0) scored.push({ categoria: cat, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

async function listarProdutosDaCategoria(restauranteId, categoriaId, limite = 8) {
  return Produto.find({
    restaurante: restauranteId,
    categoria: categoriaId,
    ativo: true,
    ativoVitrine: { $ne: false },
    disponivel: { $ne: false },
  })
    .sort({ destaque: -1, ordem: 1, nome: 1 })
    .limit(limite)
    .lean();
}

async function listarProdutosPorTermo(restauranteId, texto, limite = 8) {
  const q = extractQueryTerm(texto);
  if (!q) return [];

  const termos = expandirTermosBusca(texto);
  const regs = termos.flatMap((t) => buildTokenRegex(t) || []);
  const orClauses = regs.flatMap((re) => [{ nome: re }, { descricao: re }]);

  let candidatos = [];
  if (orClauses.length) {
    candidatos = await Produto.find({
      restaurante: restauranteId,
      ativo: true,
      ativoVitrine: { $ne: false },
      disponivel: { $ne: false },
      $or: orClauses,
    })
      .sort({ destaque: -1, ordem: 1, nome: 1 })
      .limit(30)
      .lean();
  }

  // Fallback fuzzy: cobre coca-cola/cocacola, parmegiana/permegiana e pequenos erros de digitação.
  if (candidatos.length < 2) {
    const todos = await Produto.find({
      restaurante: restauranteId,
      ativo: true,
      ativoVitrine: { $ne: false },
      disponivel: { $ne: false },
    })
      .sort({ destaque: -1, ordem: 1, nome: 1 })
      .limit(250)
      .lean();
    const ids = new Set(candidatos.map((p) => String(p._id)));
    for (const p of todos) if (!ids.has(String(p._id))) candidatos.push(p);
  }

  return candidatos
    .map((p) => ({ p, score: scoreProdutoBusca(p, texto) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.p.nome || '').localeCompare(String(b.p.nome || '')))
    .slice(0, limite)
    .map((x) => x.p);
}

async function findPorSabor(restauranteId, saborText) {
  const q = extractFlavorCandidate(saborText);
  if (!q) return null;

  const regs = buildTokenRegex(q);
  if (!regs?.length) return null;

  // precisa bater em algum token do sabor
  const orSabores = regs.map((re) => ({ "sabores.nome": re }));

  const p = await Produto.findOne({
    restaurante: restauranteId,
    ativo: true,
    ativoVitrine: { $ne: false },
    disponivel: { $ne: false },
    $or: orSabores,
  }).lean();

  if (!p) return null;

  let saborMatch = "";
  for (const re of regs) {
    const s = (p.sabores || []).find((x) => re.test(String(x?.nome || "")));
    if (s?.nome) {
      saborMatch = s.nome;
      break;
    }
  }

  return { produto: p, matched: saborMatch || q, matchType: "sabor" };
}


/* =========================================================
   REFAZER ÚLTIMO PEDIDO PELO BOT
========================================================= */
function isPerguntaUltimoPedido(t) {
  const s = normalizeText(t);
  return (
    s.includes("ultimo pedido") ||
    s.includes("último pedido") ||
    s.includes("meu pedido anterior") ||
    s.includes("pedido anterior") ||
    s.includes("refazer pedido") ||
    s.includes("repetir pedido") ||
    s.includes("pedir de novo") ||
    s.includes("pedir novamente")
  );
}

function isConfirmacaoSim(t) {
  const s = normalizeText(t);
  return ["sim", "s", "quero", "pode", "refazer", "repetir", "pedir", "pedir de novo", "1"].includes(s) || s.includes("sim pode") || s.includes("quero refazer");
}

function isConfirmacaoNao(t) {
  const s = normalizeText(t);
  return ["nao", "não", "n", "cancelar", "cancela", "2"].includes(s) || s.includes("nao quero") || s.includes("não quero");
}

function getTelefoneFromJid(jid) {
  return String(jid || "").split("@")[0].replace(/\D/g, "");
}

function resumoItensPedido(itens = [], limite = 8) {
  const arr = Array.isArray(itens) ? itens : [];
  const linhas = arr.slice(0, limite).map((it) => {
    const qtd = Number(it?.quantidade ?? it?.quantity ?? 1) || 1;
    const nome = it?.nome || it?.title || it?.produtoNome || "Item";
    return `• ${qtd}x ${nome}`;
  });
  if (arr.length > limite) linhas.push(`• +${arr.length - limite} item(ns)`);
  return linhas.join("\n");
}

async function buscarUltimoPedidoCliente(restauranteId, remoteJid) {
  const tel = getTelefoneFromJid(remoteJid);
  if (!tel) return null;
  const ultimos = await Pedido.find({
    restaurante: restauranteId,
    telefoneCliente: { $regex: `${tel.slice(-8)}$` },
    status: { $nin: ["cancelado", "cancelada"] },
    itens: { $ne: [] },
  })
    .sort({ criadoEm: -1, createdAt: -1, _id: -1 })
    .limit(5)
    .lean();
  return ultimos?.[0] || null;
}

async function enviarPerguntaRefazerPedido(sock, remote, msg, restaurante, pedido) {
  const total = Number(pedido?.valorTotal ?? pedido?.total ?? 0);
  const texto =
    `Encontrei seu último pedido 😍\n\n` +
    `${resumoItensPedido(pedido?.itens)}\n\n` +
    (total ? `💰 Total anterior: *${formatBRL(total)}*\n\n` : "") +
    `Deseja refazer esse pedido agora?`;

  try {
    await sock.sendMessage(remote, {
      text: texto,
      footer: restaurante?.nome || "Movyo Delivery",
      buttons: [
        { buttonId: "REORDER_YES", buttonText: { displayText: "✅ Sim, refazer" }, type: 1 },
        { buttonId: "REORDER_NO", buttonText: { displayText: "❌ Não" }, type: 1 },
      ],
      headerType: 1,
    });
  } catch {
    await sock.sendMessage(remote, { text: `${texto}\n\nResponda *SIM* para refazer ou *NÃO* para cancelar.` });
  }
}

function clonarItensPedido(itens = []) {
  return (Array.isArray(itens) ? itens : []).map((it) => ({ ...it }));
}

async function refazerPedidoComPix({ sock, restauranteId, restaurante, remote, pedidoAnterior }) {
  const total = Number(pedidoAnterior?.valorTotal ?? pedidoAnterior?.total ?? 0);
  const taxaEntrega = Number(pedidoAnterior?.taxaEntrega || 0);
  const itens = clonarItensPedido(pedidoAnterior?.itens);
  if (!itens.length || !Number.isFinite(total) || total <= 0) {
    await sock.sendMessage(remote, { text: "Não consegui refazer esse pedido automaticamente. Abre o cardápio e monta novamente por aqui: " + getCardapioUrl(restaurante) });
    return;
  }

  const mp = safeJson(restaurante?.mercadoPago, restaurante?.mercadoPago || {});
  if (!mp?.conectado || !mp?.accessToken) {
    await sock.sendMessage(remote, { text: "Consigo refazer seu pedido, mas o pagamento online não está disponível agora. Acesse o cardápio: " + getCardapioUrl(restaurante) });
    return;
  }

  const numeroPedido = `BT${Date.now().toString().slice(-6)}`;
  const novo = await Pedido.create({
    numeroPedido,
    restaurante: restauranteId,
    nomeCliente: pedidoAnterior.nomeCliente || "Cliente WhatsApp",
    telefoneCliente: getTelefoneFromJid(remote),
    enderecoCliente: pedidoAnterior.enderecoCliente || "",
    itens,
    total,
    valorTotal: total,
    taxaEntrega,
    formaPagamento: "pix",
    formadePagamento: "pix",
    status: "aguardando_pagamento",
    statusPagamento: "pendente",
    origem: "bot",
    observacao: "Pedido refeito automaticamente pelo bot a partir do último pedido do cliente.",
    criadoEm: new Date(),
    valorPago: 0,
    valorPendente: total,
    pagamentos: [],
  });

  const pix = await criarPagamentoPix({
    accessToken: mp.accessToken,
    pedidoId: novo._id,
    valorTotal: total,
    nomeCliente: novo.nomeCliente,
    telefoneCliente: novo.telefoneCliente,
    restauranteId,
    itens,
    description: `Pedido ${numeroPedido} - ${restaurante?.nome || "Movyo"}`,
  });

  novo.mpPaymentId = pix.paymentId;
  novo.statusPagamento = pix.status || "pending";
  novo.qrCode = pix.qrCode || "";
  novo.qrCodeBase64 = pix.qrCodeBase64 || "";
  novo.pixCopiaECola = pix.qrCode || "";
  await novo.save();

  await sock.sendMessage(remote, {
    text:
      `Perfeito! Recriei seu pedido como *${numeroPedido}* 🧾\n\n` +
      `${resumoItensPedido(itens)}\n\n` +
      `💰 Total: *${formatBRL(total)}*\n\n` +
      `Agora é só pagar o Pix abaixo. Assim que confirmar, o pedido segue para o restaurante. ❤️`,
  });

  await enviarEmPartes({
    restauranteId,
    jid: remote,
    parts: [
      pix.qrCodeBase64 ? { type: "image", base64: pix.qrCodeBase64, caption: "📲 *PIX para pagamento*" } : null,
      pix.qrCode ? { type: "text", text: pix.qrCode } : null,
      { type: "text", text: "⚠️ Após pagar, aguarde a confirmação automática." },
    ].filter(Boolean),
    gapMs: DEFAULT_SEND_GAP_MS,
  });
}

/* =========================================================
   INICIAR BOT
========================================================= */
async function iniciarBot(restauranteId, onQRCode, onConectado, options = {}) {
  const restaurante = await getRestaurante(restauranteId);
  if (!restaurante || !isBotLigado(restaurante)) {
    console.log(`⛔ Bot não iniciado pois está desligado manualmente (${restauranteId})`);
    return;
  }

  if (botsEncerrados[restauranteId]) {
    console.log(`⛔ Bot marcado como encerrado (${restauranteId})`);
    return;
  }

  if (instanciasAtivas[restauranteId] && !options.force) {
    console.log(`⚠️ Bot já está ativo para restaurante ${restauranteId}`);
    return instanciasAtivas[restauranteId];
  }

  if (options.force && instanciasAtivas[restauranteId]) {
    limparInstancia(restauranteId, { fechar: true });
  }

  if (emExecucao[restauranteId]) return instanciasAtivas[restauranteId] || null;
  emExecucao[restauranteId] = true;

  try {
    console.log(`🟡 Iniciando bot para restaurante ${restauranteId}`);

    botConnState[restauranteId] = "connecting";
    lastConnUpdate[restauranteId] = now();

    const pastaSessao = path.resolve(__dirname, "../sessions", `session-${restauranteId}`);
    fs.mkdirSync(pastaSessao, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(pastaSessao);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "warn" }),
      browser: Browsers.macOS("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: BOT_CONNECT_TIMEOUT_SOCKET_MS,
      keepAliveIntervalMs: BOT_KEEP_ALIVE_MS,
      retryRequestDelayMs: 1_000,
      defaultQueryTimeoutMs: Number(process.env.BOT_DEFAULT_QUERY_TIMEOUT_MS || 25_000),
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: (jid) => String(jid || "").endsWith("@broadcast"),
      emitOwnEvents: false,
    });

    sock.restauranteId = restauranteId;
    instanciasAtivas[restauranteId] = sock;
    iniciarWatchdogConexao(restauranteId, { onQRCode, onConectado });

    tratarMensagemSaudacao(sock);
    tratarPerguntasInteligentes(sock);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (connection) {
        botConnState[restauranteId] = connection;
        lastConnUpdate[restauranteId] = now();
      }

      if (qr) {
        qrs[restauranteId] = qr;
        onQRCode?.(qr);

        await atualizarStatusBot(restauranteId, {
          "statusBot.ultimoQr": qr,
          "statusBot.qrGeradoEm": new Date(),
          "statusBot.conectado": false,
          "statusBot.erroConexao": null,
        });
      }

      if (connection === "open") {
        limparWatchdog(restauranteId);
        reconnectAttempts[restauranteId] = 0;
        delete qrs[restauranteId];

        try {
          await saveCreds();
        } catch {}

        onConectado?.();

        await atualizarStatusBot(restauranteId, {
          "statusBot.conectado": true,
          "statusBot.ultimoQr": null,
          "statusBot.erroConexao": null,
        });

        const nome = (await getRestaurante(restauranteId))?.nome || restauranteId;
        console.log(`✅ Bot conectado para restaurante ${nome}`);
      }

      if (connection === "close") {
        limparInstancia(restauranteId, { fechar: false });

        const code = getDisconnectCode(lastDisconnect);
        const message = getDisconnectMessage(lastDisconnect);
        limparCacheRestaurante(restauranteId);
        const rest = await getRestaurante(restauranteId, { force: true });
        const nome = rest?.nome || restauranteId;

        console.warn(`🔌 Bot fechado (${nome}) code=${code || "-"} motivo=${message}`);

        if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
          const pasta = path.resolve(__dirname, "../sessions", `session-${restauranteId}`);
          if (fs.existsSync(pasta)) fs.rmSync(pasta, { recursive: true, force: true });

          await atualizarStatusBot(restauranteId, {
            "statusBot.ligado": false,
            "statusBot.conectado": false,
            "statusBot.ultimoQr": null,
            "statusBot.erroConexao": `Sessão inválida/deslogada (${code})`,
          });

          console.log(`📴 Bot foi deslogado ou sessão ficou inválida – sessão resetada (${nome})`);
          return;
        }

        const deveReconectar = !botsEncerrados[restauranteId] && isBotLigado(rest);
        if (deveReconectar) {
          reconnectAttempts[restauranteId] = (reconnectAttempts[restauranteId] || 0) + 1;

          // 515/408 são comuns durante handshake/init queries do Baileys.
          // Não apaga sessão: recria o socket e tenta continuar.
          const restartRapido = isRestartableDisconnect(code, message);
          const delay = getRestartDelayMs(restauranteId, restartRapido);

          await atualizarStatusBot(restauranteId, {
            "statusBot.conectado": false,
            "statusBot.erroConexao": restartRapido
              ? `WhatsApp/Baileys pediu restart do socket (${code || "sem código"}). Reconectando...`
              : `Conexão fechada (${code || "sem código"}): ${message}`,
          });

          agendarReconexao(
            restauranteId,
            { onQRCode, onConectado },
            delay,
            restartRapido ? `restart_socket_${code || "unknown"}` : `close_${code || "unknown"}`
          );
        } else {
          await atualizarStatusBot(restauranteId, {
            "statusBot.conectado": false,
            "statusBot.erroConexao": message,
          });

          console.log(`🔌 Bot desconectado (${nome})`);
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);
    return sock;
  } catch (error) {
    console.error("❌ Erro ao iniciar bot:", error?.message || error);
    await atualizarStatusBot(restauranteId, {
      "statusBot.conectado": false,
      "statusBot.erroConexao": error?.message || String(error),
    });
  } finally {
    delete emExecucao[restauranteId];
  }
}

/* =========================================================
   GETTERS
========================================================= */
function getQr(id) {
  return qrs[id] || null;
}
function getInstancia(id) {
  return instanciasAtivas[id];
}
function estaConectado(id) {
  const sock = instanciasAtivas[id];
  return !!sock && botConnState[id] === "open" && !!sock.user;
}
function getEstadoBot(id) {
  return {
    estado: botConnState[id] || "close",
    conectado: estaConectado(id),
    temInstancia: !!instanciasAtivas[id],
    temQr: !!qrs[id],
    tentativas: reconnectAttempts[id] || 0,
    atualizadoEm: lastConnUpdate[id] || null,
  };
}
function liberarBot(id) {
  delete botsEncerrados[id];
}
async function pararBot(id) {
  if (reconnectTimers[id]) { clearTimeout(reconnectTimers[id]); delete reconnectTimers[id]; }
  const sock = instanciasAtivas[id];
  if (sock) {
    try {
      sock.end?.();
    } catch {}
  }
  limparInstancia(id, { fechar: false });
  botsEncerrados[id] = true;

  botConnState[id] = "close";

  await atualizarStatusBot(id, {
    "statusBot.ligado": false,
    "statusBot.conectado": false,
    "statusBot.erroConexao": null,
  });
}

/* =========================================================
   ENVIOS PÚBLICOS
========================================================= */
async function enviarMensagem(restauranteId, numero, texto) {
  return enqueueSend(restauranteId, async () => {
    const sock = assertBotOnline(restauranteId);
    const jid = await getJidFromNumero(sock, numero);

    console.log("✅ Enviando mensagem para:", jid);
    await sock.sendMessage(jid, { text: String(texto || "") });
    console.log("✅ Mensagem enviada com sucesso");
    return { ok: true };
  });
}

async function enviarMensagemMidia(restauranteId, numero, base64Image, caption = "") {
  return enqueueSend(restauranteId, async () => {
    const sock = assertBotOnline(restauranteId);
    const jid = await getJidFromNumero(sock, numero);

    const b64 = cleanBase64(base64Image);
    if (!b64) throw new Error("Base64 inválido");

    const buffer = Buffer.from(b64, "base64");

    console.log("✅ Enviando mídia para:", jid);
    await sock.sendMessage(jid, { image: buffer, caption: String(caption || "").slice(0, 900) });
    console.log("✅ Mídia enviada com sucesso");
    return { ok: true };
  });
}

async function enviarPixWhatsapp(restauranteId, numero, payload) {
  return enqueueSend(restauranteId, async () => {
    const sock = assertBotOnline(restauranteId);

    const e164 = normalizarNumeroE164BR(numero);
    const paymentId = String(payload?.paymentId || payload?.mpPaymentId || payload?.id || "").trim();
    const dedupKey = `${restauranteId}:${e164}:${paymentId || "noPid"}`;
    if (!canSendPixOnce(dedupKey)) {
      console.log("⚠️ Dedup PIX: envio ignorado", dedupKey);
      return { ok: true, dedup: true };
    }

    const jid = await getJidFromNumero(sock, numero);

    const { mesaNumero, nomeCliente, valorPix, total, pago, pendente, qrCodeBase64, copiaCola } =
      payload || {};

    const parte1 = [
      "📲 *PAGAMENTO VIA PIX*",
      `🍽️ *Mesa:* ${mesaNumero || "-"}`,
      nomeCliente ? `👤 *Cliente:* ${nomeCliente}` : null,
      "",
      `💰 *Valor do PIX:* ${formatBRL(valorPix)}`,
      `🧾 *Total:* ${formatBRL(total)}`,
      `✅ *Pago:* ${formatBRL(pago)}`,
      `⏳ *Pendente:* ${formatBRL(pendente)}`,
      "",
      "📋 *PIX Copia e Cola:*",
    ]
      .filter(Boolean)
      .join("\n");

    const codigo = String(copiaCola || "").trim();
    const parte3 = "⚠️ *Após pagar, aguarde a confirmação.*";

    const parts = [];
    if (qrCodeBase64) parts.push({ type: "image", base64: qrCodeBase64, caption: parte1 });
    else parts.push({ type: "text", text: parte1 });

    if (codigo) parts.push({ type: "text", text: codigo });
    parts.push({ type: "text", text: parte3 });

    await enviarEmPartes({ restauranteId, jid, parts, gapMs: DEFAULT_SEND_GAP_MS });

    return { ok: true, dedup: false };
  });
}

/* =========================================================
   SAUDAÇÃO (reage + digitando 6s + envia msg com link)
========================================================= */
function tratarMensagemSaudacao(sock) {
  const saudacoes = ["oi", "olá", "ola", "eai", "e aí", "fala", "bom dia", "boa tarde", "boa noite"];

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      trimHandled();
      if (!messages?.length) return;

      const msg = messages[0];
      if (!msg?.message) return;
      if (msg.key?.fromMe) return;

      const remote = msg.key?.remoteJid || "";
      if (deveIgnorarMensagem(remote)) return;

      const restauranteId = sock.restauranteId;
      const restaurante = await getRestaurante(restauranteId);
      if (!restaurante) return;

      // ✅ NOVO: atendimento por horariosFuncionamento (e fallback legado)
      const stAt = getAtendimentoStatus(restaurante);
      if (!stAt.aberto) {
        // Se é pergunta tipo "tem pizza..." deixa o Q&A cuidar (evita conflito)
        const textoFechado = extrairTexto(msg) || "";
        if (parecePerguntaDeDisponibilidade(textoFechado)) return;

        if (podeAvisarFechado(restauranteId, remote)) {
          const url = getCardapioUrl(restaurante);
          await sock.sendMessage(remote, {
            text: `${stAt.texto}${url ? `\n\n🌐 Cardápio: ${url}` : ""}`,
          });
        }
        return;
      }

      const texto = extrairTexto(msg);
      if (!texto) return;

      // Se é pergunta tipo "tem pizza..." deixa o Q&A cuidar (evita conflito)
      if (parecePerguntaDeDisponibilidade(texto)) return;

      const textoLower = normalizeText(texto);
      if (!saudacoes.some((s) => textoLower.includes(normalizeText(s)))) return;

      const msgId = msg.key?.id;
      if (msgId) {
        const seen = handledMsgIds.get(msgId);
        if (seen) return;
        handledMsgIds.set(msgId, now());
      }

      const cooldownMs =
        ((restaurante?.config?.greetingCooldownMinutos ?? 120) * 60 * 1000) ||
        GREETING_COOLDOWN_MS_FALLBACK;

      const key = `${restauranteId}:${remote}`;
      const lastGreeting = ultimoCumprimento.get(key) || 0;
      if (now() - lastGreeting < cooldownMs) return;

      const nomeRest = restaurante.nome || "nosso restaurante";
      const nomeCliente = extrairNomeCliente(sock, remote, msg);
      const url = getCardapioUrl(restaurante);

      try {
        await sock.sendMessage(remote, { react: { text: "❤️", key: msg.key } });
      } catch {}

      await typingDelay(sock, remote, 6000);

      const bodyText =
        `Olá${nomeCliente ? `, ${nomeCliente}` : ""}! 😄👋\n` +
        `Somos o restaurante *${nomeRest}*.\n\n` +
        (url ? `🌐 Cardápio: ${url}` : "Me diga o que você deseja que eu te ajudo por aqui 🙂");

      await sock.sendMessage(remote, { text: bodyText });

      ultimoCumprimento.set(key, now());
      trimCache(ultimoCumprimento);
    } catch (err) {
      console.error("❌ Erro em tratarMensagemSaudacao:", err?.message || err);
    }
  });
}

/* =========================================================
   PERGUNTAS INTELIGENTES (sabor/produto/destaque/promo)
========================================================= */
function tratarPerguntasInteligentes(sock) {
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      trimHandled();
      if (!messages?.length) return;

      const msg = messages[0];
      if (!msg?.message) return;
      if (msg.key?.fromMe) return;

      const remote = msg.key?.remoteJid || "";
      if (deveIgnorarMensagem(remote)) return;

      const restauranteId = sock.restauranteId;
      const restaurante = await getRestaurante(restauranteId);
      if (!restaurante) return;

      const texto = extrairTexto(msg);
      if (!texto) return;

      const msgId = msg.key?.id;
      if (msgId) {
        const seen = handledMsgIds.get(msgId);
        if (seen) return;
        handledMsgIds.set(msgId, now());
      }

      const url = getCardapioUrl(restaurante);

      // ✅ Botões/respostas para refazer último pedido
      const reorderKey = `${restauranteId}:${remote}`;
      const btnId = msg?.message?.buttonsResponseMessage?.selectedButtonId || msg?.message?.templateButtonReplyMessage?.selectedId || "";
      const intent = reorderIntent.get(reorderKey);
      if (intent && now() - intent.ts > REORDER_INTENT_TTL_MS) reorderIntent.delete(reorderKey);
      const activeIntent = reorderIntent.get(reorderKey);

      if (activeIntent && (btnId === "REORDER_NO" || isConfirmacaoNao(texto))) {
        reorderIntent.delete(reorderKey);
        await reagirAntesDeResponder(sock, msg, texto || "não");
        await sock.sendMessage(remote, { text: `Tudo bem 😊
Quando quiser, é só acessar o cardápio: ${url}` });
        ultimoQna.set(reorderKey, now());
        trimCache(ultimoQna);
        return;
      }

      if (activeIntent && (btnId === "REORDER_YES" || isConfirmacaoSim(texto))) {
        reorderIntent.delete(reorderKey);
        await reagirAntesDeResponder(sock, msg, texto || "sim");
        await typingDelay(sock, remote, 1200);
        const pedidoAnterior = await Pedido.findById(activeIntent.pedidoId).lean();
        if (!pedidoAnterior) {
          await sock.sendMessage(remote, { text: `Não encontrei mais esse pedido anterior. 😕
Mas você pode fazer um novo por aqui: ${url}` });
          return;
        }
        await refazerPedidoComPix({ sock, restauranteId, restaurante, remote, pedidoAnterior });
        ultimoQna.set(reorderKey, now());
        trimCache(ultimoQna);
        return;
      }

      if (isPerguntaUltimoPedido(texto)) {
        await reagirAntesDeResponder(sock, msg, texto);
        await typingDelay(sock, remote, 1200);
        const pedidoAnterior = await buscarUltimoPedidoCliente(restauranteId, remote);
        if (!pedidoAnterior) {
          await sock.sendMessage(remote, { text: `Ainda não encontrei pedido anterior seu por aqui 😄
Mas você pode fazer o primeiro agora pelo cardápio: ${url}` });
          ultimoQna.set(reorderKey, now());
          trimCache(ultimoQna);
          return;
        }
        reorderIntent.set(reorderKey, { pedidoId: String(pedidoAnterior._id), ts: now() });
        trimCache(reorderIntent);
        await enviarPerguntaRefazerPedido(sock, remote, msg, restaurante, pedidoAnterior);
        ultimoQna.set(reorderKey, now());
        trimCache(ultimoQna);
        return;
      }

      // ✅ NOVO: se estiver fechado, responde status (com cooldown) e encerra aqui
      const stAt = getAtendimentoStatus(restaurante);
      if (!stAt.aberto) {
        if (podeAvisarFechado(restauranteId, remote)) {
          await reagirAntesDeResponder(sock, msg, texto);
          await sock.sendMessage(remote, {
            text: `${stAt.texto}${url ? `\n\n🌐 Cardápio: ${url}` : ""}`,
          });
        }
        return;
      }

      // spam curto por contato (permite sequência)
      const key = `${restauranteId}:${remote}`;
      const last = ultimoQna.get(key) || 0;
      if (now() - last < QNA_SPAM_MS) return;

      // ✅ Pedido direto de cardápio/link
      if (isPedidoCardapio(texto)) {
        await reagirAntesDeResponder(sock, msg, texto);
        await typingDelay(sock, remote, 900);
        await sock.sendMessage(remote, {
          text: `🌐 Aqui está o cardápio para fazer seu pedido:
${url}`,
        });
        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      // ✅ Pergunta sobre horário/funcionamento
      if (isPerguntaHorario(texto)) {
        await reagirAntesDeResponder(sock, msg, texto);
        await typingDelay(sock, remote, 900);
        await sock.sendMessage(remote, {
          text: `${stAt.texto}

🌐 Cardápio: ${url}`,
        });
        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      // ✅ Destaques
      if (isPerguntaDestaques(texto)) {
        await reagirAntesDeResponder(sock, msg, texto);
        await typingDelay(sock, remote, 1200);

        const itens = await Produto.find({
          restaurante: restauranteId,
          ativo: true,
          destaque: true,
        })
          .sort({ updatedAt: -1 })
          .limit(8)
          .lean();

        if (!itens.length) {
          await sock.sendMessage(remote, {
            text:
              `No momento não vi itens marcados como *destaque* por aqui. 🙂\n` +
              (url ? `🌐 Dá uma olhada no cardápio: ${url}` : ""),
          });
        } else {
          const linhas = itens.map(
            (p) => `• ${p.nome}${getProdutoPreco(p) ? ` — ${formatBRL(getProdutoPreco(p))}` : ""}`
          );
          await sock.sendMessage(remote, {
            text: `⭐ *Destaques de hoje:*\n${linhas.join("\n")}\n\n${url ? `🌐 Cardápio: ${url}` : ""}`,
          });
        }

        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      // ✅ Promoções
      if (isPerguntaPromos(texto)) {
        await reagirAntesDeResponder(sock, msg, texto);
        await typingDelay(sock, remote, 1200);

        const promoRegex = /promo|oferta|combo|desconto|especial/i;
        const itens = await Produto.find({
          restaurante: restauranteId,
          ativo: true,
          $or: [{ nome: promoRegex }, { descricao: promoRegex }],
        })
          .sort({ updatedAt: -1 })
          .limit(10)
          .lean();

        if (!itens.length) {
          await sock.sendMessage(remote, {
            text:
              `🎁 Agora eu não encontrei itens marcados como promoção/oferta no cadastro.\n` +
              (url ? `Mas confere o cardápio: ${url}` : ""),
          });
        } else {
          const linhas = itens.map(
            (p) => `• ${p.nome}${getProdutoPreco(p) ? ` — ${formatBRL(getProdutoPreco(p))}` : ""}`
          );
          await sock.sendMessage(remote, {
            text: `🎁 *Promoções/Ofertas que encontrei:*\n${linhas.join("\n")}\n\n${url ? `🌐 Cardápio: ${url}` : ""}`,
          });
        }

        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      // ✅ Disponibilidade (tem X?)
      if (!parecePerguntaDeDisponibilidade(texto)) return;

      await reagirAntesDeResponder(sock, msg, texto);

      const modoPizza = isPerguntaPizzaOuSabor(texto);

      await typingDelay(sock, remote, 1200);

      // 0) Se o cliente perguntou por uma categoria, lista os principais itens dela.
      const categoriaMatch = await findCategoriaPorTexto(restauranteId, texto);
      if (categoriaMatch?.categoria?._id) {
        const itensCat = await listarProdutosDaCategoria(restauranteId, categoriaMatch.categoria._id, 10);
        if (itensCat.length) {
          await sock.sendMessage(remote, {
            text:
              `Sim! Temos opções em *${categoriaMatch.categoria.nome}* 😍\n\n` +
              `${itensCat.map(buildProdutoLinha).join("\n")}\n\n` +
              (url ? `🌐 Cardápio: ${url}` : ""),
          });
          ultimoQna.set(key, now());
          trimCache(ultimoQna);
          return;
        }
      }

      // 0.5) Se perguntou por tipo/termo como guaraná, coca, suco etc, lista até 8 produtos encontrados.
      const itensPorTermo = await listarProdutosPorTermo(restauranteId, texto, 8);
      if (itensPorTermo.length > 1) {
        const termo = extractQueryTerm(texto) || 'esse item';
        await sock.sendMessage(remote, {
          text:
            `Encontrei essas opções relacionadas a *${termo}* 😍\n\n` +
            `${itensPorTermo.map(buildProdutoLinha).join("\n")}\n\n` +
            (url ? `🌐 Cardápio: ${url}` : ""),
        });
        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      // 1) Se for pizza/sabor OU se for "E de X?" => tenta sabor primeiro
      let found = null;
      if (modoPizza) {
        found = await findPorSabor(restauranteId, texto);
        if (!found) found = await findProdutoPorTexto(restauranteId, texto);
      } else {
        // 2) se não for pizza, tenta produto primeiro
        found = await findProdutoPorTexto(restauranteId, texto);
        // 3) fallback: às vezes "calabresa" é sabor e não produto
        if (!found) found = await findPorSabor(restauranteId, texto);
      }

      if (!found?.produto) {
        const termo = extractFlavorCandidate(texto) || extractQueryTerm(texto) || "esse item";
        await sock.sendMessage(remote, {
          text:
            `Ainda não achei uma opção chamada *${termo}* no cardápio 😕\n\n` +
            `Pode ser que esteja cadastrado com outro nome. Me manda uma palavra parecida, tipo *coca*, *guaraná*, *hambúrguer* ou *parmegiana*, que eu procuro melhor pra você.\n\n` +
            (url ? `🌐 Cardápio completo: ${url}` : ""),
        });
        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      const produto = found.produto;
      const disponivel = await produtoDisponivelPorEstoque(restauranteId, produto);

      if (!disponivel) {
        const nome = found.matchType === "sabor" ? `pizza de ${found.matched}` : produto.nome;
        await sock.sendMessage(remote, {
          text:
            `😥 Poxa, no momento estamos *sem disponibilidade* de *${nome}*.\n` +
            (url ? `🌐 Mas confere o cardápio pra ver outras opções: ${url}` : ""),
        });
        ultimoQna.set(key, now());
        trimCache(ultimoQna);
        return;
      }

      const precoTxt = getProdutoPreco(produto) ? `💰 *A partir de* ${formatBRL(getProdutoPreco(produto))}` : "";
      const produtoTxt =
        found.matchType === "sabor"
          ? `📌 *Produto:* ${produto.nome}\n🍕 *Sabor:* ${found.matched}`
          : `📌 *Produto:* ${produto.nome}`;

      const headline =
        found.matchType === "sabor"
          ? `✅ Sim! Temos pizza de *${found.matched}* 😊`
          : `✅ Sim! Temos *${produto.nome}* 😊`;

      await sock.sendMessage(remote, {
        text:
          `${headline}\n` +
          (precoTxt ? `${precoTxt}\n` : "") +
          `${produtoTxt}\n\n` +
          (url ? `🌐 Cardápio: ${url}` : ""),
      });

      ultimoQna.set(key, now());
      trimCache(ultimoQna);
    } catch (err) {
      console.error("❌ Erro em tratarPerguntasInteligentes:", err?.message || err);
    }
  });
}

/* =========================================================
   EXPORTS
========================================================= */
module.exports = {
  iniciarBot,
  getQr,
  getInstancia,
  estaConectado,
  getEstadoBot,
  pararBot,
  enviarMensagem,
  enviarMensagemMidia,
  enviarPixWhatsapp,
  liberarBot,
  normalizarJid,
  normalizarNumeroE164BR,
};
