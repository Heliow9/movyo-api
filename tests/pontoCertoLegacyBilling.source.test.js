const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Ponto Certo customer detail exposes only SaaS legacy open-charge summary',()=>{
  const source=fs.readFileSync('controllers/pontoCertoIntegrationController.js','utf8');
  assert.match(source,/CobrancaSaas/);
  assert.match(source,/legacyBillingSummary/);
  assert.match(source,/pendente/);
  assert.match(source,/aguardando_pagamento/);
  assert.doesNotMatch(source,/Pedido\.find|PedidoPagamento/);
});

test('pilot rollback can explicitly restore MOVYO_LEGACY billing source',()=>{
  const source=fs.readFileSync('controllers/pontoCertoIntegrationController.js','utf8');
  assert.match(source,/MOVYO_LEGACY/);
  assert.match(source,/body\.billingSource/);
});
