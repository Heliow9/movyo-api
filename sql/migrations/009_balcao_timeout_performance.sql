-- Performance para lançamento de pedidos balcão/garçom
-- Rode uma vez no MySQL de produção.

CREATE INDEX idx_pedidos_restaurante_numero_created
ON pedidos (restaurante, numeroPedido, createdAt);

CREATE INDEX idx_caixa_sessao_restaurante_status_aberto
ON caixa_sessaos (restauranteId, status, abertoEm);

CREATE INDEX idx_caixa_movimentos_caixa_sessao
ON caixa_movimentos (caixaSessaoId);
