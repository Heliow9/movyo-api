const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPontoCertoBillingSummary } = require('../services/saasBillingSummary');

test('Ponto Certo billing summary exposes first-cycle prorata to Desktop/Hub',()=>{
  const resumo=buildPontoCertoBillingSummary({
    restaurante:{
      _id:'r1',billingAmount:86.60,billingBaseAmount:129.90,billingDueDate:'2026-10-10',billingStatus:'ACTIVE',billingChargeStatus:'OPEN',billingChargeId:'c1',billingProvider:'EFI',billingPaymentMethod:'HYBRID',billingIsProrata:true,billingProrataDays:20,billingProrataCycleDays:30,billingPeriodStart:'2026-09-20',billingPeriodEnd:'2026-10-10'
    },
    mensalidade:{planoCodigo:'essencial',planoNome:'Essencial',valorPlano:129.90,descontoPercentual:0,descontoValor:0,valorFinal:129.90},
    daysUntil:()=>20,
  });
  assert.equal(resumo.valorFinal,86.60);
  assert.equal(resumo.isProrata,true);
  assert.equal(resumo.prorataDays,20);
  assert.equal(resumo.prorataCycleDays,30);
  assert.equal(resumo.cobranca.baseAmount,129.90);
  assert.equal(resumo.cobranca.isProrata,true);
});
