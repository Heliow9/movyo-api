// Rate limit simples em memória para rotas públicas sensíveis.
// Não adiciona dependências e não interfere nas rotas internas/autenticadas.
const buckets = new Map();

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimitPublico(options = {}) {
  const windowMs = Number(options.windowMs || process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 60_000);
  const max = Number(options.max || process.env.PUBLIC_RATE_LIMIT_MAX || 40);
  const prefix = options.prefix || 'public';

  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${clientKey(req)}`;
    const current = buckets.get(key);

    if (!current || current.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      return res.status(429).json({
        ok: false,
        message: 'Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.',
      });
    }

    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets.entries()) {
    if (value.expiresAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

module.exports = rateLimitPublico;
