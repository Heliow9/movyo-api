ALTER TABLE restaurantes ADD COLUMN taxaConvenienciaPix DECIMAL(12,2) NULL;
ALTER TABLE restaurantes ADD COLUMN descontoMensalidadePercentual DECIMAL(12,2) NULL;
ALTER TABLE restaurantes ADD COLUMN valorMensalidadeCustomizado DECIMAL(12,2) NULL;

CREATE TABLE IF NOT EXISTS cobrancas_saas (
  id VARCHAR(24) NOT NULL PRIMARY KEY,
  restauranteId VARCHAR(24) NULL,
  planoCodigo VARCHAR(255) NULL,
  referencia VARCHAR(255) NULL,
  vencimento DATETIME NULL,
  valorPlano DECIMAL(12,2) NULL,
  descontoPercentual DECIMAL(12,2) NULL,
  descontoValor DECIMAL(12,2) NULL,
  valorFinal DECIMAL(12,2) NULL,
  status VARCHAR(255) NULL,
  mpPaymentId VARCHAR(255) NULL,
  qrCode TEXT NULL,
  qrCodeBase64 TEXT NULL,
  pixCopiaECola TEXT NULL,
  pagoEm DATETIME NULL,
  geradoEm DATETIME NULL,
  metadata LONGTEXT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cobrancas_saas_restaurante ON cobrancas_saas (restauranteId);
CREATE INDEX idx_cobrancas_saas_payment ON cobrancas_saas (mpPaymentId(191));
CREATE INDEX idx_cobrancas_saas_status ON cobrancas_saas (status(32));
