// routes/pedidosRoutes.js
const express = require("express");
const Pedido = require("../models/Pedido");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");
const { requirePlanFeature } = require("../middlewares/requirePlanFeature");

const {
  // =========================
  // PEDIDO
  // =========================
  criarPedido,
  listarPedidosPorRestaurante,
  obterPedidoPorId,
  atualizarStatusPedido,
  getStatusPedido,

  // =========================
  // BALCÃO
  // =========================
  criarOuAtualizarPedidoBalcao,
  registrarPagamentoPedido,
  gerarPixPedido,
  consultarStatusPixPedido,

  // =========================
  // ENTREGA
  // =========================
  enviarParaEntregador,
  iniciarEntrega,
  concluirEntrega,
  listarPedidosAtivos,
  resumoDoDia,

  // =========================
  // ✅ COZINHA
  // =========================
  listarFilaCozinha,
  marcarItemPronto,
  marcarItemEntregueMesa,
  marcarItemEntregueCliente,
  cancelarPedido,
} = require("../controllers/pedidoController");

function aplicarDataNoPath(req, res, next) {
  const { dia, mes, ano } = req.params;
  if (!/^\d{1,2}$/.test(String(dia)) || !/^\d{1,2}$/.test(String(mes)) || !/^\d{4}$/.test(String(ano))) {
    return next("route");
  }

  const day = Number(dia);
  const month = Number(mes);
  const year = Number(ano);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return res.status(400).json({ message: "Data inválida." });
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return res.status(400).json({ message: "Data inválida." });
  }

  const data = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  req.query.dataInicio = req.query.dataInicio || data;
  req.query.dataFim = req.query.dataFim || data;
  return next();
}

module.exports = (io) => {
  const router = express.Router();

  // =========================================================
  // Middleware: injeta socket.io
  // =========================================================
  router.use((req, res, next) => {
    req.io = io;
    next();
  });

  // =========================================================
  // 🔹 ROTAS FIXAS (SEMPRE PRIMEIRO)
  // =========================================================

  // Criar pedido (vitrine / garçom / compat antigo)
  router.post("/", criarPedido);
  router.post("/pedido", criarPedido);

  // Status / pedido
  router.get("/status/:id", getStatusPedido);
  router.put("/status/:id", authRestaurante, matchRestaurante, atualizarStatusPedido);
  router.get("/pedido/:id", authRestaurante, matchRestaurante, obterPedidoPorId);
  router.post("/:pedidoId/cancelar", authRestaurante, matchRestaurante, cancelarPedido);

  // =========================================================
  // ✅ COZINHA — ANTES do catch-all
  //  - TROCA itemIndex por itemId (mais seguro)
  // =========================================================
  router.get("/:restauranteId/fila-cozinha", authRestaurante, matchRestaurante, requirePlanFeature("production"), listarFilaCozinha);

  router.put("/:pedidoId/itens/:itemIndex/cozinha/pronto", authRestaurante, matchRestaurante, requirePlanFeature("production"), marcarItemPronto);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-mesa", authRestaurante, matchRestaurante, requirePlanFeature("production"), marcarItemEntregueMesa);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-cliente", authRestaurante, matchRestaurante, requirePlanFeature("production"), marcarItemEntregueCliente);

  // =========================================================
  // 🔹 BALCÃO
  // =========================================================

  // Abrir ou atualizar pedido do balcão
  router.post("/balcao/abrir", authRestaurante, matchRestaurante, criarOuAtualizarPedidoBalcao);

  // Pagamento parcial / misto
  router.post("/:pedidoId/pagamento", authRestaurante, matchRestaurante, registrarPagamentoPedido);

  // PIX parcial (balcão)
  router.post("/:pedidoId/pix", authRestaurante, matchRestaurante, requirePlanFeature("onlinePayments"), gerarPixPedido);
  router.get("/:pedidoId/pix/:paymentId/status", authRestaurante, matchRestaurante, consultarStatusPixPedido);

  // =========================================================
  // 🔹 ENTREGA
  // =========================================================
  router.post("/enviar/:idPedido/:idEntregador", authRestaurante, matchRestaurante, requirePlanFeature("deliveryManagement"), enviarParaEntregador);
  router.post("/iniciar-entrega/:id", authRestaurante, matchRestaurante, requirePlanFeature("deliveryManagement"), iniciarEntrega);
  router.post("/concluir-entrega/:id", authRestaurante, matchRestaurante, requirePlanFeature("deliveryManagement"), concluirEntrega);

  // =========================================================
  // 🔹 LISTAS AUXILIARES
  // =========================================================
  router.get("/ativos/:restauranteId", authRestaurante, matchRestaurante, listarPedidosAtivos);
  router.get("/resumo-dia/:entregadorId", authRestaurante, matchRestaurante, resumoDoDia);

  // =========================================================
  // 🔹 PÚBLICO – ACOMPANHAR ENTREGA
  // =========================================================
  router.get("/publico/acompanhar/:token", async (req, res) => {
    try {
      const pedido = await Pedido.findOne({
        "linkEntrega.token": req.params.token,
      }).populate("entregador");

      if (!pedido || !pedido.linkEntrega) {
        return res.status(410).send("Link inválido.");
      }

      if (Date.now() > pedido.linkEntrega.expiracao) {
        return res.status(410).send("Link expirado.");
      }

      return res.json({
        status: pedido.status,
        cliente: pedido.nomeCliente,
        entregador: pedido.entregador?.nome,
        localizacao: pedido.entregador?.localizacao,
      });
    } catch (err) {
      console.error("Erro acompanhar público:", err);
      return res.status(500).send("Erro interno.");
    }
  });

  // =========================================================
  // 🔹 CATCH-ALL (SEMPRE A ÚLTIMA)
  // =========================================================
  router.get("/:restauranteId/:dia/:mes/:ano", aplicarDataNoPath, authRestaurante, matchRestaurante, listarPedidosPorRestaurante);
  router.get("/:restauranteId", authRestaurante, matchRestaurante, listarPedidosPorRestaurante);

  return router;
};
