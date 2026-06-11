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

function isRetryableMysqlError(err) {
  return !!err && (RETRYABLE.has(err.code) || err.fatal === true);
}

async function queryWithRetry(sql, params = [], options = {}) {
  const retries = Number(options.retries ?? process.env.MYSQL_QUERY_RETRIES ?? 2);
  const label = options.label || 'mysql.query';
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      lastErr = err;
      if (!isRetryableMysqlError(err) || attempt >= retries) throw err;
      const delay = 120 * (attempt + 1);
      console.warn(`[MYSQL-RETRY] ${label} falhou (${err.code || err.message}). Tentando novamente em ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

async function executeWithRetry(sql, params = [], options = {}) {
  const retries = Number(options.retries ?? process.env.MYSQL_QUERY_RETRIES ?? 2);
  const label = options.label || 'mysql.execute';
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await pool.execute(sql, params);
    } catch (err) {
      lastErr = err;
      if (!isRetryableMysqlError(err) || attempt >= retries) throw err;
      const delay = 120 * (attempt + 1);
      console.warn(`[MYSQL-RETRY] ${label} falhou (${err.code || err.message}). Tentando novamente em ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

module.exports = { queryWithRetry, executeWithRetry, isRetryableMysqlError };
