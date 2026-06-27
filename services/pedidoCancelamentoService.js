const axios = require("axios");

const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");

const MP_API = "https://api.mercadopago.com";

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

const STATUS_CANCELADOS = new Set(["cancelado", "cancelada", "canceled", "cancelled"]);
const STATUS_FINAIS = new Set(["entregue", "finalizado", "finalizada", "concluido", "concluida"]);

function pedidoJaCancelado(pedido) {
  return STATUS_CANCELADOS.has(norm(pedido?.status)) || !!pedido?.canceladoEm;
}

function statusBloqueiaCancelamento(pedido, tipo = "") {
  if (norm(tipo) === "devolucao_cliente") return false;
  return STATUS_FINAIS.has(norm(pedido?.status));
}

function toPlain(doc) {
  return doc && typeof doc.toObject === "function" ? doc.toObject() : { ...(doc || {}) };
}

function getPedidoTotalOriginal(pedido) {
  const snap = pedido?.pedidoOriginalSnapshot || {};
  return round2(
    snap.valorTotal ??
      snap.total ??
      pedido?.valorTotal ??
      pedido?.total ??
      pedido?.valorPago ??
      0
  );
}

function isPagamentoOnline(pedido) {
  const forma = norm(pedido?.formaPagamento || pedido?.formadePagamento);
  const pagamentos = Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : [];
  if (forma.includes("pix") || forma.includes("cartao") || forma.includes("credito") || forma.includes("debito")) return true;
  if (pedido?.mpPaymentId) return true;
  return pagamentos.some((p) => p?.mpPaymentId || ["pix", "cartao", "credito", "debito"].includes(norm(p?.metodo)));
}

function getMpPaymentIds(pedido) {
  const ids = new Set();
  if (pedido?.mpPaymentId) ids.add(String(pedido.mpPaymentId));
  const pagamentos = Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : [];
  pagamentos.forEach((p) => {
    if (p?.mpPaymentId) ids.add(String(p.mpPaymentId));
  });
  return [...ids].filter(Boolean);
}

function getMpAccessToken(restaurante) {
  let mp = restaurante?.mercadoPago || {};
  if (typeof mp === "string") {
    try { mp = JSON.parse(mp); } catch { mp = {}; }
  }
  return String(mp.accessToken || restaurante?.mercadoPagoAccessToken || "").trim();
}

async function estornarPagamentoMercadoPago({ pedido, restaurante, motivo }) {
  const paymentIds = getMpPaymentIds(pedido);
  if (!paymentIds.length) {
    return { status: "nao_aplicavel", valor: 0, detalhes: [], mensagem: "Pedido sem pagamento Mercado Pago." };
  }

  const token = getMpAccessToken(restaurante);
  if (!token) {
    return { status: "erro", valor: 0, detalhes: [], erro: "Restaurante sem credencial Mercado Pago para estorno." };
  }

  const detalhes = [];
  let valor = 0;
  let erro = "";

  for (const paymentId of paymentIds) {
    try {
      const res = await axios.post(`${MP_API}/v1/payments/${paymentId}/refunds`, {}, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `refund_${paymentId}_${pedido._id || pedido.id}`,
        },
        timeout: 20000,
      });
      const data = res.data || {};
      valor += Number(data.amount || data.transaction_amount || 0);
      detalhes.push({ paymentId, ok: true, status: data.status || "approved", amount: data.amount || null, id: data.id || null, motivo });
    } catch (err) {
      const data = err?.response?.data || {};
      erro = data.message || data.error || err.message;
      detalhes.push({ paymentId, ok: false, erro, response: data });
    }
  }

  const falhas = detalhes.filter((d) => !d.ok);
  return {
    status: falhas.length ? "erro" : "concluido",
    valor: round2(valor || getPedidoTotalOriginal(pedido)),
    detalhes,
    erro,
  };
}

