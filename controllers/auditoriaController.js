const AuditLog = require('../models/AuditLog');

function parseDate(value, end = false) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0,10)}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

exports.listar = async (req, res) => {
  try {
    const restauranteId = String(req.query.restauranteId || req.restauranteId || '');
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const query = restauranteId ? { restauranteId } : {};
    if (req.query.acao) query.acao = String(req.query.acao);
    const inicio = parseDate(req.query.inicio);
    const fim = parseDate(req.query.fim, true);
    if (inicio || fim) query.criadoEm = { ...(inicio ? {$gte:inicio}:{}), ...(fim ? {$lte:fim}:{}) };
    const logs = await AuditLog.find(query).sort({ criadoEm: -1 }).limit(limit).lean();
    return res.json({ total: logs.length, logs });
  } catch (error) {
    return res.status(500).json({ mensagem:'Erro ao consultar auditoria.', erro:error.message });
  }
};
