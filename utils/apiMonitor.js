const startedAt = Date.now();
const slowRequests = [];
const errors = [];

function pushLimited(arr, item, limit = 80) {
  arr.unshift(item);
  if (arr.length > limit) arr.length = limit;
}

function captureRequest(req, res, ms) {
  const item = {
    method: req.method,
    path: req.originalUrl || req.url,
    statusCode: res.statusCode,
    ms,
    at: new Date().toISOString(),
  };
  if (ms > Number(process.env.API_SLOW_REQUEST_MS || 1000)) pushLimited(slowRequests, item);
  if (res.statusCode >= 500) pushLimited(errors, item);
}

function captureError(err, req) {
  pushLimited(errors, {
    method: req?.method || 'PROCESS',
    path: req?.originalUrl || req?.url || 'global',
    statusCode: 500,
    message: err?.message || String(err),
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
    at: new Date().toISOString(),
  });
}

function snapshot() {
  return {
    ok: true,
    uptimeSegundos: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
    memory: process.memoryUsage(),
    slowRequests: slowRequests.slice(0, 20),
    errors: errors.slice(0, 30),
    totalErrosRecentes: errors.length,
    totalRotasLentasRecentes: slowRequests.length,
  };
}

module.exports = { captureRequest, captureError, snapshot };
