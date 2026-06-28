const axios = require("axios");

const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");
const CaixaMovimento = require("../models/CaixaMovimento");
const { recalcularCaixa } = require("./caixaService");

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

function getMetodoEstorno(pedido) {
  const formas = [
    pedido?.formaPagamento,
    pedido?.formadePagamento,
    pedido?.pagamento?.metodo,
    ...(Array.isArray(pedido?.pagamentos) ? pedido.pagamentos.map((p) => p?.metodo) : []),
  ].map(norm);

  if (formas.some((forma) => forma.includes("pix"))) return "pix";
  if (formas.some((forma) => ["cartao", "credito", "debito"].some((tipo) => forma.includes(tipo)))) {
    return "cartao";
  }
  return pedido?.mpPaymentId || getMpPaymentIds(pedido).length ? "mercado_pago" : "nao_aplicavel";
}

function isPagamentoConfirmado(pedido) {
  const status = norm(pedido?.statusPagamento || pedido?.pagamento?.status);
  if (["pago", "paid", "approved", "aprovado", "confirmado", "estornado"].includes(status)) return true;
  if (Number(pedido?.valorPago || 0) > 0 || pedido?.pagoEm) return true;
  return (Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : []).some((pagamento) =>
    ["pago", "paid", "approved", "aprovado", "confirmado"].includes(norm(pagamento?.status || pagamento?.mpStatus))
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

function temPagamentoMercadoPago(pedido) {
  return getMpPaymentIds(pedido).length > 0;
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
  const meio = getMetodoEstorno(pedido);
  if (!paymentIds.length) {
    if (isPagamentoConfirmado(pedido) && meio !== "nao_aplicavel") {
      return {
        status: "erro",
        meio,
        valor: 0,
        detalhes: [],
        erro: `Pagamento ${meio === "pix" ? "PIX" : "online"} confirmado sem identificador Mercado Pago para estorno automatico.`,
        mensagem: "Cancelamento concluido, mas o estorno exige acao manual.",
        precisaAcaoManual: true,
        automatico: false,
      };
    }
    return {
      status: "nao_aplicavel",
      meio,
      valor: 0,
      detalhes: [],
      mensagem: "Pedido sem pagamento online confirmado para estornar.",
      precisaAcaoManual: false,
      automatico: false,
    };
  }

  const token = getMpAccessToken(restaurante);
  if (!token) {
    return {
      status: "erro",
      meio,
      valor: 0,
      detalhes: [],
      erro: "Restaurante sem credencial Mercado Pago para estorno.",
      mensagem: "Cancelamento concluido, mas o estorno exige acao manual.",
      precisaAcaoManual: true,
      automatico: false,
    };
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
      const jaEstornado = /already.*refund|already.*refunded|ja.*estorn|j[aá].*devolvid/i.test(
        `${erro} ${JSON.stringify(data)}`
      );
      if (jaEstornado) {
        const amount = Number(data.amount || data.transaction_amount || 0);
        valor += amount;
        detalhes.push({ paymentId, ok: true, status: "already_refunded", amount: amount || null, motivo });
      } else {
        detalhes.push({ paymentId, ok: false, erro, response: data });
      }
    }
  }

  const falhas = detalhes.filter((d) => !d.ok);
  const status = falhas.length ? "erro" : "concluido";
  return {
    status,
    meio,
    valor: round2(valor || getPedidoTotalOriginal(pedido)),
    detalhes,
    erro,
    mensagem: status === "concluido"
      ? `Estorno ${meio === "pix" ? "via PIX" : "online"} concluido com sucesso.`
      : `Falha no estorno ${meio === "pix" ? "via PIX" : "online"}.`,
    precisaAcaoManual: status === "erro",
    automatico: status === "concluido",
  };
}

async function estornarValorMercadoPago({
  pedido,
  restaurante,
  valor,
  motivo,
  referencia = "parcial",
}) {
  const amount = round2(valor);
  const meio = getMetodoEstorno(pedido);
  if (amount <= 0) {
    return {
      status: "nao_aplicavel",
      meio,
      valor: 0,
      detalhes: [],
      mensagem: "Cancelamento sem valor para estorno.",
      precisaAcaoManual: false,
      automatico: false,
    };
  }

  const paymentIds = getMpPaymentIds(pedido);
  if (!paymentIds.length) {
    return {
      status: "erro",
      meio,
      valor: 0,
      detalhes: [],
      erro: "Pagamento confirmado sem identificador Mercado Pago para estorno parcial.",
      mensagem: "O item nao foi cancelado porque o estorno nao pode ser processado automaticamente.",
      precisaAcaoManual: true,
      automatico: false,
    };
  }

  const token = getMpAccessToken(restaurante);
  if (!token) {
    return {
      status: "erro",
      meio,
      valor: 0,
      detalhes: [],
      erro: "Restaurante sem credencial Mercado Pago para estorno parcial.",
      mensagem: "O item nao foi cancelado porque o estorno nao pode ser processado automaticamente.",
      precisaAcaoManual: true,
      automatico: false,
    };
  }

  const paymentId = paymentIds[0];
  try {
    const res = await axios.post(
      `${MP_API}/v1/payments/${paymentId}/refunds`,
      { amount },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `refund_partial_${paymentId}_${pedido._id || pedido.id}_${norm(referencia)}`,
        },
        timeout: 20000,
      }
    );
    const data = res.data || {};
    const refunded = round2(data.amount || data.transaction_amount || amount);
    return {
      status: "concluido",
      meio,
      valor: refunded,
      detalhes: [{
        paymentId,
        ok: true,
        status: data.status || "approved",
        amount: refunded,
        id: data.id || null,
        motivo,
      }],
      mensagem: `Estorno parcial ${meio === "pix" ? "via PIX" : "online"} concluido com sucesso.`,
      precisaAcaoManual: false,
      automatico: true,
    };
  } catch (error) {
    const data = error?.response?.data || {};
    const message = data.message || data.error || error.message;
    return {
      status: "erro",
      meio,
      valor: 0,
      detalhes: [{ paymentId, ok: false, erro: message, response: data }],
      erro: message,
      mensagem: `Falha no estorno parcial ${meio === "pix" ? "via PIX" : "online"}.`,
      precisaAcaoManual: true,
      automatico: false,
    };
  }
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
        meio: getMetodoEstorno(pedido?.pedidoOriginalSnapshot || pedido),
        valor: round2(pedido.estornoValor || 0),
        detalhes: pedido.estornoDetalhes || [],
        erro: pedido.estornoErro || "",
        mensagem: pedido.estornoStatus === "concluido"
          ? "Estorno concluido com sucesso."
          : pedido.estornoStatus === "erro"
            ? "O estorno exige acao manual."
            : "Pedido cancelado sem estorno online aplicavel.",
        precisaAcaoManual: pedido.estornoStatus === "erro",
        automatico: pedido.estornoStatus === "concluido",
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
    : {
        status: "nao_aplicavel",
        meio: getMetodoEstorno(original),
        valor: 0,
        detalhes: [],
        mensagem: "Pedido cancelado sem estorno online aplicavel.",
        precisaAcaoManual: false,
        automatico: false,
      };

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

  let movimentoCaixa = null;
  let caixaAtualizada = null;
  if (pedido.caixaSessaoId && valorOriginal > 0) {
    movimentoCaixa = await CaixaMovimento.create({
      restauranteId,
      caixaSessaoId: String(pedido.caixaSessaoId),
      operadorId: pedido.operadorCaixaId || null,
      tipo: "cancelamento_pedido",
      valor: valorOriginal,
      formaPagamento: original.formaPagamento || original.formadePagamento || "outros",
      origem: original.origem || "pedido",
      pedidoId: pedido._id || pedido.id,
      referenciaPagamento: `cancelamento-pedido:${pedido._id || pedido.id}`,
      descricao: `Cancelamento do pedido ${original.numeroPedido || pedido._id || pedido.id}: ${motivo}`,
      data: new Date(),
    });
    caixaAtualizada = await recalcularCaixa(pedido.caixaSessaoId).catch(() => null);
  }

  if (io && restauranteId) {
    io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    io.to(`restaurante-${restauranteId}`).emit("pedidoCancelado", {
      pedidoId: pedido._id || pedido.id,
      motivo,
      estornoStatus: pedido.estornoStatus,
      movimentoCaixa,
    });
    if (caixaAtualizada) {
      io.to(`restaurante-${restauranteId}`).emit("caixaAtualizado", caixaAtualizada);
    }

    const entregadorId = String(pedido.entregador?._id || pedido.entregador || "");
    if (entregadorId) {
      io.to(`entregador-${entregadorId}`).emit("pedidoCancelado", {
        pedidoId: pedido._id || pedido.id,
        motivo,
      });
    }
  }

  return { pedido, estorno, movimentoCaixa, caixa: caixaAtualizada };
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
  estornarValorMercadoPago,
  isPagamentoOnline,
  isPagamentoConfirmado,
  getMetodoEstorno,
  temPagamentoMercadoPago,
  pedidoJaCancelado,
  statusBloqueiaCancelamento,
  getPedidoTotalOriginal,
};
