const Pedido = require("../models/Pedido");

const pagarmeWebhook = async (req, res) => {
  try {
    const evento = req.body;

    const status = evento?.data?.status;
    const pedidoId = evento?.data?.metadata?.pedidoId;

    if (!pedidoId) {
      console.warn("Webhook recebido sem pedidoId");
      return res.status(400).json({ error: "pedidoId ausente no metadata" });
    }

    console.log(`🧾 Webhook recebido para pedido ${pedidoId} com status: ${status}`);

    // Atualiza o status se for um dos relevantes
    if (["paid", "pending", "canceled", "failed"].includes(status)) {
      await Pedido.findByIdAndUpdate(pedidoId, { status });
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Erro no webhook Pagar.me:", error);
    res.status(500).json({ error: "Erro interno no webhook" });
  }
};

module.exports = { pagarmeWebhook };
