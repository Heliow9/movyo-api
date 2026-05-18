// routes/garcomRoutes.js
const express = require("express");
const router = express.Router();

const authRestaurante = require("../middlewares/authRestaurante");
const garcomAtivo = require("../middlewares/garcomAtivo");
const checkPermissao = require("../middlewares/checkPermissao");

const garcomController = require("../controllers/garcomController");
const pedidoController = require("../controllers/pedidoController");
const mesaController = require("../controllers/mesaController");

/**
 * =========================
 * ✅ APP DO GARÇOM (público)
 * =========================
 */
router.post("/login", garcomController.loginGarcom);

/**
 * =========================
 * ✅ /app (protegido)
 * =========================
 * - authRestaurante autentica (garçom OU master/admin/restaurante)
 * - garcomAtivo só roda quando o token for de garçom
 */
router.use("/app", authRestaurante, (req, res, next) => {
  const role = (req.user?.role || req.role || "").toString().toLowerCase();

  // se for garçom, exige estar ativo
  if (role === "garcom") {
    return garcomAtivo(req, res, next);
  }

  // master/admin/restaurante passa
  return next();
});

/**
 * ✅ PERFIL (para sincronizar permissões no app)
 * GET /garcons/app/me
 */
router.get("/app/me", garcomController.meApp);

/* =========================
   ✅ APP: MESAS
========================= */

// Listar mesas
router.get("/app/mesas", checkPermissao("verMesas"), mesaController.listarMesasApp);

// 🍽️ Abrir mesa
router.post(
  "/app/mesa/:mesaId/abrir",
  checkPermissao("abrirMesa"),
  mesaController.abrirMesaPainel
);

// 🧾 Ver comanda (mesa)
router.get(
  "/app/mesa/:mesaId/comanda",
  checkPermissao("verComanda"),
  mesaController.getComandaMesaApp
);

// ➕ Adicionar itens na comanda
router.post(
  "/app/mesa/:mesaId/itens",
  checkPermissao("adicionarItem"),
  mesaController.adicionarItensMesaApp
);

// ✅ PIX (gera QR Code)
router.post(
  "/app/mesa/:mesaId/pix",
  checkPermissao("fecharConta"),
  mesaController.gerarPixMesaApp
);

// ✅ PIX (consulta status e se aprovado fecha mesa + carimba)
router.get(
  "/app/mesa/:mesaId/pix",
  checkPermissao("fecharConta"),
  mesaController.statusPixMesaApp
);

// 💳 Fechar conta (finaliza mesa manualmente)
router.post(
  "/app/mesa/:mesaId/fechar",
  checkPermissao("fecharConta"),
  mesaController.fecharMesaPainel
);

// ✅ RESUMO (Home)
router.get("/app/resumo", checkPermissao("verMesas"), mesaController.resumoHomeApp);

/* =========================
   ✅ APP: PEDIDOS
========================= */

router.get("/app/pedidos", checkPermissao("verPedidos"), pedidoController.listarPedidos);

router.post(
  "/app/pedido/:pedidoId/cancelar",
  checkPermissao("cancelarPedido"),
  pedidoController.cancelarPedido
);

router.post(
  "/app/pedido/:pedidoId/item/:itemIndex/cancelar",
  checkPermissao("cancelarPedido"),
  pedidoController.cancelarItemPedido
);

/* =========================
   ✅ PAINEL DO RESTAURANTE
========================= */

// 🔒 Protege painel (restaurante/admin) — aqui authRestaurante já vai rodar de novo
router.use(authRestaurante);

// (Opcional) bloquear token de garçom acessando painel:
// router.use((req, res, next) => {
//   const role = (req.user?.role || req.role || "").toString().toLowerCase();
//   if (role === "garcom") return res.status(403).json({ message: "Acesso negado." });
//   next();
// });

router.get("/", garcomController.listarGarcons);
router.post("/", garcomController.criarGarcom);
router.put("/:garcomId", garcomController.atualizarGarcom);
router.patch("/:garcomId/toggle", garcomController.toggleAtivo);
router.delete("/:garcomId", garcomController.removerGarcom);

module.exports = router;
