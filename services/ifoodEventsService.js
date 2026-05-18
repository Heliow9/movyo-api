// services/ifoodEventsService.js
const axios = require("axios");
const https = require("https");
const { getIfoodToken } = require("./ifoodAuthService");
const Restaurante = require("../models/Restaurante");
// Ajusta o caminho/nome do model de pedido se for diferente:
const Pedido = require("../models/Pedido");

const agent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  minVersion: "TLSv1.2",
});

async function pollIfoodEvents() {
  const token = await getIfoodToken();

  // Buscar restaurantes que têm integração iFood ativa
  const restaurantes = await Restaurante.find({
    ifoodStatus: true,
    ifoodIdentificador: { $exists: true, $ne: null, $ne: "" },
  }).select("ifoodIdentificador");


  if (!restaurantes.length) return;

  const merchantIds = restaurantes
    .map(r => r.ifood.merchantId)
    .filter(Boolean)
    .join(",");

  if (!merchantIds) return;

  const resp = await axios.get(
    `${process.env.IFOOD_BASE_URL}/v1.0/events:polling`,
    {
      httpsAgent: agent,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-polling-merchants": merchantIds,
      },
      // Se a API aceitar filtros por grupo/tipo de evento, você pode usar params aqui
      // params: { groups: "ORDER_STATUS" }
    }
  );

  const eventos = resp.data || [];
  if (!eventos.length) return;

  const ackIds = [];

  for (const ev of eventos) {
    try {
      const eventId = ev.id;
      const payload = ev.payload || {};
      const orderId = payload.orderId;
      const merchantId = payload.merchantId;

      if (!ehEventoDePedidoAceito(ev)) {
        ackIds.push(eventId);
        continue;
      }

      // Buscar detalhes do pedido no iFood
      const orderResp = await axios.get(
        `${process.env.IFOOD_BASE_URL}/v1.0/orders/${orderId}`,
        {
          httpsAgent: agent,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const orderData = orderResp.data;

      // Verifica se já existe (idempotência)
      const existente = await Pedido.findOne({
        origem: "IFOOD",
        externalOrderId: orderId,
      });

      if (!existente) {
        // Descobrir restaurante interno pelo merchantId
        const restaurante = await Restaurante.findOne({
          "ifood.merchantId": merchantId,
        }).select("_id");

        const novoPedido = await Pedido.create({
          origem: "IFOOD",
          externalOrderId: orderId,
          restaurante: restaurante ? restaurante._id : null,
          statusDashboard: "NOVO",
          dadosIfoodRaw: orderData, // você pode quebrar isso em campos melhores depois
          criadoEm: new Date(),
        });

        // Se você já tem fluxo com socket.io quando cria pedido,
        // pode emitir aqui se tiver acesso ao io:
        // global.io.emit("novo_pedido_ifood", novoPedido);
      }

      ackIds.push(eventId);
    } catch (err) {
      console.error("Erro processando evento iFood:", err.message);
      // Se quiser reprocessar depois, não adiciona ao ackIds nesse erro
    }
  }

  // Envia ACK para os eventos já processados
  if (ackIds.length) {
    await axios.post(
      `${process.env.IFOOD_BASE_URL}/v1.0/events/acknowledgment`,
      ackIds,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }
}

function ehEventoDePedidoAceito(ev) {
  // Ajustar de acordo com a estrutura real do evento da doc do iFood
  const type = ev.code || ev.eventType || "";
  const status = ev.payload?.status || "";

  const codigosAceito = ["CONFIRMED", "CFM", "ORDER_CONFIRMATION"];
  return codigosAceito.includes(type) || codigosAceito.includes(status);
}

// Função que liga o loop de polling
function startIfoodPolling() {
  console.log("▶️ Iniciando polling iFood...");
  setInterval(() => {
    pollIfoodEvents().catch(err =>
      console.error("Erro no polling iFood:", err.message)
    );
  }, 15000); // 15s, ajusta como quiser
}

module.exports = { startIfoodPolling };
