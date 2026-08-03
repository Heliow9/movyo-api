const test = require('node:test');
const assert = require('node:assert/strict');

const apiMonitor = require('../utils/apiMonitor');

test('snapshot inclui percentis recentes sem expor as amostras internas', () => {
  const req = { method: 'GET', originalUrl: '/api/pedidos/abc123' };
  const res = { statusCode: 200 };
  [10, 20, 30, 40, 100].forEach((ms) => apiMonitor.captureRequest(req, res, ms));

  const route = apiMonitor.snapshot().rotasMaisLentas.find((item) => item.path === '/api/pedidos/abc123');
  assert.equal(route.p50Ms, 30);
  assert.equal(route.p95Ms, 100);
  assert.equal(route.p99Ms, 100);
  assert.equal(route.recentMs, undefined);
});
