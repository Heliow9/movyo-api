const axios = require("axios");

const Restaurante = require("../models/Restaurante");
const PlanoSaas = require("../models/PlanoSaas");
const CobrancaSaas = require("../models/CobrancaSaas");

const MP_API = "https://api.mercadopago.com";

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function clamp(v, min, max) {
  const n = Number(String(v ?? 0).replace(",", "."));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value);
  const only = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = only
    ? new Date(Number(only[1]), Number(only[2]) - 1, Number(only[3]), 23, 59, 59, 999)
    : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(value) {
  const due = parseDate(value);
  if (!due) return null;
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.ceil((dueStart.getTime() - startOfToday().getTime()) / 86400000);
}

function startOfDay(value) {
  const d = value ? parseDate(value) : new Date();
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDaysCeil(inicio, fim) {
  const a = startOfDay(inicio);
  const b = startOfDay(fim);
  if (!a || !b) return 0;
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function addDays(date, days) {
  const d = new Date(date || Date.now());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function dateKey(value) {
  const d = parseDate(value) || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getPlatformAccessToken() {
  return String(
    process.env.MOVYO_MP_ACCESS_TOKEN ||
      process.env.MP_PLATFORM_ACCESS_TOKEN ||
      process.env.MP_CLIENT_ACCESS_TOKEN ||
      ""
  ).trim();
}

async function getPlano(planoCodigo) {
  return PlanoSaas.findOne({ codigo: String(planoCodigo || "free").toLowerCase() }).lean();
}

async function calcularMensalidade(restaurante) {
  const planoCodigo = String(restaurante?.plano || "free").toLowerCase();
  const plano = await getPlano(planoCodigo);
  const valorPlano = round2(Number(restaurante?.valorMensalidadeCustomizado || 0) > 0
    ? restaurante.valorMensalidadeCustomizado
    : plano?.valorMensal || 0);
  const descontoPercentual = clamp(restaurante?.descontoMensalidadePercentual, 0, 100);
  const descontoValor = round2(valorPlano * (descontoPercentual / 100));
  const valorFinal = round2(Math.max(0, valorPlano - descontoValor));

  return {
    planoCodigo,
    planoNome: plano?.nome || planoCodigo,
    valorPlano,
    descontoPercentual,
    descontoValor,
    valorFinal,
  };
}

async function resumoCobrancaRestaurante(restauranteOrId) {
  let restaurante = typeof restauranteOrId === "string"
    ? await Restaurante.findById(restauranteOrId).lean()
    : restauranteOrId;
  if (!restaurante) return null;

  let pagamentoConfirmado = false;
  let pendentes = await CobrancaSaas.find({
    restauranteId: restaurante._id || restaurante.id,
    status: { $in: ["pendente", "pending", "aguardando_pagamento"] },
  }).lean();
  let cobrancaPendente = (pendentes || [])
    .sort((a, b) => new Date(b.geradoEm || b.createdAt || 0) - new Date(a.geradoEm || a.createdAt || 0))[0] || null;

  // Fallback importante: se o webhook do Mercado Pago atrasar ou estiver mal configurado,
  // a propria consulta do resumo confirma a mensalidade assim que o MP retornar approved.
  if (cobrancaPendente?.mpPaymentId) {
    try {
      const mp = await consultarPagamentoPlataforma(cobrancaPendente.mpPaymentId);
      const result = await confirmarPagamentoMensalidade({
        paymentId: cobrancaPendente.mpPaymentId,
        mpStatus: mp?.status,
      });
      pagamentoConfirmado = !!result?.paid;
      if (pagamentoConfirmado) {
        restaurante = await Restaurante.findById(restaurante._id || restaurante.id).lean();
        pendentes = await CobrancaSaas.find({
          restauranteId: restaurante._id || restaurante.id,
          status: { $in: ["pendente", "pending", "aguardando_pagamento"] },
        }).lean();
        cobrancaPendente = (pendentes || [])
          .sort((a, b) => new Date(b.geradoEm || b.createdAt || 0) - new Date(a.geradoEm || a.createdAt || 0))[0] || null;
      } else if (mp?.status && mp.status !== cobrancaPendente.status) {
        cobrancaPendente = { ...cobrancaPendente, status: mp.status };
      }
    } catch (err) {
      console.warn("Falha ao sincronizar mensalidade com Mercado Pago:", err?.message || err);
    }
  }

  const mensalidade = await calcularMensalidade(restaurante);
  const vencimento = restaurante.dataFimPlano || null;
  const diasParaVencer = daysUntil(vencimento);
  const mostrarPix = mensalidade.valorFinal > 0 && diasParaVencer !== null && diasParaVencer <= 3;

  return {
    restauranteId: restaurante._id || restaurante.id,
    vencimento,
    diasParaVencer,
    mostrarPix,
    pagamentoConfirmado,
    ...mensalidade,
    cobranca: cobrancaPendente
      ? {
          id: cobrancaPendente._id || cobrancaPendente.id,
          status: cobrancaPendente.status,
          paymentId: cobrancaPendente.mpPaymentId || null,
          qrCode: cobrancaPendente.qrCode || cobrancaPendente.pixCopiaECola || "",
          qrCodeBase64: cobrancaPendente.qrCodeBase64 || "",
          valorFinal: Number(cobrancaPendente.valorFinal || mensalidade.valorFinal),
        }
      : null,
  };
}

async function gerarPixMensalidade(restauranteId) {
  const restaurante = await Restaurante.findById(restauranteId).lean();
  if (!restaurante) {
    const err = new Error("Restaurante nao encontrado.");
    err.status = 404;
    throw err;
  }

  const mensalidade = await calcularMensalidade(restaurante);
  if (mensalidade.valorFinal <= 0) {
    const err = new Error("Plano sem mensalidade para gerar Pix.");
    err.status = 400;
    throw err;
  }

  const vencimento = restaurante.dataFimPlano || new Date();
  const referencia = `${String(restaurante._id || restaurante.id)}:${mensalidade.planoCodigo}:${dateKey(vencimento)}:${mensalidade.valorFinal.toFixed(2)}`;

  const existente = await CobrancaSaas.findOne({
    restauranteId: restaurante._id || restaurante.id,
    referencia,
    status: { $in: ["pendente", "pending", "aguardando_pagamento"] },
  }).lean();

  if (existente?.qrCode || existente?.qrCodeBase64 || existente?.pixCopiaECola) {
    return { reused: true, cobranca: existente, resumo: await resumoCobrancaRestaurante(restaurante) };
  }

  const token = getPlatformAccessToken();
  if (!token) {
    const err = new Error("Credencial Mercado Pago da Movyo nao configurada.");
    err.status = 500;
    throw err;
  }

  const cobranca = await CobrancaSaas.create({
    restauranteId: restaurante._id || restaurante.id,
    planoCodigo: mensalidade.planoCodigo,
    referencia,
    vencimento,
    valorPlano: mensalidade.valorPlano,
    descontoPercentual: mensalidade.descontoPercentual,
    descontoValor: mensalidade.descontoValor,
    valorFinal: mensalidade.valorFinal,
    status: "pendente",
    geradoEm: new Date(),
    metadata: {
      tipo: "mensalidade_saas",
      restauranteNome: restaurante.nome || "",
      planoNome: mensalidade.planoNome,
    },
  });

  const id = String(cobranca._id || cobranca.id);
  const payerEmail = String(restaurante.emailCobranca || restaurante.email || `cliente_${id}@example.com`).trim().toLowerCase();
  const body = {
    transaction_amount: mensalidade.valorFinal,
    description: `Mensalidade Movyo - ${mensalidade.planoNome}`,
    payment_method_id: "pix",
    external_reference: `saas_${id}`,
    payer: {
      email: payerEmail.includes("@") ? payerEmail : `cliente_${id}@example.com`,
      first_name: String(restaurante.nome || "Cliente").split(/\s+/)[0] || "Cliente",
      last_name: "Movyo",
    },
    metadata: {
      tipo: "mensalidade_saas",
      cobrancaId: id,
      restauranteId: String(restaurante._id || restaurante.id),
    },
  };

  const response = await axios.post(`${MP_API}/v1/payments`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `saas_${id}`,
    },
    timeout: 20000,
  });

  const data = response.data || {};
  const tx = data?.point_of_interaction?.transaction_data || {};
  await CobrancaSaas.findByIdAndUpdate(id, {
    $set: {
      mpPaymentId: data.id ? String(data.id) : "",
      status: data.status || "pending",
      qrCode: tx.qr_code || "",
      qrCodeBase64: tx.qr_code_base64 || "",
      pixCopiaECola: tx.qr_code || "",
    },
  });

  const atualizada = await CobrancaSaas.findById(id).lean();
  return { reused: false, cobranca: atualizada, resumo: await resumoCobrancaRestaurante(restaurante) };
}

async function confirmarPagamentoMensalidade({ paymentId, mpStatus }) {
  const cobranca = await CobrancaSaas.findOne({ mpPaymentId: String(paymentId) });
  if (!cobranca) return null;

  const status = String(mpStatus || "").toLowerCase();
  if (!["approved", "paid"].includes(status)) {
    await CobrancaSaas.findByIdAndUpdate(cobranca._id || cobranca.id, { $set: { status: status || cobranca.status || "pending" } });
    return { cobranca, paid: false };
  }

  const restaurante = await Restaurante.findById(cobranca.restauranteId).lean();
  if (!restaurante) return { cobranca, paid: true, restaurante: null };

  const base = parseDate(restaurante.dataFimPlano);
  const hoje = startOfToday();
  const renovacaoBase = base && base > hoje ? base : hoje;
  const novoFim = addDays(renovacaoBase, 30);

  await CobrancaSaas.findByIdAndUpdate(cobranca._id || cobranca.id, {
    $set: { status: "pago", pagoEm: new Date() },
  });

  await Restaurante.findByIdAndUpdate(restaurante._id || restaurante.id, {
    $set: {
      ativo: true,
      statusAssinatura: "ativo",
      dataInicioPlano: new Date(),
      dataFimPlano: novoFim,
    },
    $inc: { sessaoVersao: 1 },
  });

  return { cobranca, paid: true, restauranteId: restaurante._id || restaurante.id, dataFimPlano: novoFim };
}

async function consultarPagamentoPlataforma(paymentId) {
  const token = getPlatformAccessToken();
  if (!token) {
    const err = new Error("Credencial Mercado Pago da Movyo nao configurada.");
    err.status = 500;
    throw err;
  }
  const res = await axios.get(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });
  return res.data || {};
}

async function processarWebhookMensalidade(paymentId) {
  const cobranca = await CobrancaSaas.findOne({ mpPaymentId: String(paymentId) }).lean();
  if (!cobranca) return null;
  const mp = await consultarPagamentoPlataforma(paymentId);
  const result = await confirmarPagamentoMensalidade({ paymentId, mpStatus: mp.status });
  return { cobranca, mp, result };
}

async function estornarMensalidadeParcial({ paymentId, valor, cobrancaId }) {
  const token = getPlatformAccessToken();
  if (!token) {
    const err = new Error("Credencial Mercado Pago da Movyo nao configurada.");
    err.status = 500;
    throw err;
  }
  const response = await axios.post(`${MP_API}/v1/payments/${paymentId}/refunds`, { amount: valor }, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `saas_refund_${cobrancaId}_${dateKey(new Date())}`,
    },
    timeout: 20000,
  });
  return response.data || {};
}

