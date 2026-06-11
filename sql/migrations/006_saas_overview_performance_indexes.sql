-- Índices para acelerar /api/saas/overview e filtros por restaurante/data.
-- Execute uma vez no banco de produção/homologação.

CREATE INDEX idx_restaurantes_plano ON restaurantes (plano(191));
CREATE INDEX idx_restaurantes_status_assinatura ON restaurantes (statusAssinatura(191));
CREATE INDEX idx_restaurantes_data_fim_plano ON restaurantes (dataFimPlano);
CREATE INDEX idx_restaurantes_ativo_status ON restaurantes (ativo, statusAssinatura(191));

CREATE INDEX idx_pedidos_restaurante_criado_em ON pedidos (restaurante, criadoEm);
CREATE INDEX idx_pedidos_restaurante_pago_em ON pedidos (restaurante, pagoEm);
CREATE INDEX idx_pedidos_criado_em ON pedidos (criadoEm);
CREATE INDEX idx_pedidos_pago_em ON pedidos (pagoEm);

CREATE INDEX idx_caixa_sessoes_restaurante_status_aberto ON caixa_sessoes (restauranteId, status(191), abertoEm);
CREATE INDEX idx_mesas_restaurante_status ON mesas (restauranteId, status(191));
CREATE INDEX idx_operadores_restaurante_ativo ON operadores_caixa (restauranteId, ativo);
CREATE INDEX idx_entregadores_restaurante_status ON entregadores (restaurante, status, statusConta(191));
