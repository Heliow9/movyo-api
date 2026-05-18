const express = require("express");
const router = express.Router();
const Pedido = require("../models/Pedido");

router.post("/mercadopago", async (req, res) => {
  const paymentId = req.body.data?.id;
  if (!paymentId) return res.sendStatus(200);

  const mercadopago = require("mercadopago");
  mercadopago.configure({ access_token: process.env.MP_CLIENT_ACCESS_TOKEN });

  const pagamento = await mercadopago.payment.get(paymentId);
  const pedidoId = pagamento.body.external_reference;

  if (pagamento.body.status === "approved") {
    await Pedido.findByIdAndUpdate(pedidoId, { status: "pago" });
  }

  res.sendStatus(200);
});

module.exports = router;
