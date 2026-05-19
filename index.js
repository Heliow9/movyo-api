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

const mercadoPagoPublicoRoutes = require("./routes/mercadoPagoPublicoRoutes");
const garcomRoutes = require("./routes/garcomRoutes");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
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

// Middlewares
app.use(cors());
app.use(express.json());

// ✅ DEV/PERF: mostra no terminal qualquer rota que demorar mais de 1s.
// Ajuda a detectar gargalos sem poluir requests rápidas.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
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
app.use("/api/restaurantes", require("./routes/restauranteRoutes"));
app.use("/api/categorias", require("./routes/categoriaProdutoRoutes"));
app.use("/api/produtos", require("./routes/ProdutosRoutes"));
app.use("/api/bot", require("./routes/botRoutes"));
app.use("/api/produto-extras", require("./routes/produtoExtrasRoutes"));
app.use("/api/frete", require("./routes/freteRoutes"));
app.use("/api/mesas", require("./routes/mesaRoutes"));
app.use("/api/clientes", require("./routes/clienteRoutes"));
app.use("/publico", require("./routes/pedidoPublicoRoutes"));
app.use("/api/pagarme", require("./routes/pagarmeRoutes"));
app.use("/api/entregadores-online", require("./routes/entregadorOnlineRoutes"));
app.use("/api/mercadopago", require("./routes/mercadoPagoRoutes"));
app.use("/api", require("./routes/mercadoPagoWebhookRoutes"));

// Rotas que precisam receber io()
app.use("/api/pedidos", require("./routes/pedidosRoutes")(io));
app.use("/api/entregadores", require("./routes/entregadorRoutes")(io));

app.use("/api/publico/mercadopago", mercadoPagoPublicoRoutes);
app.use("/api/garcons", garcomRoutes);
app.use("/api/estoque", require("./routes/estoqueRoutes"));
app.use("/api/balcao", require("./routes/balcaoRoutes"));

const imagensRoutes = require("./routes/imagens.routes");
app.use("/api/imagens", imagensRoutes);

// Teste / Health
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando 🚀", service: "movyo-api", ts: new Date().toISOString() });
});



/* =========================================================
   ✅ ANTI-CRASH: HANDLERS GLOBAIS
   - evita o processo cair por promise rejeitada/erro não tratado
   ========================================================= */
process.on("unhandledRejection", (reason) => {
  console.error("🛑 unhandledRejection:", reason);
  // não derruba o servidor
});

process.on("uncaughtException", (err) => {
  console.error("🛑 uncaughtException:", err);
  // não derruba o servidor (recomendado em produção usar PM2/Docker pra restart)
});


let botsRestaurados = false;
async function restaurarBotsLigados() {
  if (botsRestaurados) return;
  botsRestaurados = true;
  try {
    const botsLigados = await Restaurante.find({ "statusBot.ligado": true }).lean();
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
