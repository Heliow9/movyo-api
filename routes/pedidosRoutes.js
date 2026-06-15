// routes/pedidosRoutes.js
const express = require("express");
const Pedido = require("../models/Pedido");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");

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
} = require("../controllers/pedidoController");

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

  // =========================================================
  // ✅ COZINHA — ANTES do catch-all
  //  - TROCA itemIndex por itemId (mais seguro)
  // =========================================================
  router.get("/:restauranteId/fila-cozinha", authRestaurante, matchRestaurante, listarFilaCozinha);

  router.put("/:pedidoId/itens/:itemIndex/cozinha/pronto", authRestaurante, matchRestaurante, marcarItemPronto);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-mesa", authRestaurante, matchRestaurante, marcarItemEntregueMesa);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-cliente", authRestaurante, matchRestaurante, marcarItemEntregueCliente);

  // =========================================================
  // 🔹 BALCÃO
  // =========================================================

  // Abrir ou atualizar pedido do balcão
  router.post("/balcao/abrir", authRestaurante, matchRestaurante, criarOuAtualizarPedidoBalcao);

  // Pagamento parcial / misto
  router.post("/:pedidoId/pagamento", authRestaurante, matchRestaurante, registrarPagamentoPedido);

  // PIX parcial (balcão)
  router.post("/:pedidoId/pix", authRestaurante, matchRestaurante, gerarPixPedido);
  router.get("/:pedidoId/pix/:paymentId/status", authRestaurante, matchRestaurante, consultarStatusPixPedido);

  // =========================================================
  // 🔹 ENTREGA
  // =========================================================
  router.post("/enviar/:idPedido/:idEntregador", authRestaurante, matchRestaurante, enviarParaEntregador);
  router.post("/iniciar-entrega/:id", authRestaurante, matchRestaurante, iniciarEntrega);
  router.post("/concluir-entrega/:id", authRestaurante, matchRestaurante, concluirEntrega);

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
  router.get("/:restauranteId", authRestaurante, matchRestaurante, listarPedidosPorRestaurante);

  return router;
};
