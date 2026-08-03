const { pool } = require('../db/mysql');

const RETRYABLE = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'EPIPE',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queryLabel(sql, configuredLabel) {
  if (configuredLabel) return configuredLabel;
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|SHOW)\b.*?\b(?:FROM|INTO|UPDATE|TABLE)\s+`?([a-zA-Z0-9_]+)/i);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : normalized.split(' ').slice(0, 3).join(' ');
}

function reportSlowQuery(sql, configuredLabel, startedAt) {
  const ms = Date.now() - startedAt;
  const threshold = Math.max(1, Number(process.env.MYSQL_SLOW_QUERY_MS || 750));
  if (ms >= threshold) console.warn(`[MYSQL-SLOW] ${queryLabel(sql, configuredLabel)} em ${ms}ms`);
}

function isRetryableMysqlError(err) {
  return !!err && (RETRYABLE.has(err.code) || err.fatal === true);
}

async function queryWithRetry(sql, params = [], options = {}) {
  const retries = Number(options.retries ?? process.env.MYSQL_QUERY_RETRIES ?? 2);
  const label = options.label || null;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const startedAt = Date.now();
      const result = await pool.query(sql, params);
      reportSlowQuery(sql, label, startedAt);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryableMysqlError(err) || attempt >= retries) throw err;
      const delay = 120 * (attempt + 1);
      console.warn(`[MYSQL-RETRY] ${queryLabel(sql, label)} falhou (${err.code || err.message}). Tentando novamente em ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

async function executeWithRetry(sql, params = [], options = {}) {
  const retries = Number(options.retries ?? process.env.MYSQL_QUERY_RETRIES ?? 2);
  const label = options.label || null;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const startedAt = Date.now();
      const result = await pool.execute(sql, params);
      reportSlowQuery(sql, label, startedAt);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryableMysqlError(err) || attempt >= retries) throw err;
      const delay = 120 * (attempt + 1);
      console.warn(`[MYSQL-RETRY] ${queryLabel(sql, label)} falhou (${err.code || err.message}). Tentando novamente em ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

module.exports = { queryWithRetry, executeWithRetry, isRetryableMysqlError };
