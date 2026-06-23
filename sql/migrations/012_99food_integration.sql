-- Integração 99Food / Open Delivery
-- Rode no MySQL de produção antes ou junto do deploy da API.

ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS food99Status TINYINT(1) NULL,
  ADD COLUMN IF NOT EXISTS food99MerchantId VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS food99WebhookToken TEXT NULL,
  ADD COLUMN IF NOT EXISTS food99ClientId TEXT NULL,
  ADD COLUMN IF NOT EXISTS food99ClientSecret TEXT NULL,
  ADD COLUMN IF NOT EXISTS food99BaseUrl TEXT NULL,
  ADD COLUMN IF NOT EXISTS food99 LONGTEXT NULL;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS canalVenda VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS marketplace VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS externalOrderId VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS externalMerchantId VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS externalStatus VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS externalPayload LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS taxaMarketplace DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS valorRepasse DECIMAL(12,2) NULL;

CREATE INDEX idx_pedidos_external_order ON pedidos (externalOrderId(191));
CREATE INDEX idx_pedidos_rest_origem_caixa ON pedidos (restaurante, origem(32), caixaSessaoId);
