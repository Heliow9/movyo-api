const crypto = require("crypto");

function parseXSignature(xSignature = "") {
  const parts = String(xSignature).split(",");
  let ts = "";
  let v1 = "";
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    if (k.trim() === "ts") ts = v.trim();
    if (k.trim() === "v1") v1 = v.trim();
  }
  return { ts, v1 };
}

function verifyMpWebhookSignature({ xSignature, xRequestId, dataId, secret, maxSkewMs = 5 * 60 * 1000 }) {
  if (!secret) return false;
  if (!xSignature || !xRequestId || !dataId) return false;

  const { ts, v1 } = parseXSignature(xSignature);
  if (!ts || !v1) return false;

  // anti-replay
  const drift = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(drift) || drift > maxSkewMs) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const expected = crypto
    .createHmac("sha256", String(secret))
    .update(manifest)
    .digest("hex");

  // comparação segura
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(v1).toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyMpWebhookSignature };
