// routes/balcaoRoutes.js
const express = require("express");
const router = express.Router();
const balcaoController = require("../controllers/balcaoController");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");
router.use(authRestaurante, matchRestaurante);

// =====================
// Painel (Electron) - Balcão
// =====================

// listar pedidos do balcão do restaurante (abertos / em andamento)
router.get("/restaurante/:restauranteId/abertos", balcaoController.listarPedidosBalcaoAbertos);

// abrir um pedido no balcão
router.post("/", balcaoController.abrirPedidoBalcao);

// buscar pedido atual / detalhes
router.get("/:pedidoId", balcaoController.buscarPedidoBalcao);

// adicionar itens no pedido balcão
router.post("/:pedidoId/itens", balcaoController.adicionarItensBalcao);

// pagamentos parciais dinheiro/cartão (confirmado na hora)
router.post("/:pedidoId/pagamento", balcaoController.registrarPagamentoBalcao);

// pix parcial: gera QR por valor
router.post("/:pedidoId/pix", balcaoController.gerarPixBalcao);

// status pix: pega o pendente mais recente
router.get("/:pedidoId/pix/status", balcaoController.statusPixBalcao);

// status pix: consulta um paymentId específico (recomendado)
router.get("/:pedidoId/pix/:paymentId/status", balcaoController.statusPixBalcao);

// fechar pedido (só se quitado)
router.post("/:pedidoId/fechar", balcaoController.fecharPedidoBalcao);

// enviar pix (copia/cola + QR) via bot no WhatsApp
router.post("/:pedidoId/pix/enviar-whatsapp", balcaoController.enviarPixWhatsappBalcao);

module.exports = router;
