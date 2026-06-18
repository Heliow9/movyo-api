const express = require("express");
const router = express.Router();

const restauranteController = require("../controllers/restauranteController");
const authRestaurante = require("../middlewares/authRestaurante");
const rateLimitPublico = require("../middlewares/rateLimitPublico");

const {
  criarPedido,
  buscarClientePorTelefone,
  criarOuAtualizarCliente,
  listarPedidosDoCliente,
} = require("../controllers/pedidoController");

const uploadLogo = require("../middlewares/uploadLogo");

// auth
router.post("/register", restauranteController.register);
router.post("/login", restauranteController.loginRestaurant);

// recipient
router.post("/:id/recipient", restauranteController.criarRecipientManual);

// teste
router.post("/teste", restauranteController.teste);

// perfil
router.get("/me", authRestaurante, restauranteController.perfil);
router.get("/cobranca/resumo", authRestaurante, restauranteController.resumoCobranca);
router.post("/cobranca/pix", authRestaurante, restauranteController.gerarPixMensalidade);
router.get("/cobranca/:restauranteId/resumo", restauranteController.resumoCobranca);
router.post("/cobranca/:restauranteId/pix", restauranteController.gerarPixMensalidade);

// configuracoes (✅ precisa vir ANTES do /:slug)
router.put("/configuracoes", authRestaurante, restauranteController.atualizarConfiguracoes);
router.patch("/configuracoes/senha", authRestaurante, restauranteController.trocarSenhaConfiguracoes);
router.put("/configuracoes/senha", authRestaurante, restauranteController.trocarSenhaConfiguracoes);
router.post("/configuracoes/senha", authRestaurante, restauranteController.trocarSenhaConfiguracoes);
router.patch("/senha", authRestaurante, restauranteController.trocarSenhaConfiguracoes);
router.put("/senha", authRestaurante, restauranteController.trocarSenhaConfiguracoes);

// publico por mesa
router.get("/mesa/:qrCodeIdentifier", restauranteController.getDadosPublicosByMesa);

// ✅ publico por ID (para o checkout pegar pagamentoCartaoAtivo atualizado)
router.get("/publico/:id", restauranteController.publicoById);

// horario (✅ precisa vir ANTES do /:slug)
router.get("/horario/:id", restauranteController.horarioPublico);

// dados leves para prévia WhatsApp/OpenGraph
router.get("/og/:slug", rateLimitPublico({ prefix: "og-restaurante", max: 120 }), restauranteController.ogRestaurante);

// pagamento cartão
router.patch("/pagamento-cartao", authRestaurante, restauranteController.togglePagamentoCartao);

// pedido publico
router.post("/pedido", rateLimitPublico({ prefix: "checkout-restaurantes", max: 25 }), criarPedido);

// cliente
router.get("/cliente/:telefone", buscarClientePorTelefone);
router.post("/cliente", criarOuAtualizarCliente);
router.get("/pedidos/:telefone", listarPedidosDoCliente);

// upload logo
router.post(
  "/logo",
  authRestaurante,
  uploadLogo.single("logo"),
  restauranteController.uploadLogo
);

// publico por slug (✅ DEIXA POR ÚLTIMO MESMO)
router.get("/:slug", restauranteController.restauranteSlug);

module.exports = router;
