const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRestaurantAccessDecision,
  isLegacyLicenseExpired,
  isOperationallyBlocked,
  isPontoCertoFinanciallyBlocked,
  isStaleLegacyFinancialBlock,
} = require('../utils/restaurantAccessPolicy');

const now = new Date(2026, 8, 23, 12, 0, 0); // 23/09/2026 local

test('Ponto Certo is the financial authority and ignores legacy dataFimPlano expiry', () => {
  const restaurante = {
    billingSource: 'PONTO_CERTO',
    billingStatus: 'GRACE',
    billingAccessBlocked: false,
    dataFimPlano: '2026-09-20',
    ativo: true,
    bloqueado: false,
    statusAssinatura: 'ativo',
  };
  assert.equal(isLegacyLicenseExpired(restaurante, now), false);
  assert.equal(getRestaurantAccessDecision(restaurante, now).blocked, false);
});

test('D+3 financial block from Ponto Certo blocks even when legacy fields are active', () => {
  const restaurante = {
    billingSource: 'PONTO_CERTO',
    billingStatus: 'BLOCKED',
    billingAccessBlocked: true,
    ativo: true,
    bloqueado: false,
    statusAssinatura: 'ativo',
  };
  assert.equal(isPontoCertoFinanciallyBlocked(restaurante), true);
  const decision = getRestaurantAccessDecision(restaurante, now);
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'FINANCIAL');
});

test('manual release ignores stale legacy auto-block left by old dataFimPlano routine', () => {
  const restaurante = {
    billingSource: 'PONTO_CERTO',
    billingStatus: 'GRACE',
    billingAccessBlocked: false,
    ativo: false,
    bloqueado: false,
    statusAssinatura: 'bloqueado',
  };
  assert.equal(isStaleLegacyFinancialBlock(restaurante), true);
  assert.equal(isOperationallyBlocked(restaurante), false);
  assert.equal(getRestaurantAccessDecision(restaurante, now).blocked, false);
});

test('explicit operational block remains blocked even during financial release', () => {
  const restaurante = {
    billingSource: 'PONTO_CERTO',
    billingStatus: 'GRACE',
    billingAccessBlocked: false,
    ativo: false,
    bloqueado: true,
    statusAssinatura: 'bloqueado',
  };
  assert.equal(isOperationallyBlocked(restaurante), true);
  const decision = getRestaurantAccessDecision(restaurante, now);
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'OPERATIONAL');
});

test('legacy Movyo restaurant still expires by dataFimPlano', () => {
  const restaurante = {
    billingSource: 'MOVYO_LEGACY',
    dataFimPlano: '2026-09-20',
    ativo: true,
    bloqueado: false,
    statusAssinatura: 'ativo',
  };
  assert.equal(isLegacyLicenseExpired(restaurante, now), true);
  assert.equal(getRestaurantAccessDecision(restaurante, now).reason, 'LEGACY_EXPIRED');
});
