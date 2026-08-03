const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../controllers/balcaoController');
const defs = require('../models/_defs');
const { pool } = require('../db/mysql');

test.after(async () => {
  await pool.end();
});

test('prioriza a chave idempotente do header e limita seu tamanho', () => {
  const key = _private.getIdempotencyKey({
    headers: { 'x-idempotency-key': `hub_${'a'.repeat(200)}` },
    body: { clientRequestId: 'body-key' },
  });

  assert.equal(key.startsWith('hub_'), true);
  assert.equal(key.length, 120);
});

test('serializa operacoes concorrentes com a mesma chave', async () => {
  let ativas = 0;
  let maxAtivas = 0;

  const executar = async () => {
    const release = await _private.acquireOperationLock('pedido:abc');
    try {
      ativas += 1;
      maxAtivas = Math.max(maxAtivas, ativas);
      await new Promise((resolve) => setTimeout(resolve, 15));
      ativas -= 1;
    } finally {
      release();
    }
  };

  await Promise.all([executar(), executar(), executar()]);
  assert.equal(maxAtivas, 1);
});

test('schema exige uma venda por restaurante e clientRequestId', () => {
  assert.equal(defs.Pedido.fields.clientRequestId.type, 'VARCHAR(120)');
  assert.ok(defs.Pedido.indexes.some((sql) =>
    /CREATE UNIQUE INDEX uq_pedidos_rest_client_request/i.test(sql)
  ));
  assert.ok(defs.CaixaMovimento.indexes.some((sql) =>
    /CREATE UNIQUE INDEX uq_caixa_movimentos_referencia/i.test(sql)
  ));
});
