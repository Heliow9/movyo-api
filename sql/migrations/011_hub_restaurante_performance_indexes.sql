-- MOVYO - Migration 011
-- Performance Hub Restaurante / Caixa / Produtos / Categorias / Pedidos
-- Execute somente se os índices ainda não existirem.

CREATE INDEX idx_produtos_rest_ordem_nome
ON produtos (restaurante, ordem, nome(80));

CREATE INDEX idx_categorias_rest_ordem_nome
ON categorias_produto (restaurante, ordem, nome(80));

CREATE INDEX idx_pedidos_rest_criado_status_origem
ON pedidos (restaurante, criadoEm, status(30), origem(30));

CREATE INDEX idx_pedidos_rest_caixa_criado
ON pedidos (restaurante, caixaSessaoId, criadoEm);

CREATE INDEX idx_caixa_sessoes_rest_status_aberto
ON caixa_sessoes (restauranteId, status(30), abertoEm);

CREATE INDEX idx_caixa_movimentos_sessao_tipo_forma
ON caixa_movimentos (caixaSessaoId, tipo(30), formaPagamento(30));
