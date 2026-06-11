-- Índices complementares para acelerar /api/saas/operacao no dashboard SaaS.
-- Execute uma vez no MySQL. Se algum índice já existir, o MySQL pode retornar erro de duplicidade;
-- nesse caso, ignore o índice duplicado e siga para os demais.

CREATE INDEX idx_pedidos_criado_status ON pedidos (criadoEm, status(191), statusPagamento(191));
CREATE INDEX idx_pedidos_restaurante_criado_operacao ON pedidos (restaurante, criadoEm, status(191), statusPagamento(191));
CREATE INDEX idx_caixa_sessoes_restaurante_status ON caixa_sessoes (restauranteId, status(191));
CREATE INDEX idx_mesas_restaurante_status ON mesas (restauranteId, status(191));
CREATE INDEX idx_operadores_caixa_restaurante_ativo ON operadores_caixa (restauranteId, ativo);
CREATE INDEX idx_entregadores_restaurante_status ON entregadores (restaurante, status, statusConta(191));
CREATE INDEX idx_caixa_movimentos_data_tipo ON caixa_movimentos (data, tipo(191));
CREATE INDEX idx_caixa_movimentos_restaurante_data_tipo ON caixa_movimentos (restauranteId, data, tipo(191));