async function cancelarPlanoComEstornoProporcional(restauranteId, opts = {}) {
  const restaurante = await Restaurante.findById(restauranteId).lean();
  if (!restaurante) {
    const err = new Error("Restaurante nao encontrado.");
    err.status = 404;
    throw err;
  }

  const rid = String(restaurante._id || restaurante.id);
  const cobrancas = await CobrancaSaas.find({
    restauranteId: rid,
    status: { $in: ["pago", "paid", "approved"] },
  }).sort({ pagoEm: -1, geradoEm: -1, createdAt: -1 }).lean();
  const cobranca = (cobrancas || [])[0] || null;

  const hoje = startOfToday();
  const inicio = startOfDay(restaurante.dataInicioPlano || cobranca?.pagoEm || cobranca?.geradoEm || hoje) || hoje;
  const fim = startOfDay(restaurante.dataFimPlano || cobranca?.vencimento || addDays(inicio, 30)) || addDays(inicio, 30);
  const totalDias = Math.max(1, diffDaysCeil(inicio, fim));
  const diasRestantes = Math.max(0, Math.min(totalDias, diffDaysCeil(hoje, fim)));
  const diasUsados = Math.max(0, totalDias - diasRestantes);
  const valorPago = round2(cobranca?.valorFinal || 0);
  const valorEstorno = round2(valorPago * (diasRestantes / totalDias));

  let estornoStatus = "sem_cobranca_paga";
  let estornoDetalhes = null;
  let estornoErro = "";

  if (cobranca) {
    if (valorEstorno < 0.01 || diasRestantes <= 0) {
      estornoStatus = "sem_valor";
      estornoDetalhes = { motivo: "Nao ha dias restantes para estorno proporcional." };
    } else if (!cobranca.mpPaymentId) {
      estornoStatus = "manual";
      estornoErro = "Cobranca paga sem mpPaymentId; estorno automatico indisponivel.";
      estornoDetalhes = { motivo: estornoErro };
    } else {
      estornoDetalhes = await estornarMensalidadeParcial({
        paymentId: String(cobranca.mpPaymentId),
        valor: valorEstorno,
        cobrancaId: cobranca._id || cobranca.id,
      });
      estornoStatus = "concluido";
    }

    await CobrancaSaas.findByIdAndUpdate(cobranca._id || cobranca.id, {
      $set: {
        status: "cancelado",
        estornoStatus,
        estornoValor: valorEstorno,
        estornoEm: new Date(),
        estornoErro,
        estornoDetalhes: {
          ...(estornoDetalhes && typeof estornoDetalhes === "object" ? estornoDetalhes : {}),
          diasUsados,
          diasRestantes,
          totalDias,
          valorPago,
          valorEstorno,
        },
      },
    });
  }

  const motivo = String(opts.motivo || opts.observacao || "Plano cancelado pelo SaaS").trim();
  await Restaurante.findByIdAndUpdate(rid, {
    $set: {
      ativo: false,
      statusAssinatura: "cancelado",
      dataFimPlano: hoje,
      cancelamentoPlanoEm: new Date(),
      cancelamentoPlanoMotivo: motivo,
      cancelamentoPlanoEstornoStatus: estornoStatus,
      cancelamentoPlanoEstornoValor: valorEstorno,
      cancelamentoPlanoDetalhes: {
        cobrancaId: cobranca ? String(cobranca._id || cobranca.id) : null,
        paymentId: cobranca?.mpPaymentId || null,
        diasUsados,
        diasRestantes,
        totalDias,
        valorPago,
        valorEstorno,
        canceladoPor: opts.canceladoPor || null,
      },
      observacaoPlano: motivo,
    },
    $inc: { sessaoVersao: 1 },
  });

  return {
    restaurante: await Restaurante.findById(rid).lean(),
    cobranca: cobranca ? await CobrancaSaas.findById(cobranca._id || cobranca.id).lean() : null,
    estorno: {
      status: estornoStatus,
      valor: valorEstorno,
      diasUsados,
      diasRestantes,
      totalDias,
      valorPago,
      erro: estornoErro || null,
      automatico: estornoStatus === "concluido",
    },
  };
}

module.exports = {
  calcularMensalidade,
  resumoCobrancaRestaurante,
  gerarPixMensalidade,
  confirmarPagamentoMensalidade,
  processarWebhookMensalidade,
  cancelarPlanoComEstornoProporcional,
};
