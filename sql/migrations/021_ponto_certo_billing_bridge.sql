-- Movyo V4: espelho de assinatura gerida pelo Ponto Certo.
-- Não altera tabelas de pagamentos/pedidos dos consumidores.
SET NAMES utf8mb4;

SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingSource')=0,"ALTER TABLE restaurantes ADD COLUMN billingSource VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='pontoCertoCustomerId')=0,"ALTER TABLE restaurantes ADD COLUMN pontoCertoCustomerId VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='pontoCertoSubscriptionId')=0,"ALTER TABLE restaurantes ADD COLUMN pontoCertoSubscriptionId VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingStatus')=0,"ALTER TABLE restaurantes ADD COLUMN billingStatus VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingChargeStatus')=0,"ALTER TABLE restaurantes ADD COLUMN billingChargeStatus VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingAccessBlocked')=0,"ALTER TABLE restaurantes ADD COLUMN billingAccessBlocked TINYINT(1) NULL DEFAULT 0",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingCurrentPeriodEnd')=0,"ALTER TABLE restaurantes ADD COLUMN billingCurrentPeriodEnd DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingGraceUntil')=0,"ALTER TABLE restaurantes ADD COLUMN billingGraceUntil DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingLastSyncAt')=0,"ALTER TABLE restaurantes ADD COLUMN billingLastSyncAt DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingProvider')=0,"ALTER TABLE restaurantes ADD COLUMN billingProvider VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingChargeId')=0,"ALTER TABLE restaurantes ADD COLUMN billingChargeId VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingDueDate')=0,"ALTER TABLE restaurantes ADD COLUMN billingDueDate DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingAmount')=0,"ALTER TABLE restaurantes ADD COLUMN billingAmount DECIMAL(12,2) NULL DEFAULT 0",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPaymentMethod')=0,"ALTER TABLE restaurantes ADD COLUMN billingPaymentMethod VARCHAR(255) NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPaymentUrl')=0,"ALTER TABLE restaurantes ADD COLUMN billingPaymentUrl TEXT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPdfUrl')=0,"ALTER TABLE restaurantes ADD COLUMN billingPdfUrl TEXT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingDigitableLine')=0,"ALTER TABLE restaurantes ADD COLUMN billingDigitableLine TEXT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPixCopyPaste')=0,"ALTER TABLE restaurantes ADD COLUMN billingPixCopyPaste TEXT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPixQrCode')=0,"ALTER TABLE restaurantes ADD COLUMN billingPixQrCode TEXT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE restaurantes SET billingSource=COALESCE(NULLIF(billingSource,''),'MOVYO_LEGACY'),billingStatus=COALESCE(NULLIF(billingStatus,''),'ACTIVE'),billingAccessBlocked=COALESCE(billingAccessBlocked,0);

CREATE TABLE IF NOT EXISTS ponto_certo_integration_requests (
 id VARCHAR(24) NOT NULL PRIMARY KEY,
 idempotencyKey VARCHAR(255) NULL,
 nonce VARCHAR(255) NOT NULL,
 method VARCHAR(255) NOT NULL,
 path TEXT NOT NULL,
 requestHash VARCHAR(255) NOT NULL,
 responseStatus DOUBLE NULL,
 responseJson TEXT NULL,
 completedAt DATETIME NULL,
 created_at DATETIME NULL,
 updated_at DATETIME NULL,
 UNIQUE KEY uq_pc_integration_idempotency(idempotencyKey(191)),
 UNIQUE KEY uq_pc_integration_nonce(nonce(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
