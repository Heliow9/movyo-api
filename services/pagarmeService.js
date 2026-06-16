const axios = require("axios");

const PAGARME_API_KEY = String(process.env.PAGARME_SECRET_KEY || process.env.PAGARME_API_KEY || "").trim();
const GOTRACK_RECIPIENT_ID = "re_cmbjn2ueb00ki0l9tiu99p3os";

async function criarCobrancaPix({ itens, nomeCliente, telefoneCliente, valorTotal, pedidoId, restauranteRecipientId }) {
  try {
    if (!PAGARME_API_KEY) throw new Error("PAGARME_SECRET_KEY não configurada.");
    const itensEmCentavos = itens.map((item, index) => ({
      description: item.description,
      quantity: item.quantity,
      amount: item.amount,
      code: (index + 1).toString(),
    }));

    console.log("Itens convertidos:", itensEmCentavos); // deve imprimir certo
    const valorTotalCalculado = itensEmCentavos.reduce(
      (total, item) => total + item.amount * item.quantity,
      0
    );

    const pagarmeRes = await axios.post(
      "https://api.pagar.me/core/v5/orders",
      {
        closed: true,
        items: itensEmCentavos, // <- essa linha é crítica!
        customer: {
          name: nomeCliente,
          email: "cliente@rapigo.com.br",
          document: "10575342420",
          type: "individual",
          address: {
            line_1: "Rua Exemplo, 123",
            line_2: "Apartamento 1",
            zip_code: "12345678",
            city: "Olinda",
            state: "PE",
            country: "BR"
          },
          phones: {
            home_phone: {
              country_code: "55",
              area_code: telefoneCliente.slice(0, 2),
              number: telefoneCliente.slice(2)
            },
            mobile_phone: {
              country_code: "55",
              area_code: telefoneCliente.slice(0, 2),
              number: telefoneCliente.slice(2)
            }
          }
        },
        payments: [
          {
            payment_method: "pix",
            pix: {
              expires_in: 7200,
              additional_information: [
                {
                  name: "Pedido",
                  value: pedidoId
                }
              ]
            },
            amount: valorTotalCalculado,
            metadata: { pedidoId },
            split: [
              {
                type: "flat", // <- aqui o certo
                amount: 50, // R$ 0,50 para o sistema
                recipient_id: GOTRACK_RECIPIENT_ID,
                options: {
                  liable: true,
                  charge_processing_fee: true,
                  charge_remainder_fee: true
                }
              },
              {
                type: "flat",
                amount: valorTotalCalculado - 50, // o resto vai para o restaurante
                recipient_id: restauranteRecipientId,
                options: {
                  liable: true,
                  charge_processing_fee: false,
                  charge_remainder_fee: false
                }
              }
            ]

          }
        ]
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(PAGARME_API_KEY + ":").toString("base64")}`,
          "Content-Type": "application/json"
        }
      }
    );

    const orderId = pagarmeRes.data.id;
    const transaction = pagarmeRes.data.charges[0].last_transaction;
    const transactionId = transaction.id;
    const status = transaction.status;
    const qr_code = transaction.qr_code;
    const qr_code_url = transaction.qr_code_url;
    console.log(pagarmeRes)
    return {
      pix_qr_code: qr_code,
      pix_qr_code_url: qr_code_url,
      pagarmeOrderId: orderId,
      transactionId,
      status,
    };

  } catch (err) {
    console.error("❌ Erro na cobrança Pix:");
    console.error(JSON.stringify(err?.response?.data || err.message, null, 2));
    throw new Error("Erro ao gerar cobrança Pix");
  }
}

module.exports = { criarCobrancaPix };
