const mysql = require('mysql2/promise');

const config = {
  host: process.env.MYSQL_HOST || 'movyo.mysql.uhserver.com',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'movyo_admin',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'movyo',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 25),
  maxIdle: Number(process.env.MYSQL_MAX_IDLE || 10),
  idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT || 60000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  queueLimit: 0,
  charset: 'utf8mb4',
  // Os DATETIME da Movyo são gravados como horário operacional do Brasil.
  // Sem timezone explícito, servidores Linux em UTC interpretam 19:13 como 19:13Z,
  // acrescentando 3 horas aos cronômetros exibidos no Desktop/Hub.
  timezone: process.env.MYSQL_TIMEZONE || '-03:00',
};

const pool = mysql.createPool(config);

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    console.log('🟢 MySQL conectado.');
  } finally {
    conn.release();
  }
}

module.exports = { pool, testConnection, config };
