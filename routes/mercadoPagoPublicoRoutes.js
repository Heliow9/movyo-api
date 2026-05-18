// routes/mercadoPagoPublicoRoutes.js (exemplo)
const express = require("express");
const router = express.Router();
const Restaurante = require("../models/Restaurante");
const Pedido = require("../models/Pedido");
const { consultarPagamento } = require("../services/mercadoPagoPixService");

router.get("/pix/status/:pedidoId", async (req, res) => {
  try {
    const { pedidoId } = req.params;

   const pedido = await Pedido.findById(pedidoId).select("restaurante mpPaymentId statusPagamento status");

    if (!pedido) return res.status(404).json({ error: "Pedido não encontrado." });
    if (!pedido.mpPaymentId) return res.status(400).json({ error: "Pedido não tem pagamento PIX." });

    const rest = await Restaurante.findById(pedido.restaurante).select("mercadoPago");
    const accessToken = rest?.mercadoPago?.accessToken;
    if (!accessToken) return res.status(400).json({ error: "Restaurante sem token Mercado Pago." });

    const st = await consultarPagamento({ accessToken, paymentId: pedido.mpPaymentId });

    // opcional: atualiza no pedido
    pedido.statusPagamento = st.status;
    await pedido.save();

    return res.json({ ok: true, ...st });
  } catch (err) {
    console.error("pix status error:", err?.response?.data || err);
    return res.status(500).json({ error: "Erro ao consultar pagamento." });
  }
});

module.exports = router;
