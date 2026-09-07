const test = require('node:test');
const assert = require('node:assert/strict');
const defs = require('../models/_defs');
const financeiro = require('../utils/financeiro');

test('financeiro mantém mensalistas isolados por restaurante e telefone', () => {
  assert.ok(defs.ClienteMensalista.fields.restauranteId);
  assert.ok(defs.ClienteMensalista.indexes.some((sql) =>
    /UNIQUE INDEX uq_clientes_mensalistas_rest_telefone.*restauranteId, telefone/i.test(sql)
  ));
});

test('financeiro preserva o dia possível ao avançar parcelas mensais', () => {
  assert.equal(financeiro.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(financeiro.addMonths('2026-01-31', 2), '2026-03-31');
});

test('financeiro normaliza datas vindas do driver MySQL', () => {
  assert.equal(financeiro.dateOnly(new Date(2026, 8, 7, 12, 0, 0)), '2026-09-07');
});

test('status efetivo identifica conta paga, parcial e vencida', () => {
  assert.equal(financeiro.effectiveStatus({ valorOriginal: 100, saldo: 0, status: 'em_aberto' }), 'paga');
  assert.equal(financeiro.effectiveStatus({ valorOriginal: 100, saldo: 40, vencimento: '2999-01-01', status: 'em_aberto' }), 'parcial');
  assert.equal(financeiro.effectiveStatus({ valorOriginal: 100, saldo: 100, vencimento: '2020-01-01', status: 'em_aberto' }), 'vencida');
});
