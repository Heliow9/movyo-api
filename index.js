// server.js (ou index.js)
// ✅ Ajustado pra: não crashar com ECONNRESET / Mongo instável
// ✅ Mantém 100% suas rotas e io
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const compression = require("compression");
const socketIo = require("socket.io");
const path = require("path");

const { iniciarBot } = require("./utils/bot");
// const { startIfoodPolling } = require("./services/ifoodEventsService");

const Restaurante = require("./models/Restaurante");
const { pool, testConnection } = require("./db/mysql");
const { syncAllModels } = require("./lib/mysqlModelFactory");
const apiMonitor = require("./utils/apiMonitor");
const { cancelarPedidosVitrineExpirados } = require("./services/pedidoCancelamentoService");
const { recuperarOfertasPendentes } = require("./services/deliveryOfferService");
const { recuperarEventosIfoodPendentes, startIfoodPolling } = require("./controllers/ifoodController");

const mercadoPagoPublicoRoutes = require("./routes/mercadoPagoPublicoRoutes");
const garcomRoutes = require("./routes/garcomRoutes");
const rateLimitPublico = require("./middlewares/rateLimitPublico");

// Middlewares de segurança HTTP sem novas dependências.
// Mantém compatibilidade com app/mobile e restringe navegador por CORS quando configurado.
const allowedOrigins = String(process.env.CORS_ORIGINS || "https://app.movyo.delivery,https://movyo.delivery,http://localhost:5173,http://localhost:3000,https://hub.movyo.delivery,https://movyo-saas-dashboard.onrender.com ")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
let databaseReady = false;
let databaseLastError = null;

app.set(
  "trust proxy",
  process.env.TRUST_PROXY_HOPS !== undefined
    ? Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || 0)
    : process.env.NODE_ENV === "production" ? 1 : false
);

server.keepAliveTimeout = Math.max(5000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 65000));
server.headersTimeout = Math.max(server.keepAliveTimeout + 1000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 66000));
server.requestTimeout = Math.max(10000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000));

const io = socketIo(server, {
  cors: {
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

/**
 * ✅ Socket handlers
 */
const setupSockets = require("./sockets/socketHandler");
setupSockets(io);

// Middleware global para injetar io em qualquer requisição
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

app.use(cors({
  origin(origin, cb) {
    // Permite Electron, aplicativos, chamadas internas e origens autorizadas.
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    console.warn(`🚫 CORS bloqueado para origem: ${origin}`);
    return cb(new Error("Origem não permitida pelo CORS."));
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
    "x-movyo-client",
    "X-Movyo-Version",
    "x-restaurante-id",
    "X-IFood-Signature",
  ],

  exposedHeaders: [
    "Content-Disposition",
    "Content-Length",
  ],

  credentials: false,

  optionsSuccessStatus: 204,
}));

app.use(compression({
  threshold: Number(process.env.COMPRESSION_THRESHOLD_BYTES || 1024),
}));

app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb",
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || req.url || "").startsWith("/api/ifood/webhook")) {
      req.rawBody = Buffer.from(buf);
    }
  },
}));

// ✅ DEV/PERF: mostra no terminal qualquer rota que demorar mais de 1s.
// Ajuda a detectar gargalos sem poluir requests rápidas.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    apiMonitor.captureRequest(req, res, ms);
    if (ms > 1000) {
      console.warn(`🐢 Rota lenta: ${req.method} ${req.originalUrl} -> ${res.statusCode} em ${ms}ms`);
    }
  });
  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === "production"
    ? process.env.UPLOADS_CACHE_MAX_AGE || "1d"
    : 0,
}));

