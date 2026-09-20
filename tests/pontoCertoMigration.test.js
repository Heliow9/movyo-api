const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('sql/migrations/021_ponto_certo_billing_bridge.sql','utf8');

test('migration adds billing mirror and integration request ledger idempotently',()=>{
  for(const name of ['billingSource','pontoCertoCustomerId','pontoCertoSubscriptionId','billingStatus','billingAccessBlocked','billingCurrentPeriodEnd','billingGraceUntil','billingLastSyncAt']) assert.match(sql,new RegExp(name));
  assert.match(sql,/information_schema\.COLUMNS/i);
  assert.match(sql,/ponto_certo_integration_requests/i);
  assert.match(sql,/uq_pc_integration_idempotency/i);
  assert.match(sql,/uq_pc_integration_nonce/i);
  assert.doesNotMatch(sql,/REGEXP_REPLACE/i);
});

test('migration does not alter consumer order payment tables',()=>{
  assert.doesNotMatch(sql,/ALTER\s+TABLE\s+(pedidos|pagamentos|transacoes|mercado_pago|pagarme)/i);
});
