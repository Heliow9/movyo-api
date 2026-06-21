// server.js (ou index.js)
// ✅ Ajustado pra: não crashar com ECONNRESET / Mongo instável
// ✅ Mantém 100% suas rotas e io
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const path = require("path");

const { iniciarBot } = require("./utils/bot");
// const { startIfoodPolling } = require("./services/ifoodEventsService");

const Restaurante = require("./models/Restaurante");
const { testConnection } = require("./db/mysql");
const { syncAllModels } = require("./lib/mysqlModelFactory");
const apiMonitor = require("./utils/apiMonitor");
const { cancelarPedidosVitrineExpirados } = require("./services/pedidoCancelamentoService");

const mercadoPagoPublicoRoutes = require("./routes/mercadoPagoPublicoRoutes");
const garcomRoutes = require("./routes/garcomRoutes");
const rateLimitPublico = require("./middlewares/rateLimitPublico");

// Middlewares de segurança HTTP sem novas dependências.
// Mantém compatibilidade com app/mobile e restringe navegador por CORS quando configurado.
const allowedOrigins = String(process.env.CORS_ORIGINS || "https://app.movyo.delivery,https://movyo.delivery,http://localhost:5173,http://localhost:3000,https://hub.movyo.delivery ")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);

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
  ],

  exposedHeaders: [
    "Content-Disposition",
    "Content-Length",
  ],

  credentials: false,

  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
app.use("/api/endereco", require("./routes/enderecoRoutes"));
app.use("/api/enderecos", require("./routes/enderecoRoutes"));
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
app.use("/api/push", require("./routes/pushRoutes"));

const imagensRoutes = require("./routes/imagens.routes");
app.use("/api/imagens", imagensRoutes);

// Teste / Health
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});



if (String(process.env.DISABLE_AUTO_CANCEL_VITRINE || "").toLowerCase() !== "true") {
  const autoCancelMs = Math.max(15000, Number(process.env.AUTO_CANCEL_VITRINE_INTERVAL_MS || 30000));
  setInterval(() => {
    cancelarPedidosVitrineExpirados({ io })
      .then((r) => {
        if (r?.cancelados) console.log(`Auto-cancelamento vitrine: ${r.cancelados} pedido(s) cancelado(s).`);
      })
      .catch((err) => console.error("Auto-cancelamento vitrine falhou:", err?.message || err));
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
    await syncAllModels();
    await restaurarBotsLigados();
  } catch (err) {
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
function shutdown(signal) {
  console.log(`\n🧯 Recebido ${signal}. Encerrando com segurança...`);
  server.close(() => {
    console.log("✅ Servidor encerrado.");
    process.exit(0);
  });

  // se travar, força saída
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