// ✅ Compat: troca de senha fora do router /api/restaurantes, para evitar 404 em builds antigos/proxy
try {
  const authRestauranteCompat = require("./middlewares/authRestaurante");
  const restauranteControllerCompat = require("./controllers/restauranteController");
  app.patch("/api/restaurante/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
  app.put("/api/restaurante/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
  app.post("/api/restaurante/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
  app.patch("/api/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
  app.put("/api/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
  app.post("/api/configuracoes/senha", authRestauranteCompat, restauranteControllerCompat.trocarSenhaConfiguracoes);
} catch (e) {
  console.warn("Rotas compat de senha não carregadas:", e?.message || e);
}

// -------------------------------
// ROTAS PADRONIZADAS
// -------------------------------
app.use("/api/internal/ponto-certo", require("./routes/pontoCertoInternalRoutes"));
app.use("/api/restaurantes", require("./routes/restauranteRoutes"));
app.use("/api/saas", require("./routes/saasRoutes"));
app.use("/api/auditoria", require("./routes/auditoriaRoutes"));
app.use("/api/categorias", require("./routes/categoriaProdutoRoutes"));
app.use("/api/produtos", require("./routes/ProdutosRoutes"));
app.use("/api/bot", require("./routes/botRoutes"));
app.use("/api/produto-extras", require("./routes/produtoExtrasRoutes"));
app.use("/api/frete", require("./routes/freteRoutes"));
app.use("/api/mesas", require("./routes/mesaRoutes"));
app.use("/api/clientes", require("./routes/clienteRoutes"));
app.use("/publico", rateLimitPublico({ prefix: "publico" }), require("./routes/pedidoPublicoRoutes"));
app.use("/api/pagarme", require("./routes/pagarmeRoutes"));
app.use("/api/entregadores-online", require("./routes/entregadorOnlineRoutes"));
app.use("/api/mercadopago", require("./routes/mercadoPagoRoutes"));
app.use("/api", require("./routes/mercadoPagoWebhookRoutes"));

// Rotas que precisam receber io()
app.use("/api/pedidos", require("./routes/pedidosRoutes")(io));
app.use("/api/entregadores", require("./routes/entregadorRoutes")(io));

app.use("/api/publico", rateLimitPublico({ prefix: "api-publico" }), require("./routes/publicoRoutes"));
app.use("/api/publico/mercadopago", rateLimitPublico({ prefix: "mp-publico", max: 60 }), mercadoPagoPublicoRoutes);
app.use("/api/garcons", garcomRoutes);
app.use("/api/estoque", require("./routes/estoqueRoutes"));
app.use("/api/balcao", require("./routes/balcaoRoutes"));
app.use("/api/caixa", require("./routes/caixaRoutes"));
app.use("/api/financeiro", require("./routes/financeiroRoutes"));
app.use("/api/resumo", require("./routes/resumoRoutes"));
app.use("/api/push", require("./routes/pushRoutes"));
app.use("/api/ifood", require("./routes/ifoodRoutes")());

const imagensRoutes = require("./routes/imagens.routes");
app.use("/api/imagens", imagensRoutes);
app.use("/api/ia", require("./routes/iaRoutes"));

// Teste / Health
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});

app.get(["/ready", "/api/ready"], (req, res) => {
  const status = databaseReady ? 200 : 503;
  return res.status(status).json({
    ok: databaseReady,
    service: "movyo-api",
    database: databaseReady ? "ready" : "unavailable",
    error: databaseReady || process.env.NODE_ENV === "production" ? undefined : databaseLastError,
    ts: new Date().toISOString(),
  });
});



if (String(process.env.DISABLE_AUTO_CANCEL_VITRINE || "").toLowerCase() !== "true") {
  const autoCancelMs = Math.max(15000, Number(process.env.AUTO_CANCEL_VITRINE_INTERVAL_MS || 30000));
  let autoCancelRunning = false;
  setInterval(() => {
    if (autoCancelRunning || !databaseReady) return;
    autoCancelRunning = true;
    cancelarPedidosVitrineExpirados({ io })
      .then((r) => {
        if (r?.cancelados) console.log(`Auto-cancelamento vitrine: ${r.cancelados} pedido(s) cancelado(s).`);
      })
      .catch((err) => console.error("Auto-cancelamento vitrine falhou:", err?.message || err))
      .finally(() => { autoCancelRunning = false; });
  }, autoCancelMs);
}

/* =========================================================
   ✅ ANTI-CRASH: HANDLERS GLOBAIS
   - evita o processo cair por promise rejeitada/erro não tratado
   ========================================================= */
process.on("unhandledRejection", (reason) => {
  console.error("🛑 unhandledRejection:", reason);
  apiMonitor.captureError(reason instanceof Error ? reason : new Error(String(reason)));
  // não derruba o servidor
});

process.on("uncaughtException", (err) => {
  console.error("🛑 uncaughtException:", err);
  apiMonitor.captureError(err);
  // não derruba o servidor (recomendado em produção usar PM2/Docker pra restart)
});


let botsRestaurados = false;
async function restaurarBotsLigados() {
  if (botsRestaurados) return;
  botsRestaurados = true;
  try {
    const safeJsonLocal = (value, fallback = {}) => {
      if (value === null || value === undefined || value === '') return fallback;
      if (typeof value === 'object') return value;
      try { return JSON.parse(String(value)); } catch { return fallback; }
    };
    const normalizeBoolLocal = (value, defaultValue = false) => {
      if (value === undefined || value === null || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const s = String(value).trim().toLowerCase();
      if (['false', '0', 'nao', 'não', 'no', 'off', 'desligado'].includes(s)) return false;
      if (['true', '1', 'sim', 'yes', 'on', 'ligado'].includes(s)) return true;
      return defaultValue;
    };

    // MySQL salva statusBot como JSON em LONGTEXT; consulta por "statusBot.ligado" pode não funcionar.
    // Busca os restaurantes e filtra em JS para restaurar somente os bots marcados como ligados.
    const restaurantes = await Restaurante.find({}).lean();
    const botsLigados = (restaurantes || []).filter((r) => {
      const st = safeJsonLocal(r?.statusBot, {});
      return normalizeBoolLocal(st?.ligado, false);
    });
    botsLigados.forEach((r) => iniciarBot(String(r._id)));
    console.log(`🤖 Bots restaurados: ${botsLigados.length}`);
  } catch (e) {
    console.error("❌ Falha ao restaurar bots:", e?.message || e);
    botsRestaurados = false;
  }
}

/* =========================================================
   ✅ MYSQL: CONEXÃO + SYNC DE TABELAS
   - tabelas modeladas coluna por coluna
   - mantém rotas e Socket.IO
   ========================================================= */

async function iniciarBanco() {
  try {
    await testConnection();
    if (String(process.env.SYNC_SCHEMA_ON_STARTUP || "true").toLowerCase() !== "false") {
      await syncAllModels();
    }
    await recuperarOfertasPendentes(io);
    await recuperarEventosIfoodPendentes(io);
    startIfoodPolling(io);
    await restaurarBotsLigados();
    databaseReady = true;
    databaseLastError = null;
  } catch (err) {
    databaseReady = false;
    databaseLastError = err?.message || String(err);
    console.error("🔴 Falha ao iniciar MySQL:", err?.message || err);
    setTimeout(iniciarBanco, 3000);
  }
}

iniciarBanco();

/* =========================================================
   ✅ START SERVER
   ========================================================= */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));

/* =========================================================
   ✅ SHUTDOWN GRACEFUL (não crasha ao encerrar)
   ========================================================= */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  databaseReady = false;
  console.log(`\n🧯 Recebido ${signal}. Encerrando com segurança...`);
  io.disconnectSockets(true);
  server.close(async () => {
    try { await pool.end(); } catch (_) {}
    console.log("✅ Servidor encerrado.");
    process.exit(0);
  });

  // se travar, força saída
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
