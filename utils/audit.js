const AuditLog = require('../models/AuditLog');

function clean(value, depth = 0) {
  if (depth > 3) return '[limite]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/senha|password|token|authorization|pin|secret|qrCode|pixCopia/i.test(key)) continue;
    out[key] = clean(val, depth + 1);
  }
  return out;
}

async function registrarAuditoria(req, acao, entidade, entidadeId, detalhes = {}) {
  try {
    const restauranteId = String(req?.restauranteId || req?.params?.restauranteId || req?.body?.restauranteId || detalhes?.restauranteId || '');
    const usuarioId = String(req?.garcomId || req?.userId || req?.saasAdmin?.id || req?.saasAdmin?._id || '');
    const usuarioNome = String(req?.garcom?.nome || req?.user?.nome || req?.saasAdmin?.nome || req?.body?.operadorNome || '');
    const role = String(req?.role || req?.user?.role || (req?.saasAdmin ? 'saas-admin' : 'restaurante'));
    await AuditLog.create({
      restauranteId,
      usuarioId,
      usuarioNome,
      role,
      acao: String(acao || 'acao'),
      entidade: String(entidade || ''),
      entidadeId: entidadeId ? String(entidadeId) : '',
      metodo: String(req?.method || ''),
      rota: String(req?.originalUrl || req?.url || ''),
      ip: String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').slice(0, 190),
      userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
      detalhes: clean(detalhes),
      criadoEm: new Date(),
    });
  } catch (error) {
    console.warn('[auditoria] falha ao registrar:', error?.message || error);
  }
}

module.exports = { registrarAuditoria, clean };
