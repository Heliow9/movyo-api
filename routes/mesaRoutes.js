// routes/mesaRoutes.js
const express = require("express");
const router = express.Router();
const mesaController = require("../controllers/mesaController");

// =====================
// Público (QR) - fixas primeiro
// =====================
router.post("/sessao/:qrIdentifier", mesaController.iniciarSessaoMesa);
router.post("/pedido", mesaController.criarPedidoMesa);

// Legado (se ainda usa)
router.post("/fechar-comanda/:mesaId", mesaController.fecharComanda);

// =====================
// Gerenciamento (Electron) - fixas primeiro
// =====================
router.post("/lote", mesaController.criarMesasEmLote);
router.post("/", mesaController.criarMesa);
router.delete("/:id", mesaController.excluirMesa);
router.get("/restaurante/:restauranteId", mesaController.listarMesas);

// =====================
// Painel (Electron) - rotas por mesa
// =====================
router.post("/:mesaId/abrir", mesaController.abrirMesaPainel);
router.get("/:mesaId/comanda", mesaController.buscarComandaAtualMesa);
router.post("/:mesaId/itens", mesaController.adicionarItensMesaPainel);

/**
 * ✅ pagamentos parciais no balcão
 * - dinheiro/cartão (confirmado na hora)
 */
router.post("/:mesaId/pagamento", mesaController.registrarPagamentoMesaPainel);

/**
 * ✅ Pix parcial no balcão
 * - gera um QR para um valor
 * - consulta status (recomendado consultar por paymentId)
 */
router.post("/:mesaId/pix", mesaController.gerarPixMesaPainel);

// ✅ opção simples: consulta o "pix pendente mais recente" daquele pedido
router.get("/:mesaId/pix/status", mesaController.statusPixMesaPainel);

// ✅ opção mais correta: consulta um paymentId específico (recomendado pro parcial)
router.get("/:mesaId/pix/:paymentId/status", mesaController.statusPixMesaPainel);

router.post("/:mesaId/fechar", mesaController.fecharMesaPainel);

router.post("/:mesaId/pix/enviar-whatsapp", mesaController.enviarPixWhatsappMesaPainel);

module.exports = router;
