const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const Restaurante = require('../models/Restaurante');
const CobrancaSaas = require('../models/CobrancaSaas');
const RequestLog = require('../models/PontoCertoIntegrationRequest');
const { normalizePlanCode } = require('../utils/planRules');

function idOf(value) {
  return String(value?._id || value?.id || value || '');
}

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numberOr(value, fallback = 0) {
  const n = Number(String(value ?? fallback).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

async function legacyBillingSummary(restauranteId) {
  const filter = {
    restauranteId,
    status: { $in: ['pendente', 'pending', 'aguardando_pagamento'] },
  };
  const openCount = await CobrancaSaas.countDocuments(filter);
  return { openCount: Number(openCount || 0), hasOpenCharges: Number(openCount || 0) > 0 };
}

function publicForPonto(restaurante = {}) {
  const r = typeof restaurante.toObject === 'function' ? restaurante.toObject() : restaurante;
  return {
    id: idOf(r),
    nome: r.nome || '',
    email: r.email || '',
    cnpj: r.cnpj || '',
    telefone: r.telefone || '',
    emailCobranca: r.emailCobranca || '',
    enderecoCep: r.enderecoCep || '',
    enderecoRua: r.enderecoRua || '',
    enderecoNumero: r.enderecoNumero || '',
    enderecoBairro: r.enderecoBairro || '',
    enderecoCidade: r.enderecoCidade || '',
    enderecoEstado: r.enderecoEstado || '',
    plano: r.plano || 'free',
    statusAssinatura: r.statusAssinatura || 'ativo',
    dataInicioPlano: r.dataInicioPlano || null,
    dataFimPlano: r.dataFimPlano || null,
    ativo: r.ativo !== false,
    bloqueado: r.bloqueado === true,
    valorMensalidadeCustomizado: numberOr(r.valorMensalidadeCustomizado, 0),
    descontoMensalidadePercentual: numberOr(r.descontoMensalidadePercentual, 0),
    billingSource: r.billingSource || 'MOVYO_LEGACY',
    pontoCertoCustomerId: r.pontoCertoCustomerId || null,
    pontoCertoSubscriptionId: r.pontoCertoSubscriptionId || null,
    billingStatus: r.billingStatus || 'ACTIVE',
    billingChargeStatus: r.billingChargeStatus || null,
    billingAccessBlocked: r.billingAccessBlocked === true,
    billingCurrentPeriodEnd: r.billingCurrentPeriodEnd || null,
    billingGraceUntil: r.billingGraceUntil || null,
    billingLastSyncAt: r.billingLastSyncAt || null,
    billingProvider: r.billingProvider || null,
    billingChargeId: r.billingChargeId || null,
    billingDueDate: r.billingDueDate || null,
    billingAmount: numberOr(r.billingAmount, 0),
    billingBaseAmount: numberOr(r.billingBaseAmount, 0),
    billingIsProrata: r.billingIsProrata === true || Number(r.billingIsProrata) === 1,
    billingProrataDays: r.billingProrataDays == null ? null : numberOr(r.billingProrataDays, 0),
    billingProrataCycleDays: r.billingProrataCycleDays == null ? null : numberOr(r.billingProrataCycleDays, 0),
    billingPeriodStart: r.billingPeriodStart || null,
    billingPeriodEnd: r.billingPeriodEnd || null,
    billingPaymentMethod: r.billingPaymentMethod || null,
    billingPaymentUrl: r.billingPaymentUrl || null,
    billingPdfUrl: r.billingPdfUrl || null,
    billingDigitableLine: r.billingDigitableLine || null,
    billingPixCopyPaste: r.billingPixCopyPaste || null,
    billingPixQrCode: r.billingPixQrCode || null,
  };
}

async function persistIntegrationResponse(req, status, payload) {
  const record = req.pcIntegrationRequest;
  if (!record) return;
  try {
    await RequestLog.findByIdAndUpdate(idOf(record), {
      $set: {
        responseStatus: Number(status),
        responseJson: JSON.stringify(payload),
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('pontoCertoIntegration response log:', error?.message || error);
  }
}

function replayIfAvailable(req, res) {
  if (!req.pcIdempotentReplay) return false;
  const record = req.pcIntegrationRequest || {};
  try {
    const payload = record.responseJson ? JSON.parse(record.responseJson) : {};
    res.status(Number(record.responseStatus || 200)).json(payload);
    return true;
  } catch {
    return false;
  }
}

async function respond(req, res, status, payload) {
  await persistIntegrationResponse(req, status, payload);
  return res.status(status).json(payload);
}

function billingUpdate(body = {}) {
  const charge = body.charge && typeof body.charge === 'object' ? body.charge : {};
  const requestedSource = String(body.billingSource || 'PONTO_CERTO').toUpperCase();
  const billingSource = requestedSource === 'MOVYO_LEGACY' ? 'MOVYO_LEGACY' : 'PONTO_CERTO';
  const status = String(body.billingStatus || body.status || 'ACTIVE').toUpperCase();
  const blocked = billingSource === 'PONTO_CERTO' && (body.billingAccessBlocked === true || status === 'BLOCKED' || status === 'CANCELED');
  const currentPeriodEnd = parseDate(body.currentPeriodEnd || body.billingCurrentPeriodEnd);
  const graceUntil = parseDate(body.graceUntil || body.billingGraceUntil);
  const dueDate = parseDate(charge.dueDate || body.billingDueDate);
  const update = {
    billingSource,
    billingStatus: status,
    billingAccessBlocked: blocked,
    billingCurrentPeriodEnd: currentPeriodEnd,
    billingGraceUntil: graceUntil,
    billingLastSyncAt: new Date(),
    billingProvider: charge.provider || body.billingProvider || null,
    billingChargeId: charge.id || body.billingChargeId || null,
    billingChargeStatus: charge.status || body.billingChargeStatus || null,
    billingDueDate: dueDate,
    billingAmount: numberOr(charge.amount ?? body.billingAmount, 0),
    billingBaseAmount: numberOr(charge.baseAmount ?? body.billingBaseAmount, charge.amount ?? body.billingAmount ?? 0),
    billingIsProrata: charge.isProrata === true || body.billingIsProrata === true,
    billingProrataDays: charge.prorataDays == null ? (body.billingProrataDays ?? null) : numberOr(charge.prorataDays, 0),
    billingProrataCycleDays: charge.prorataCycleDays == null ? (body.billingProrataCycleDays ?? null) : numberOr(charge.prorataCycleDays, 0),
    billingPeriodStart: parseDate(charge.periodStart || body.billingPeriodStart),
    billingPeriodEnd: parseDate(charge.periodEnd || body.billingPeriodEnd),
    billingPaymentMethod: charge.paymentMethod || body.billingPaymentMethod || null,
    billingPaymentUrl: charge.paymentUrl || body.billingPaymentUrl || null,
    billingPdfUrl: charge.pdfUrl || body.billingPdfUrl || null,
    billingDigitableLine: charge.digitableLine || body.billingDigitableLine || null,
    billingPixCopyPaste: charge.pixCopyPaste || body.billingPixCopyPaste || null,
    billingPixQrCode: charge.pixQrCode || body.billingPixQrCode || null,
  };
  if (body.pontoCertoCustomerId != null) update.pontoCertoCustomerId = String(body.pontoCertoCustomerId);
  if (body.pontoCertoSubscriptionId != null) update.pontoCertoSubscriptionId = String(body.pontoCertoSubscriptionId);
  if (body.planCode || body.plano) update.plano = normalizePlanCode(body.planCode || body.plano);
  if (body.monthlyPrice != null) update.valorMensalidadeCustomizado = Math.max(0, numberOr(body.monthlyPrice, 0));
  if (body.discountPercent != null) update.descontoMensalidadePercentual = Math.min(100, Math.max(0, numberOr(body.discountPercent, 0)));
  if (currentPeriodEnd) update.dataFimPlano = currentPeriodEnd; // espelho para UI/compatibilidade; auth gerida usa billing*.
  return update;
}

exports.listCustomers = async (req, res) => {
  try {
    const rows = await Restaurante.find({}).sort({ created_at: -1 }).lean();
    return res.json({ customers: rows.map(publicForPonto), total: rows.length });
  } catch (error) {
    console.error('Ponto Certo list customers:', error);
    return res.status(500).json({ code: 'MOVYO_CUSTOMERS_LIST_FAILED', mensagem: 'Falha ao listar clientes Movyo.' });
  }
};

exports.getCustomer = async (req, res) => {
  const row = await Restaurante.findById(req.params.id).lean();
  if (!row) return res.status(404).json({ code: 'MOVYO_CUSTOMER_NOT_FOUND', mensagem: 'Restaurante não encontrado.' });
  const customer = publicForPonto(row);
  customer.legacyBilling = await legacyBillingSummary(row._id || row.id);
  return res.json(customer);
};

exports.createCustomer = async (req, res) => {
  if (replayIfAvailable(req, res)) return;
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    if (!String(body.nome || '').trim() || !email) {
      return respond(req, res, 400, { code: 'MOVYO_CUSTOMER_INVALID', mensagem: 'Nome e e-mail são obrigatórios.' });
    }
    if (body.pontoCertoSubscriptionId) {
      const bySubscription = await Restaurante.findOne({ pontoCertoSubscriptionId: String(body.pontoCertoSubscriptionId) }).lean();
      if (bySubscription) return respond(req, res, 200, { customer: publicForPonto(bySubscription), reused: true });
    }
    const existing = await Restaurante.findOne({ email }).lean();
    if (existing) {
      return respond(req, res, 409, { code: 'MOVYO_EMAIL_ALREADY_EXISTS', mensagem: 'E-mail já cadastrado na Movyo.', customerId: idOf(existing) });
    }
    const generatedPassword = crypto.randomBytes(24).toString('base64url');
    const password = String(body.temporaryPassword || generatedPassword);
    const passwordHash = await bcrypt.hash(password, 10);
    const periodEnd = parseDate(body.currentPeriodEnd || body.billingCurrentPeriodEnd);
    const payload = {
      nome: String(body.nome).trim(),
      email,
      senha: passwordHash,
      cnpj: String(body.cnpj || '').trim(),
      telefone: String(body.telefone || '').trim(),
      emailCobranca: normalizeEmail(body.emailCobranca || body.financialEmail || email),
      enderecoCep: String(body.enderecoCep || body.zipCode || '').trim(),
      enderecoRua: String(body.enderecoRua || body.street || '').trim(),
      enderecoNumero: String(body.enderecoNumero || body.number || '').trim(),
      enderecoBairro: String(body.enderecoBairro || body.district || '').trim(),
      enderecoCidade: String(body.enderecoCidade || body.city || '').trim(),
      enderecoEstado: String(body.enderecoEstado || body.state || '').trim().toUpperCase().slice(0, 2),
      slugIdentificador: normalizeSlug(body.slugIdentificador || body.slug || body.nome) || `movyo-${Date.now()}`,
      plano: normalizePlanCode(body.planCode || body.plano || 'starter-mobile'),
      statusAssinatura: 'ativo',
      dataInicioPlano: parseDate(body.startsAt || body.dataInicioPlano) || new Date(),
      dataFimPlano: periodEnd,
      ativo: body.operationalActive !== false,
      valorMensalidadeCustomizado: Math.max(0, numberOr(body.monthlyPrice, 0)),
      descontoMensalidadePercentual: Math.min(100, Math.max(0, numberOr(body.discountPercent, 0))),
      ...billingUpdate(body),
    };
    const created = await Restaurante.create(payload);
    return respond(req, res, 201, { customer: publicForPonto(created), reused: false });
  } catch (error) {
    console.error('Ponto Certo create customer:', error);
    return respond(req, res, 500, { code: 'MOVYO_CUSTOMER_CREATE_FAILED', mensagem: 'Falha ao provisionar restaurante Movyo.' });
  }
};

exports.updateSubscription = async (req, res) => {
  if (replayIfAvailable(req, res)) return;
  const current = await Restaurante.findById(req.params.id).lean();
  if (!current) return respond(req, res, 404, { code: 'MOVYO_CUSTOMER_NOT_FOUND', mensagem: 'Restaurante não encontrado.' });
  const update = billingUpdate(req.body || {});
  await Restaurante.findByIdAndUpdate(req.params.id, { $set: update, $inc: { sessaoVersao: 1 } });
  const updated = await Restaurante.findById(req.params.id).lean();
  return respond(req, res, 200, publicForPonto(updated));
};

exports.blockCustomer = async (req, res) => {
  if (replayIfAvailable(req, res)) return;
  const current = await Restaurante.findById(req.params.id).lean();
  if (!current) return respond(req, res, 404, { code: 'MOVYO_CUSTOMER_NOT_FOUND', mensagem: 'Restaurante não encontrado.' });
  await Restaurante.findByIdAndUpdate(req.params.id, {
    $set: {
      billingSource: 'PONTO_CERTO',
      billingStatus: 'BLOCKED',
      billingAccessBlocked: true,
      billingGraceUntil: parseDate(req.body?.graceUntil),
      billingLastSyncAt: new Date(),
    },
    $inc: { sessaoVersao: 1 },
  });
  const updated = await Restaurante.findById(req.params.id).lean();
  return respond(req, res, 200, publicForPonto(updated));
};

exports.unblockCustomer = async (req, res) => {
  if (replayIfAvailable(req, res)) return;
  const current = await Restaurante.findById(req.params.id).lean();
  if (!current) return respond(req, res, 404, { code: 'MOVYO_CUSTOMER_NOT_FOUND', mensagem: 'Restaurante não encontrado.' });
  const status = String(req.body?.billingStatus || (req.body?.graceUntil ? 'GRACE' : 'ACTIVE')).toUpperCase();
  const update = {
    billingSource: 'PONTO_CERTO',
    billingStatus: status,
    billingAccessBlocked: false,
    billingGraceUntil: parseDate(req.body?.graceUntil),
    billingLastSyncAt: new Date(),
  };
  const end = parseDate(req.body?.currentPeriodEnd);
  if (end) { update.billingCurrentPeriodEnd = end; update.dataFimPlano = end; }
  await Restaurante.findByIdAndUpdate(req.params.id, { $set: update, $inc: { sessaoVersao: 1 } });
  const updated = await Restaurante.findById(req.params.id).lean();
  return respond(req, res, 200, publicForPonto(updated));
};

exports.getLicense = async (req, res) => {
  const current = await Restaurante.findById(req.params.id).lean();
  if (!current) return res.status(404).json({ code: 'MOVYO_CUSTOMER_NOT_FOUND', mensagem: 'Restaurante não encontrado.' });
  const c = publicForPonto(current);
  return res.json({
    id: c.id,
    billingSource: c.billingSource,
    billingStatus: c.billingStatus,
    billingAccessBlocked: c.billingAccessBlocked,
    billingCurrentPeriodEnd: c.billingCurrentPeriodEnd,
    billingGraceUntil: c.billingGraceUntil,
    billingLastSyncAt: c.billingLastSyncAt,
    pontoCertoCustomerId: c.pontoCertoCustomerId,
    pontoCertoSubscriptionId: c.pontoCertoSubscriptionId,
    operationalActive: c.ativo,
    operationalBlocked: c.bloqueado || String(c.statusAssinatura).toLowerCase() === 'bloqueado',
  });
};

exports._test = { publicForPonto, billingUpdate, legacyBillingSummary };
