const test = require('node:test');
const assert = require('node:assert/strict');

const { _test, defineModel } = require('../lib/mysqlModelFactory');
const { pool } = require('../db/mysql');

test.after(async () => {
  await pool.end();
});

const fields = {
  restaurante: { type: 'VARCHAR(24)', kind: 'id' },
  status: { type: 'VARCHAR(255)' },
  ativo: { type: 'TINYINT(1)', kind: 'boolean' },
  criadoEm: { type: 'DATETIME', kind: 'date' },
  total: { type: 'DECIMAL(12,2)', kind: 'number' },
  configuracao: { type: 'LONGTEXT', kind: 'json', json: true },
};

test('compila igualdade e IN usando parametros', () => {
  const compiled = _test.compileSqlFilter({
    restaurante: 'abc',
    status: { $in: ['pendente', 'em_rota'] },
    ativo: true,
  }, fields);

  assert.equal(
    compiled.where,
    '`restaurante` = ? AND `status` IN (?, ?) AND `ativo` = ?'
  );
  assert.deepEqual(compiled.params, ['abc', 'pendente', 'em_rota', 1]);
});

test('compila grupos, datas, faixas e aliases de timestamp', () => {
  const from = new Date('2026-08-01T03:00:00.000Z');
  const compiled = _test.compileSqlFilter({
    $or: [{ status: 'pendente' }, { status: 'em_rota' }],
    criadoEm: { $gte: from },
    updatedAt: { $ne: null },
  }, fields);

  assert.match(compiled.where, /^\(`status` = \? OR `status` = \?\)/);
  assert.match(compiled.where, /`criadoEm` >= \?/);
  assert.match(compiled.where, /`updated_at` IS NOT NULL/);
  assert.deepEqual(compiled.params.slice(0, 2), ['pendente', 'em_rota']);
});

test('mantem fallback para filtros pontuados ou regex', () => {
  assert.equal(_test.compileSqlFilter({ 'configuracao.ativo': true }, fields), null);
  assert.equal(_test.compileSqlFilter({ status: { $regex: '^pend' } }, fields), null);
});

test('serializa objeto JSON inteiro sem interpretar suas chaves como operadores', () => {
  const compiled = _test.compileSqlFilter({ configuracao: { ativo: true } }, fields);
  assert.equal(compiled.where, '`configuracao` = ?');
  assert.deepEqual(compiled.params, ['{"ativo":true}']);
});

test('compila ordenacao apenas para colunas conhecidas', () => {
  assert.equal(
    _test.compileSqlSort({ criadoEm: -1, status: 1 }, fields),
    ' ORDER BY `criadoEm` DESC, `status` ASC'
  );
  assert.equal(_test.compileSqlSort({ 'configuracao.ativo': 1 }, fields), null);
});

test('find e count enviam filtro, ordenacao e limite ao MySQL', async () => {
  const originalQuery = pool.query.bind(pool);
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^SHOW COLUMNS/i.test(sql)) return [[{ Field: 'status' }], []];
    if (/^SELECT COUNT/i.test(sql)) return [[{ total: 7 }], []];
    if (/^SELECT \*/i.test(sql)) return [[{ id: 'abc', status: 'pendente' }], []];
    return [[], []];
  };

  try {
    const TestPedido = defineModel('TestPedidoSqlPushdown', {
      table: 'test_pedidos',
      fields: { status: fields.status },
      defaults: {},
      indexes: [],
    });

    assert.equal(await TestPedido.countDocuments({ status: { $in: ['pendente', 'em_rota'] } }), 7);
    const docs = await TestPedido.find({ status: 'pendente' }).sort({ status: -1 }).limit(10).lean();
    assert.equal(docs.length, 1);

    const countCall = calls.find((call) => /^SELECT COUNT/i.test(call.sql));
    assert.match(countCall.sql, /WHERE `status` IN \(\?, \?\)/);
    assert.deepEqual(countCall.params, ['pendente', 'em_rota']);

    const findCall = calls.find((call) => /^SELECT \*/i.test(call.sql));
    assert.match(findCall.sql, /WHERE `status` = \? ORDER BY `status` DESC LIMIT \?/);
    assert.deepEqual(findCall.params, ['pendente', 10]);
  } finally {
    pool.query = originalQuery;
  }
});

test('update com estado anterior nao rele o registro e sincroniza aliases fisicos', async () => {
  const originalQuery = pool.query.bind(pool);
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^SHOW COLUMNS/i.test(sql)) return [[{ Field: 'total' }], []];
    return [[], []];
  };

  try {
    const money = { type: 'DECIMAL(12,2)', kind: 'number' };
    const TestAlias = defineModel('TestAliasSqlUpdate', {
      table: 'test_aliases',
      fields: {
        total: money,
        valorTotal: { ...money, column: 'total' },
      },
      defaults: { total: 0, valorTotal: 0 },
      indexes: [],
    });

    const updated = await TestAlias.findByIdAndUpdate(
      'abc',
      { valorTotal: '12,50' },
      { previous: { _id: 'abc', id: 'abc', total: 1, valorTotal: 1 } }
    );

    assert.equal(updated.total, 12.5);
    assert.equal(updated.valorTotal, 12.5);
    assert.equal(calls.filter((call) => /^SELECT/i.test(call.sql)).length, 0);
    assert.equal(calls.filter((call) => /^UPDATE/i.test(call.sql)).length, 1);
  } finally {
    pool.query = originalQuery;
  }
});
