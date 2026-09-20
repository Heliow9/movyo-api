function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function buildPontoCertoBillingSummary({ restaurante, mensalidade, daysUntil }) {
  const valorFinal = round2(Number(restaurante?.billingAmount || 0) > 0
    ? restaurante.billingAmount
    : mensalidade.valorFinal);
  const vencimento = restaurante?.billingDueDate || restaurante?.billingCurrentPeriodEnd || restaurante?.dataFimPlano || null;
  const diasParaVencer = daysUntil(vencimento);
  const billingStatus = String(restaurante?.billingStatus || 'ACTIVE').toUpperCase();
  const chargeStatus = String(restaurante?.billingChargeStatus || '').toUpperCase();
  const paid = ['PAID', 'PAGO'].includes(chargeStatus);
  const canceled = ['CANCELED', 'CANCELADO'].includes(chargeStatus);
  const temPix = Boolean(restaurante?.billingPixCopyPaste || restaurante?.billingPixQrCode);
  const cobranca = restaurante?.billingChargeId ? {
    id: String(restaurante.billingChargeId),
    status: chargeStatus || null,
    provider: restaurante.billingProvider || null,
    paymentMethod: restaurante.billingPaymentMethod || null,
    paymentUrl: restaurante.billingPaymentUrl || null,
    pdfUrl: restaurante.billingPdfUrl || null,
    digitableLine: restaurante.billingDigitableLine || null,
    pixCopyPaste: restaurante.billingPixCopyPaste || null,
    pixQrCode: restaurante.billingPixQrCode || null,
    // aliases legados para clientes antigos durante a transição
    qrCode: restaurante.billingPixCopyPaste || '',
    qrCodeBase64: restaurante.billingPixQrCode || '',
    valorFinal,
    baseAmount: round2(restaurante?.billingBaseAmount || valorFinal),
    isProrata: restaurante?.billingIsProrata === true || Number(restaurante?.billingIsProrata) === 1,
    prorataDays: restaurante?.billingProrataDays == null ? null : Number(restaurante.billingProrataDays),
    prorataCycleDays: restaurante?.billingProrataCycleDays == null ? null : Number(restaurante.billingProrataCycleDays),
    periodStart: restaurante?.billingPeriodStart || null,
    periodEnd: restaurante?.billingPeriodEnd || null,
  } : null;
  return {
    source: 'PONTO_CERTO',
    restauranteId: restaurante?._id || restaurante?.id,
    vencimento,
    diasParaVencer,
    mostrarPix: temPix && !paid && !canceled,
    pagamentoConfirmado: paid,
    planoCodigo: mensalidade.planoCodigo,
    planoNome: mensalidade.planoNome,
    valorPlano: mensalidade.valorPlano,
    descontoPercentual: mensalidade.descontoPercentual,
    descontoValor: mensalidade.descontoValor,
    valorFinal,
    isProrata: restaurante?.billingIsProrata === true || Number(restaurante?.billingIsProrata) === 1,
    prorataDays: restaurante?.billingProrataDays == null ? null : Number(restaurante.billingProrataDays),
    prorataCycleDays: restaurante?.billingProrataCycleDays == null ? null : Number(restaurante.billingProrataCycleDays),
    billingPeriodStart: restaurante?.billingPeriodStart || null,
    billingPeriodEnd: restaurante?.billingPeriodEnd || null,
    status: chargeStatus || billingStatus,
    billingStatus,
    billingAccessBlocked: restaurante?.billingAccessBlocked === true,
    graceUntil: restaurante?.billingGraceUntil || null,
    currentPeriodEnd: restaurante?.billingCurrentPeriodEnd || null,
    cobranca,
  };
}

function buildLegacyBillingSummary({ restaurante, mensalidade, cobranca, pagamentoConfirmado, daysUntil }) {
  const vencimento = restaurante?.dataFimPlano || null;
  const diasParaVencer = daysUntil(vencimento);
  const mostrarPix = mensalidade.valorFinal > 0 && diasParaVencer !== null && diasParaVencer <= 3;
  const copyPaste = cobranca?.qrCode || cobranca?.pixCopiaECola || '';
  const qrBase64 = cobranca?.qrCodeBase64 || '';
  return {
    source: 'MOVYO_LEGACY',
    restauranteId: restaurante?._id || restaurante?.id,
    vencimento,
    diasParaVencer,
    mostrarPix,
    pagamentoConfirmado: Boolean(pagamentoConfirmado),
    ...mensalidade,
    status: cobranca?.status || (pagamentoConfirmado ? 'PAID' : null),
    cobranca: cobranca ? {
      id: cobranca._id || cobranca.id,
      status: cobranca.status,
      paymentId: cobranca.mpPaymentId || null,
      provider: 'MERCADO_PAGO',
      paymentMethod: 'PIX',
      paymentUrl: null,
      pdfUrl: null,
      digitableLine: null,
      pixCopyPaste: copyPaste || null,
      pixQrCode: qrBase64 || null,
      // aliases antigos continuam disponíveis durante o rollout
      qrCode: copyPaste,
      qrCodeBase64: qrBase64,
      valorFinal: Number(cobranca.valorFinal || mensalidade.valorFinal),
    } : null,
  };
}

module.exports = { buildPontoCertoBillingSummary, buildLegacyBillingSummary };
