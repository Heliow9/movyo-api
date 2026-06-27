const assert = require("assert");

process.env.DELIVERY_OFFER_TIMEOUT_SECONDS = "30";

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const Restaurante = require("../models/Restaurante");

const events = [];
const io = {
  to(room) {
    return {
      emit(event, payload) {
        events.push({ room, event, payload });
      },
    };
  },
};

function createPedido() {
  return {
    _id: "pedido-smoke-1",
    id: "pedido-smoke-1",
    restaurante: "rest-smoke-1",
    status: "em_entrega",
    numeroPedido: "101",
    nomeCliente: "Cliente Teste",
    valorTotal: 50,
    async save() {
      return this;
    },
  };
}

let pedido = createPedido();

Pedido.findById = async (id) => (id === pedido._id ? pedido : null);
Pedido.countDocuments = async () => 0;
Pedido.find = () => ({
  lean: async () => [],
});
Entregador.findById = async () => ({
  _id: "driver-smoke-1",
  id: "driver-smoke-1",
  restaurante: "rest-smoke-1",
  nome: "Motorista Teste",
  email: "motorista@teste.local",
  status: true,
  disponivel: true,
  statusConta: "ativo",
  expoPushToken: "",
});
Restaurante.findById = () => ({
  lean: async () => ({ _id: "rest-smoke-1", maxPedidosPorEntregador: 3 }),
});

const {
  enviarOferta,
  aceitarOferta,
  recusarOferta,
} = require("../services/deliveryOfferService");

async function run() {
  const sent = await enviarOferta({
    pedidoId: pedido._id,
    entregadorId: "driver-smoke-1",
    restauranteId: "rest-smoke-1",
    io,
    origem: "smoke_test",
  });
  assert.equal(sent.pedido.status, "aguardando_resposta");
  assert.equal(sent.pedido.ofertaEntrega.status, "aguardando");
  assert.ok(sent.pedido.ofertaEntrega.expiraEm);
  assert.ok(events.some((item) => item.event === "pedidoRecebido"));

  const accepted = await aceitarOferta({
    pedidoId: pedido._id,
    entregadorId: "driver-smoke-1",
    io,
  });
  assert.equal(accepted.status, "em_rota");
  assert.equal(accepted.ofertaEntrega.status, "aceita");
  assert.ok(events.some((item) => item.event === "pedidoAceito"));

  pedido = createPedido();
  await enviarOferta({
    pedidoId: pedido._id,
    entregadorId: "driver-smoke-1",
    restauranteId: "rest-smoke-1",
    io,
    origem: "smoke_test",
  });
  const declined = await recusarOferta({
    pedidoId: pedido._id,
    entregadorId: "driver-smoke-1",
    motivo: "sem_capacidade",
    io,
  });
  assert.equal(declined.status, "em_entrega");
  assert.equal(declined.entregador, null);
  assert.equal(declined.ofertaEntrega.status, "recusada");
  assert.ok(events.some((item) => item.event === "pedidoRecusado"));

  console.log("Delivery offer smoke test passed.");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
