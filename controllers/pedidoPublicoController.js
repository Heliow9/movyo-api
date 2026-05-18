// controllers/pedidoPublicoController.js (ou onde está o POST /publico/pedido)
const Restaurante = require("../models/Restaurante");
const Pedido = require("../models/Pedido");
const { criarPagamentoPix } = require("../services/mercadoPagoPixService");

exports.criarPedidoPublico = async (req, res) => {
  try {
    const payload = req.body;

    // 1) cria pedido no seu banco (ajuste nomes conforme seu model)
    const pedido = await Pedido.create({
      ...payload,
      statusPagamento: payload.formadePagamento === "Pix" ? "pendente" : "nao_aplica",
      mpPaymentId: null,
    });

    // 2) se for Pix, cria cobrança no Mercado Pago usando token do RESTAURANTE
    if (payload.formadePagamento === "Pix") {
      const rest = await Restaurante.findById(payload.restaurante).select("mercadoPago");
      const accessToken = rest?.mercadoPago?.accessToken;

      if (!rest?.mercadoPago?.conectado || !accessToken) {
        return res.status(400).json({
          error:
            "Restaurante não está conectado ao Mercado Pago. Conecte em Configurações > Integrações.",
        });
      }

      const pix = await criarPagamentoPix({
        accessToken,
        pedidoId: pedido._id,
        valorTotal: pedido.valorTotal,
        nomeCliente: pedido.nomeCliente,
        telefoneCliente: pedido.telefoneCliente,
      });

      // salva IDs no pedido pra consultar depois
      pedido.mpPaymentId = pix.paymentId;
      pedido.statusPagamento = pix.status; // pending normalmente
      await pedido.save();

      return res.json({
        ok: true,
        pedidoId: pedido._id,
        mpPaymentId: pix.paymentId,
        qrCodeTexto: pix.qrCode,
        qrCodeBase64: pix.qrCodeBase64,
        status: pix.status,
      });
    }

    // se não for pix, mantém comportamento atual
    return res.json({ ok: true, pedidoId: pedido._id });
  } catch (err) {
    console.error("criarPedidoPublico error:", err?.response?.data || err);
    return res.status(500).json({ error: "Erro ao criar pedido." });
  }
};
