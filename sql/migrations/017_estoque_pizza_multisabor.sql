ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS receita VARCHAR(24) NULL,
  ADD COLUMN IF NOT EXISTS estoquePizza LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS estoqueOpcionais LONGTEXT NULL;

ALTER TABLE movimentos_estoque
  ADD COLUMN IF NOT EXISTS detalhes LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS criadoPor VARCHAR(24) NULL;

CREATE INDEX idx_produtos_receita ON produtos (receita);
CREATE INDEX idx_movimentos_referencia ON movimentos_estoque (restauranteId, referenciaId);
CREATE UNIQUE INDEX uq_movimentos_pedido_insumo_tipo
  ON movimentos_estoque (restauranteId, referenciaId, insumoId, tipo(32));