async function cancelarPedidoComAuditoria(pedido, options = {}) {
  const motivo = String(options.motivo || "Cancelamento do pedido").trim();
  const tipo = options.tipo || "manual";
  const role = options.role || "restaurante";
  const canceladoPor = options.canceladoPor || null;
  const io = options.io || null;

  if (pedidoJaCancelado(pedido) && options.reprocessar !== true) {
    return {
      pedido,
      jaCancelado: true,
      estorno: {
        status: pedido.estornoStatus || "nao_aplicavel",
        valor: round2(pedido.estornoValor || 0),
        detalhes: pedido.estornoDetalhes || [],
        erro: pedido.estornoErro || "",
      },
    };
  }

  const restauranteId = String(pedido.restaurante?._id || pedido.restaurante || "");
  const restaurante = options.restaurante || await Restaurante.findById(restauranteId).lean();
  const original = toPlain(pedido);
  const valorOriginal = getPedidoTotalOriginal(original);
  const itensOriginais = Array.isArray(original.itens) ? original.itens : [];
  const pagamentosOriginais = Array.isArray(original.pagamentos) ? original.pagamentos : [];
  const precisaEstorno = options.estornar !== false && isPagamentoOnline(original);
  const estorno = precisaEstorno
    ? await estornarPagamentoMercadoPago({ pedido: original, restaurante, motivo })
    : { status: "nao_aplicavel", valor: 0, detalhes: [] };

  pedido.pedidoOriginalSnapshot = pedido.pedidoOriginalSnapshot || {
    itens: itensOriginais,
    pagamentos: pagamentosOriginais,
    total: original.total,
    valorTotal: original.valorTotal ?? original.total,
    valorPago: original.valorPago,
    formaPagamento: original.formaPagamento || original.formadePagamento,
    statusAnterior: original.status,
    statusPagamentoAnterior: original.statusPagamento,
    mpPaymentId: original.mpPaymentId || null,
    canceladoEm: new Date(),
  };

  pedido.itensCancelados = Array.isArray(pedido.itensCancelados) ? pedido.itensCancelados : [];
  itensOriginais.forEach((it) => {
    const qtd = Number(it?.quantidade || 1);
    const unit = Number(it?.precoUnitario || 0);
    const totalItem = Number.isFinite(Number(it?.precoTotal)) ? Number(it.precoTotal) : qtd * unit;
    pedido.itensCancelados.push({
      item: it,
      canceladoEm: new Date(),
      motivo,
      canceladoPor,
      canceladoPorRole: role,
      quantidadeCancelada: qtd,
      valorCancelado: round2(totalItem),
    });
  });

  pedido.status = "cancelado";
  pedido.statusPagamento = estorno.status === "concluido" ? "estornado" : "cancelado";
  pedido.canceladoEm = pedido.canceladoEm || new Date();
  pedido.motivoCancelamento = motivo;
  pedido.canceladoPorRole = role;
  pedido.canceladoPor = canceladoPor;
  pedido.cancelamentoTipo = tipo;
  pedido.valorCancelado = valorOriginal;
  pedido.estornoStatus = estorno.status;
  pedido.estornoValor = estorno.status === "concluido" ? round2(estorno.valor || valorOriginal) : 0;
  pedido.estornoEm = estorno.status === "concluido" ? new Date() : null;
  pedido.estornoErro = estorno.erro || "";
  pedido.estornoDetalhes = estorno.detalhes || [];

  pedido.itens = [];
  pedido.valorTotal = 0;
  pedido.total = 0;
  pedido.valorPago = 0;
  pedido.valorPendente = 0;
  pedido.pagamentos = pagamentosOriginais.map((p) => ({ ...p, status: estorno.status === "concluido" ? "estornado" : "cancelado" }));
  pedido.pixQrCode = "";
  pedido.pixQrCodeBase64 = "";
  pedido.qrCode = "";
  pedido.qrCodeBase64 = "";
  pedido.pixCopiaECola = "";

  await pedido.save();

  if (io && restauranteId) {
    io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    io.to(`restaurante-${restauranteId}`).emit("pedidoCancelado", {
      pedidoId: pedido._id || pedido.id,
      motivo,
      estornoStatus: pedido.estornoStatus,
    });

    const entregadorId = String(pedido.entregador?._id || pedido.entregador || "");
    if (entregadorId) {
      io.to(`entregador-${entregadorId}`).emit("pedidoCancelado", {
        pedidoId: pedido._id || pedido.id,
        motivo,
      });
    }
  }

  return { pedido, estorno };
}

async function cancelarPedidosVitrineExpirados({ io } = {}) {
  const restaurantes = await Restaurante.find({}).lean();
  let cancelados = 0;

  for (const restaurante of restaurantes || []) {
    const limite = Math.min(6, Math.max(1, Number(restaurante.tempoAutoCancelamentoVitrineMin || 6)));
    const limiteMs = Date.now() - limite * 60 * 1000;
    const pedidos = await Pedido.find({
      restaurante: restaurante._id || restaurante.id,
      origem: { $in: ["vitrine", "delivery", "site", "web"] },
      status: { $in: ["pago", "recebido", "aguardando_confirmacao"] },
      canceladoEm: null,
    });

    for (const pedido of pedidos || []) {
      const base = new Date(pedido.pagoEm || pedido.criadoEm || pedido.createdAt || 0).getTime();
      if (!Number.isFinite(base) || base > limiteMs) continue;
      await cancelarPedidoComAuditoria(pedido, {
        restaurante,
        motivo: `Cancelado automaticamente: pedido sem aceite por ${limite} minuto(s).`,
        tipo: "auto_timeout_vitrine",
        role: "sistema",
        canceladoPor: "auto-timeout",
        io,
      });
      cancelados += 1;
    }
  }

  return { cancelados };
}

module.exports = {
  cancelarPedidoComAuditoria,
  cancelarPedidosVitrineExpirados,
  estornarPagamentoMercadoPago,
  pedidoJaCancelado,
  statusBloqueiaCancelamento,
  getPedidoTotalOriginal,
};
