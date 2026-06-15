// routes/mesaRoutes.js
const express = require("express");
const router = express.Router();
const mesaController = require("../controllers/mesaController");
const authRestaurante = require("../middlewares/authRestaurante");
const matchRestaurante = require("../middlewares/requireRestaurantMatch");

// =====================
// Público (QR) - fixas primeiro
// =====================
router.post("/sessao/:qrIdentifier", mesaController.iniciarSessaoMesa);
router.post("/pedido", mesaController.criarPedidoMesa);

// Legado (se ainda usa)
router.post("/fechar-comanda/:mesaId", authRestaurante, matchRestaurante, mesaController.fecharComanda);

// =====================
// Gerenciamento (Electron) - fixas primeiro
// =====================
router.post("/lote", authRestaurante, matchRestaurante, mesaController.criarMesasEmLote);
router.post("/", authRestaurante, matchRestaurante, mesaController.criarMesa);
router.delete("/:id", authRestaurante, matchRestaurante, mesaController.excluirMesa);
router.get("/restaurante/:restauranteId", authRestaurante, matchRestaurante, mesaController.listarMesas);

// =====================
// Painel (Electron) - rotas por mesa
// =====================
router.post("/:mesaId/abrir", authRestaurante, matchRestaurante, mesaController.abrirMesaPainel);
router.get("/:mesaId/comanda", authRestaurante, matchRestaurante, mesaController.buscarComandaAtualMesa);
router.post("/:mesaId/itens", authRestaurante, matchRestaurante, mesaController.adicionarItensMesaPainel);

/**
 * ✅ pagamentos parciais no balcão
 * - dinheiro/cartão (confirmado na hora)
 */
router.post("/:mesaId/pagamento", authRestaurante, matchRestaurante, mesaController.registrarPagamentoMesaPainel);

/**
 * ✅ Pix parcial no balcão
 * - gera um QR para um valor
 * - consulta status (recomendado consultar por paymentId)
 */
router.post("/:mesaId/pix", authRestaurante, matchRestaurante, mesaController.gerarPixMesaPainel);

// ✅ opção simples: consulta o "pix pendente mais recente" daquele pedido
router.get("/:mesaId/pix/status", authRestaurante, matchRestaurante, mesaController.statusPixMesaPainel);

// ✅ opção mais correta: consulta um paymentId específico (recomendado pro parcial)
router.get("/:mesaId/pix/:paymentId/status", authRestaurante, matchRestaurante, mesaController.statusPixMesaPainel);

router.post("/:mesaId/fechar", authRestaurante, matchRestaurante, mesaController.fecharMesaPainel);

router.post("/:mesaId/pix/enviar-whatsapp", authRestaurante, matchRestaurante, mesaController.enviarPixWhatsappMesaPainel);

module.exports = router;
