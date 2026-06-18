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
  const restaurante = typeof restauranteOrId === "string"
    ? await Restaurante.findById(restauranteOrId).lean()
    : restauranteOrId;
  if (!restaurante) return null;

  const mensalidade = await calcularMensalidade(restaurante);
  const vencimento = restaurante.dataFimPlano || null;
  const diasParaVencer = daysUntil(vencimento);
  const mostrarPix = mensalidade.valorFinal > 0 && diasParaVencer !== null && diasParaVencer <= 3;

  const pendentes = await CobrancaSaas.find({
    restauranteId: restaurante._id || restaurante.id,
    status: { $in: ["pendente", "pending", "aguardando_pagamento"] },
  }).lean();
  const cobrancaPendente = (pendentes || [])
    .sort((a, b) => new Date(b.geradoEm || b.createdAt || 0) - new Date(a.geradoEm || a.createdAt || 0))[0] || null;

  return {
    restauranteId: restaurante._id || restaurante.id,
    vencimento,
    diasParaVencer,
    mostrarPix,
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

module.exports = {
  calcularMensalidade,
  resumoCobrancaRestaurante,
  gerarPixMensalidade,
  confirmarPagamentoMensalidade,
  processarWebhookMensalidade,
};
