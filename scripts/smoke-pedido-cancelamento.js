const assert = require("assert");
const axios = require("axios");

const pedidoModelPath = require.resolve("../models/Pedido");
const restauranteModelPath = require.resolve("../models/Restaurante");

let restauranteAtual = { mercadoPago: {} };
const pedidoModelStub = {
  find: async () => [],
  findOne: async () => null,
};
const restauranteModelStub = {
  findById: () => ({
    lean: async () => restauranteAtual,
    select: async () => restauranteAtual,
  }),
  find: async () => [],
};
require.cache[pedidoModelPath] = {
  id: pedidoModelPath,
  filename: pedidoModelPath,
  loaded: true,
  exports: pedidoModelStub,
};
require.cache[restauranteModelPath] = {
  id: restauranteModelPath,
  filename: restauranteModelPath,
  loaded: true,
  exports: restauranteModelStub,
};

const {
  cancelarPedidoComAuditoria,
  pedidoJaCancelado,
  statusBloqueiaCancelamento,
} = require("../services/pedidoCancelamentoService");

function pedidoBase(overrides = {}) {
  const pedido = {
    _id: "pedido-1",
    restaurante: "restaurante-1",
    status: "pendente",
    statusPagamento: "pendente",
    valorTotal: 89.9,
    total: 89.9,
    valorPago: 0,
    itens: [{ nome: "Combo", quantidade: 1, precoUnitario: 89.9, precoTotal: 89.9 }],
    pagamentos: [],
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
    toObject() {
      const plain = { ...this };
      delete plain.save;
      delete plain.toObject;
      return plain;
    },
    ...overrides,
  };
  return pedido;
}

async function run() {
  assert.equal(statusBloqueiaCancelamento({ status: "entregue" }), true);
  assert.equal(statusBloqueiaCancelamento({ status: "finalizado" }), true);
  assert.equal(statusBloqueiaCancelamento({ status: "entregue" }, "devolucao_cliente"), false);

  const pedidoDinheiro = pedidoBase();
  const primeira = await cancelarPedidoComAuditoria(pedidoDinheiro, { motivo: "Teste local" });
  assert.equal(primeira.estorno.status, "nao_aplicavel");
  assert.equal(pedidoDinheiro.status, "cancelado");
  assert.equal(pedidoDinheiro.valorCancelado, 89.9);
  assert.equal(pedidoDinheiro.pedidoOriginalSnapshot.valorTotal, 89.9);
  assert.equal(pedidoDinheiro.itens.length, 0);
  assert.equal(pedidoDinheiro.itensCancelados.length, 1);
  assert.equal(pedidoDinheiro.saveCount, 1);

  const repetida = await cancelarPedidoComAuditoria(pedidoDinheiro, { motivo: "Repetido" });
  assert.equal(repetida.jaCancelado, true);
  assert.equal(pedidoDinheiro.saveCount, 1);
  assert.equal(pedidoDinheiro.itensCancelados.length, 1);
  assert.equal(pedidoJaCancelado(pedidoDinheiro), true);

  restauranteAtual = { mercadoPago: { accessToken: "token-teste" } };
  const originalPost = axios.post;
  axios.post = async (url, body, config) => {
    assert.equal(url, "https://api.mercadopago.com/v1/payments/mp-123/refunds");
    assert.equal(body && Object.keys(body).length, 0);
    assert.equal(config.headers.Authorization, "Bearer token-teste");
    assert.ok(config.headers["X-Idempotency-Key"].includes("mp-123"));
    return { data: { id: "refund-1", status: "approved", amount: 129.9 } };
  };

  const pedidoPix = pedidoBase({
    _id: "pedido-pix",
    formaPagamento: "pix",
    mpPaymentId: "mp-123",
    valorTotal: 129.9,
    total: 129.9,
    valorPago: 129.9,
    itens: [{ nome: "Pedido Pix", quantidade: 1, precoUnitario: 129.9, precoTotal: 129.9 }],
  });
  const online = await cancelarPedidoComAuditoria(pedidoPix, { motivo: "Teste estorno" });
  axios.post = originalPost;

  assert.equal(online.estorno.status, "concluido");
  assert.equal(pedidoPix.statusPagamento, "estornado");
  assert.equal(pedidoPix.estornoValor, 129.9);
  assert.equal(pedidoPix.valorCancelado, 129.9);

  const mesaModelPath = require.resolve("../models/mesaModel");
  const mpPixServicePath = require.resolve("../services/mercadoPagoPixService");
  const saasBillingPath = require.resolve("../services/saasBillingService");
  const botPath = require.resolve("../utils/bot");
  const caixaServicePath = require.resolve("../services/caixaService");
  const throwVenda = async () => {
    throw new Error("Pedido cancelado nao pode registrar venda no caixa.");
  };
  require.cache[mesaModelPath] = { id: mesaModelPath, filename: mesaModelPath, loaded: true, exports: {} };
  require.cache[mpPixServicePath] = {
    id: mpPixServicePath,
    filename: mpPixServicePath,
    loaded: true,
    exports: { consultarPagamento: async () => ({ status: "approved", transaction_amount: 59.9 }) },
  };
  require.cache[saasBillingPath] = {
    id: saasBillingPath,
    filename: saasBillingPath,
    loaded: true,
    exports: { processarWebhookMensalidade: async () => null },
  };
  require.cache[botPath] = {
    id: botPath,
    filename: botPath,
    loaded: true,
    exports: { enviarMensagem: async () => {}, estaConectado: () => false },
  };
  require.cache[caixaServicePath] = {
    id: caixaServicePath,
    filename: caixaServicePath,
    loaded: true,
    exports: {
      getCaixaAberto: throwVenda,
      vincularPedidoAoCaixa: throwVenda,
      registrarMovimentoVenda: throwVenda,
      recalcularCaixa: throwVenda,
    },
  };

  const pedidoCanceladoComPagamentoTardio = pedidoBase({
    _id: "pedido-webhook",
    status: "cancelado",
    statusPagamento: "cancelado",
    canceladoEm: new Date(),
    motivoCancelamento: "Cancelado antes da confirmacao",
    mpPaymentId: "mp-late",
    formaPagamento: "pix",
    valorTotal: 0,
    total: 0,
    valorPago: 0,
    valorCancelado: 59.9,
    pedidoOriginalSnapshot: { valorTotal: 59.9, total: 59.9 },
    pagamentos: [{ metodo: "pix", valor: 59.9, status: "cancelado", mpPaymentId: "mp-late" }],
  });
  pedidoModelStub.findOne = async () => pedidoCanceladoComPagamentoTardio;
  restauranteAtual = { mercadoPago: { accessToken: "token-teste" } };
  axios.post = async () => ({ data: { id: "refund-late", status: "approved", amount: 59.9 } });

  const { mpWebhook } = require("../controllers/mercadoPagoWebhookController");
  let webhookPayload = null;
  const req = {
    query: { type: "payment", "data.id": "mp-late" },
    body: {},
    headers: {},
    io: { to: () => ({ emit: () => {} }) },
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      webhookPayload = payload;
      return payload;
    },
  };
  await mpWebhook(req, res);
  axios.post = originalPost;

  assert.equal(res.statusCode, 200);
  assert.equal(webhookPayload.mode, "pedido_cancelado");
  assert.equal(pedidoCanceladoComPagamentoTardio.status, "cancelado");
  assert.equal(pedidoCanceladoComPagamentoTardio.statusPagamento, "estornado");
  assert.equal(pedidoCanceladoComPagamentoTardio.estornoValor, 59.9);

  console.log("OK cancelamento: regras, valor original, idempotencia e estorno Mercado Pago validados.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
