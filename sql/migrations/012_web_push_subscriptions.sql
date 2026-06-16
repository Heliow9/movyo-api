CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restauranteId` VARCHAR(24) NULL,
  `usuarioId` VARCHAR(255) NULL,
  `role` VARCHAR(255) NULL,
  `endpoint` TEXT NULL,
  `endpointHash` VARCHAR(255) NULL,
  `p256dh` TEXT NULL,
  `auth` TEXT NULL,
  `expirationTime` DATETIME NULL,
  `plataforma` VARCHAR(255) NULL,
  `standalone` TINYINT(1) NULL,
  `userAgent` TEXT NULL,
  `ativo` TINYINT(1) NULL,
  `ultimaSincronizacaoEm` DATETIME NULL,
  `ultimoSucessoEm` DATETIME NULL,
  `ultimaFalhaEm` DATETIME NULL,
  `falhasConsecutivas` DOUBLE NULL,
  `ultimoErro` TEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `idx_push_endpoint_hash` ON `push_subscriptions` (`endpointHash`(64));
CREATE INDEX `idx_push_restaurante_ativo` ON `push_subscriptions` (`restauranteId`, `ativo`);
