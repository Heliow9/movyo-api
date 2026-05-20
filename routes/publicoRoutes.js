const express = require("express");
const axios = require("axios");
const router = express.Router();

const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");
const { listarPedidosDoCliente } = require("../controllers/pedidoController");

function getMpToken(restaurante) {
  return (
    restaurante?.mercadoPago?.access_token ||
    restaurante?.mercadoPago?.accessToken ||
    restaurante?.mpAccessToken ||
    restaurante?.mercadoPagoAccessToken ||
    process.env.MP_ACCESS_TOKEN ||
    ""
  );
}

router.get("/pedidos/:telefone", listarPedidosDoCliente);

// Compatibilidade com vitrines antigas: /api/publico/status/:pedidoId
router.get("/status/:pedidoId", async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const pedido = await Pedido.findById(pedidoId);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido não encontrado." });
    }

    let mpStatus = pedido.statusPagamento;

    if (pedido.mpPaymentId) {
      const restauranteId = pedido.restaurante?._id || pedido.restaurante || pedido.restauranteId;
      const restaurante = restauranteId ? await Restaurante.findById(restauranteId) : null;
      const accessToken = getMpToken(restaurante);

      if (accessToken) {
        const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${pedido.mpPaymentId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        mpStatus = data?.status || mpStatus;

        if (["approved", "accredited", "paid", "pago"].includes(String(mpStatus).toLowerCase())) {
          pedido.statusPagamento = "pago";
          if (["aguardando_pagamento", "pendente"].includes(String(pedido.status || "").toLowerCase())) {
            pedido.status = "em_producao";
          }
          pedido.pagoEm = pedido.pagoEm || new Date();
          await pedido.save();
        } else if (mpStatus) {
          pedido.statusPagamento = mpStatus;
          await pedido.save();
        }
      }
    }

    return res.json({
      pedidoId: pedido._id || pedido.id,
      status: pedido.status,
      statusPagamento: pedido.statusPagamento || mpStatus,
      payment_status: pedido.statusPagamento || mpStatus,
      pago: ["approved", "accredited", "paid", "pago"].includes(String(pedido.statusPagamento || mpStatus || "").toLowerCase()),
    });
  } catch (err) {
    console.error("Erro ao consultar status público do pedido:", err?.response?.data || err);
    return res.status(500).json({ message: "Erro ao consultar status do pedido." });
  }
});

module.exports = router;
