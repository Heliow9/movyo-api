const startedAt = Date.now();
const slowRequests = [];
const errors = [];
const routeStats = new Map();

function pushLimited(arr, item, limit = 80) {
  arr.unshift(item);
  if (arr.length > limit) arr.length = limit;
}

function normalizePath(path) {
  return String(path || '')
    .split('?')[0]
    .replace(/[a-f0-9]{24}/gi, ':id')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ':date');
}

function trackRoute(req, ms, statusCode) {
  const path = normalizePath(req.baseUrl && req.route?.path
    ? `${req.baseUrl}${req.route.path}`
    : req.originalUrl || req.url);
  const key = `${req.method} ${path}`;
  const current = routeStats.get(key) || {
    method: req.method,
    path,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastStatusCode: null,
    lastAt: null,
  };

  current.count += 1;
  current.totalMs += Number(ms || 0);
  current.maxMs = Math.max(current.maxMs, Number(ms || 0));
  current.lastMs = Number(ms || 0);
  current.lastStatusCode = statusCode;
  current.lastAt = new Date().toISOString();
  routeStats.set(key, current);

  if (routeStats.size > 250) {
    const oldestKey = routeStats.keys().next().value;
    if (oldestKey) routeStats.delete(oldestKey);
  }
}

function captureRequest(req, res, ms) {
  trackRoute(req, ms, res.statusCode);
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
  const rotasMaisLentas = Array.from(routeStats.values())
    .map((route) => ({
      ...route,
      avgMs: Math.round(route.totalMs / Math.max(1, route.count)),
    }))
    .sort((a, b) => (b.avgMs - a.avgMs) || (b.maxMs - a.maxMs))
    .slice(0, 20);

  return {
    ok: true,
    uptimeSegundos: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
    memory: process.memoryUsage(),
    slowRequests: slowRequests.slice(0, 20),
    errors: errors.slice(0, 30),
    rotasMaisLentas,
    totalErrosRecentes: errors.length,
    totalRotasLentasRecentes: slowRequests.length,
  };
}

module.exports = { captureRequest, captureError, snapshot };
