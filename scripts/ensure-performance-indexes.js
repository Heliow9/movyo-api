require('dotenv').config();

const { pool, testConnection } = require('../db/mysql');

const indexes = [
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_criado_id',
    sql: 'CREATE INDEX idx_pedidos_rest_criado_id ON pedidos (restaurante, criadoEm, id)',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_status_criado_id',
    sql: 'CREATE INDEX idx_pedidos_rest_status_criado_id ON pedidos (restaurante, status(30), criadoEm, id)',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_origem_criado_id',
    sql: 'CREATE INDEX idx_pedidos_rest_origem_criado_id ON pedidos (restaurante, origem(30), criadoEm, id)',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_caixa_criado',
    sql: 'CREATE INDEX idx_pedidos_rest_caixa_criado ON pedidos (restaurante, caixaSessaoId, criadoEm)',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_status_pagamento_criado',
    sql: 'CREATE INDEX idx_pedidos_rest_status_pagamento_criado ON pedidos (restaurante, status(30), statusPagamento(30), criadoEm)',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_external_order',
    sql: 'CREATE INDEX idx_pedidos_external_order ON pedidos (externalOrderId(191))',
  },
  {
    table: 'pedidos',
    name: 'idx_pedidos_rest_origem_caixa',
    sql: 'CREATE INDEX idx_pedidos_rest_origem_caixa ON pedidos (restaurante, origem(32), caixaSessaoId)',
  },
  {
    table: 'caixa_sessoes',
    name: 'idx_caixa_sessoes_rest_status_aberto',
    sql: 'CREATE INDEX idx_caixa_sessoes_rest_status_aberto ON caixa_sessoes (restauranteId, status(30), abertoEm)',
  },
  {
    table: 'caixa_movimentos',
    name: 'idx_caixa_movimentos_restaurante_data_tipo',
    sql: 'CREATE INDEX idx_caixa_movimentos_restaurante_data_tipo ON caixa_movimentos (restauranteId, data, tipo(30))',
  },
  {
    table: 'caixa_movimentos',
    name: 'idx_caixa_movimentos_data_tipo',
    sql: 'CREATE INDEX idx_caixa_movimentos_data_tipo ON caixa_movimentos (data, tipo(30))',
  },
  {
    table: 'caixa_movimentos',
    name: 'idx_caixa_movimentos_sessao_tipo_forma',
    sql: 'CREATE INDEX idx_caixa_movimentos_sessao_tipo_forma ON caixa_movimentos (caixaSessaoId, tipo(30), formaPagamento(30))',
  },
  {
    table: 'mesas',
    name: 'idx_mesas_rest_status_numero',
    sql: 'CREATE INDEX idx_mesas_rest_status_numero ON mesas (restauranteId, status(30), numero(30))',
  },
  {
    table: 'operadores_caixa',
    name: 'idx_operadores_caixa_restaurante_ativo',
    sql: 'CREATE INDEX idx_operadores_caixa_restaurante_ativo ON operadores_caixa (restauranteId, ativo)',
  },
  {
    table: 'entregadores',
    name: 'idx_entregadores_restaurante_status',
    sql: 'CREATE INDEX idx_entregadores_restaurante_status ON entregadores (restaurante, status, statusConta(30))',
  },
  {
    table: 'pedidos_mesa',
    name: 'idx_pedidos_mesa_restaurante_status',
    sql: 'CREATE INDEX idx_pedidos_mesa_restaurante_status ON pedidos_mesa (restauranteId, status(30))',
  },
  {
    table: 'produtos',
    name: 'idx_produtos_rest_ordem_nome',
    sql: 'CREATE INDEX idx_produtos_rest_ordem_nome ON produtos (restaurante, ordem, nome(80))',
  },
  {
    table: 'categorias_produto',
    name: 'idx_categorias_rest_ordem_nome',
    sql: 'CREATE INDEX idx_categorias_rest_ordem_nome ON categorias_produto (restaurante, ordem, nome(80))',
  },
];

async function indexExists(table, name) {
  const [rows] = await pool.query(
    `
      SELECT 1
        FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND index_name = ?
       LIMIT 1
    `,
    [table, name]
  );
  return rows.length > 0;
}

async function ensureIndex(definition) {
  if (await indexExists(definition.table, definition.name)) {
    console.log(`skip ${definition.table}.${definition.name}`);
    return;
  }

  await pool.query(definition.sql);
  console.log(`created ${definition.table}.${definition.name}`);
}

(async () => {
  await testConnection();

  for (const definition of indexes) {
    await ensureIndex(definition);
  }

  console.log('Performance indexes checked.');
  await pool.end();
})().catch(async (error) => {
  console.error('Failed to ensure performance indexes:', error);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
