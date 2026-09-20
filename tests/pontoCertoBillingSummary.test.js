const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPontoCertoBillingSummary, buildLegacyBillingSummary } = require('../services/saasBillingSummary');

const mensalidade={planoCodigo:'professional',planoNome:'Professional',valorPlano:179.90,descontoPercentual:0,descontoValor:0,valorFinal:179.90};

test('Ponto Certo billing summary exposes normalized BolePix fields',()=>{
  const out=buildPontoCertoBillingSummary({
    restaurante:{
      id:'r1',billingSource:'PONTO_CERTO',billingStatus:'ACTIVE',billingChargeStatus:'OPEN',billingAmount:179.90,
      billingChargeId:'pc-123',billingProvider:'EFI',billingPaymentMethod:'HYBRID',billingDueDate:'2026-10-15',
      billingPaymentUrl:'https://boleto',billingPdfUrl:'https://pdf',billingDigitableLine:'12345',
      billingPixCopyPaste:'pix-code',billingPixQrCode:'base64-qr',billingCurrentPeriodEnd:'2026-10-15 23:59:59',billingAccessBlocked:false
    },mensalidade,daysUntil:()=>26
  });
  assert.equal(out.source,'PONTO_CERTO');
  assert.equal(out.status,'OPEN');
  assert.equal(out.billingStatus,'ACTIVE');
  assert.equal(out.cobranca.paymentMethod,'HYBRID');
  assert.equal(out.cobranca.paymentUrl,'https://boleto');
  assert.equal(out.cobranca.pdfUrl,'https://pdf');
  assert.equal(out.cobranca.digitableLine,'12345');
  assert.equal(out.cobranca.pixCopyPaste,'pix-code');
  assert.equal(out.cobranca.pixQrCode,'base64-qr');
  assert.equal(out.mostrarPix,true);
});

test('Ponto Certo paid charge is confirmed and no longer asks for Pix',()=>{
  const out=buildPontoCertoBillingSummary({restaurante:{id:'r1',billingChargeId:'c1',billingChargeStatus:'PAID',billingPixCopyPaste:'pix'},mensalidade,daysUntil:()=>0});
  assert.equal(out.pagamentoConfirmado,true);
  assert.equal(out.mostrarPix,false);
  assert.equal(out.status,'PAID');
});

test('legacy summary keeps Mercado Pago Pix contract and labels source',()=>{
  const out=buildLegacyBillingSummary({
    restaurante:{id:'r2',dataFimPlano:'2026-10-15'},mensalidade,pagamentoConfirmado:false,daysUntil:()=>2,
    cobranca:{id:'legacy-1',status:'pendente',mpPaymentId:'mp-9',pixCopiaECola:'legacy-pix',qrCodeBase64:'legacy-base64',valorFinal:179.90}
  });
  assert.equal(out.source,'MOVYO_LEGACY');
  assert.equal(out.cobranca.provider,'MERCADO_PAGO');
  assert.equal(out.cobranca.paymentMethod,'PIX');
  assert.equal(out.cobranca.pixCopyPaste,'legacy-pix');
  assert.equal(out.cobranca.pixQrCode,'legacy-base64');
  assert.equal(out.mostrarPix,true);
});

test('missing optional boleto URL does not remove other available payment data',()=>{
  const out=buildPontoCertoBillingSummary({restaurante:{id:'r1',billingChargeId:'c1',billingChargeStatus:'OPEN',billingPaymentMethod:'HYBRID',billingDigitableLine:'line',billingPixCopyPaste:'pix'},mensalidade,daysUntil:()=>1});
  assert.equal(out.cobranca.paymentUrl,null);
  assert.equal(out.cobranca.digitableLine,'line');
  assert.equal(out.cobranca.pixCopyPaste,'pix');
});
