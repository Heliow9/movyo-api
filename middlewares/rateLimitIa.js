const buckets = new Map();

function rateLimitIa(req, res, next) {
  const minuteMax = Math.max(1, Number(process.env.GROQ_REQUESTS_PER_MINUTE || 20));
  const dayMax = Math.max(minuteMax, Number(process.env.GROQ_REQUESTS_PER_DAY || 300));
  const restauranteId = String(req.restauranteId || "unknown");
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const minuteKey = `m:${restauranteId}`;
  const dayKey = `d:${restauranteId}:${day}`;
  const minute = buckets.get(minuteKey);
  const daily = buckets.get(dayKey);

  if (!minute || minute.expiresAt <= now) buckets.set(minuteKey, { count: 1, expiresAt: now + 60_000 });
  else if (++minute.count > minuteMax) return res.status(429).json({ message: "Muitas solicitações de IA. Aguarde um minuto." });

  if (!daily || daily.expiresAt <= now) buckets.set(dayKey, { count: 1, expiresAt: now + 86_400_000 });
  else if (++daily.count > dayMax) return res.status(429).json({ message: "O limite diário de IA deste restaurante foi atingido." });

  res.setHeader("X-Movyo-AI-Daily-Limit", String(dayMax));
  res.setHeader("X-Movyo-AI-Daily-Remaining", String(Math.max(0, dayMax - (buckets.get(dayKey)?.count || 0))));
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.expiresAt <= now) buckets.delete(key);
}, 60_000).unref?.();

module.exports = rateLimitIa;
