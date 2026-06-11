-- Movyo SaaS: planos oficiais e assinatura do restaurante
ALTER TABLE restaurantes ADD COLUMN plano VARCHAR(255) NULL;
ALTER TABLE restaurantes ADD COLUMN statusAssinatura VARCHAR(255) NULL;
ALTER TABLE restaurantes ADD COLUMN dataInicioPlano DATETIME NULL;
ALTER TABLE restaurantes ADD COLUMN dataFimPlano DATETIME NULL;
ALTER TABLE restaurantes ADD COLUMN observacaoPlano LONGTEXT NULL;

UPDATE restaurantes SET plano = 'free' WHERE plano IS NULL OR TRIM(plano) = '';
UPDATE restaurantes SET statusAssinatura = 'ativo' WHERE statusAssinatura IS NULL OR TRIM(statusAssinatura) = '';

CREATE TABLE IF NOT EXISTS planos_saas (
  id VARCHAR(24) NOT NULL PRIMARY KEY,
  codigo VARCHAR(255) NULL,
  nome VARCHAR(255) NULL,
  valorMensal DECIMAL(10,2) NULL,
  descricao LONGTEXT NULL,
  recursos LONGTEXT NULL,
  ativo TINYINT(1) NULL,
  ordem INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX idx_planos_saas_codigo ON planos_saas (codigo(191));
