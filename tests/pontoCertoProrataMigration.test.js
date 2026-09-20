const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('sql/migrations/022_ponto_certo_prorata.sql','utf8');

test('prorata mirror migration is idempotent and limited to restaurante billing fields',()=>{
  for(const token of ['billingIsProrata','billingProrataDays','billingProrataCycleDays','billingPeriodStart','billingPeriodEnd','billingBaseAmount']) assert.match(sql,new RegExp(token));
  assert.doesNotMatch(sql,/ALTER TABLE\s+(pedidos|pagamentos|cobrancas_saas)/i);
  assert.match(sql,/information_schema\.COLUMNS/i);
});
