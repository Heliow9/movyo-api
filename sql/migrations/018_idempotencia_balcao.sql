-- Idempotência persistente para abertura e pagamento de pedidos de balcão.
-- Aplicar uma vez antes de publicar a versão correspondente do Movyo Hub.

ALTER TABLE pedidos
  ADD COLUMN clientRequestId VARCHAR(120) NULL;

CREATE UNIQUE INDEX uq_pedidos_rest_client_request
  ON pedidos (restaurante, clientRequestId);

CREATE UNIQUE INDEX uq_caixa_movimentos_referencia
  ON caixa_movimentos (referenciaPagamento(191));
