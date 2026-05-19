// routes/pedidosRoutes.js
const express = require("express");
const Pedido = require("../models/Pedido");

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
  router.put("/status/:id", atualizarStatusPedido);
  router.get("/pedido/:id", obterPedidoPorId);

  // =========================================================
  // ✅ COZINHA — ANTES do catch-all
  //  - TROCA itemIndex por itemId (mais seguro)
  // =========================================================
  router.get("/:restauranteId/fila-cozinha", listarFilaCozinha);

  router.put("/:pedidoId/itens/:itemIndex/cozinha/pronto", marcarItemPronto);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-mesa", marcarItemEntregueMesa);
  router.put("/:pedidoId/itens/:itemIndex/cozinha/entregue-cliente", marcarItemEntregueCliente);

  // =========================================================
  // 🔹 BALCÃO
  // =========================================================

  // Abrir ou atualizar pedido do balcão
  router.post("/balcao/abrir", criarOuAtualizarPedidoBalcao);

  // Pagamento parcial / misto
  router.post("/:pedidoId/pagamento", registrarPagamentoPedido);

  // PIX parcial (balcão)
  router.post("/:pedidoId/pix", gerarPixPedido);
  router.get("/:pedidoId/pix/:paymentId/status", consultarStatusPixPedido);

  // =========================================================
  // 🔹 ENTREGA
  // =========================================================
  router.post("/enviar/:idPedido/:idEntregador", enviarParaEntregador);
  router.post("/iniciar-entrega/:id", iniciarEntrega);
  router.post("/concluir-entrega/:id", concluirEntrega);

  // =========================================================
  // 🔹 LISTAS AUXILIARES
  // =========================================================
  router.get("/ativos/:restauranteId", listarPedidosAtivos);
  router.get("/resumo-dia/:entregadorId", resumoDoDia);

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
  router.get("/:restauranteId", listarPedidosPorRestaurante);

  return router;
};
