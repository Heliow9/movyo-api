-- Índices complementares para acelerar Restaurante > Ver no dashboard SaaS.
-- Execute uma vez caso ainda não existam no banco.

CREATE INDEX idx_pedidos_restaurante_criado_status ON pedidos (restaurante, criadoEm, status(191), statusPagamento(191));
CREATE INDEX idx_caixa_movimentos_restaurante_data ON caixa_movimentos (restauranteId, data);
CREATE INDEX idx_pedidos_mesa_restaurante_status ON pedidos_mesa (restauranteId, status(191));
CREATE INDEX idx_categorias_produto_restaurante ON categorias_produto (restaurante);
