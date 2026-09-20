-- Movyo V4.1: espelho dos metadados de pró-rata enviados pelo Ponto Certo.
-- Não altera pagamentos de pedidos dos consumidores.
SET NAMES utf8mb4;

SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingIsProrata')=0,"ALTER TABLE restaurantes ADD COLUMN billingIsProrata TINYINT(1) NULL DEFAULT 0",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingProrataDays')=0,"ALTER TABLE restaurantes ADD COLUMN billingProrataDays INT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingProrataCycleDays')=0,"ALTER TABLE restaurantes ADD COLUMN billingProrataCycleDays INT NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPeriodStart')=0,"ALTER TABLE restaurantes ADD COLUMN billingPeriodStart DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingPeriodEnd')=0,"ALTER TABLE restaurantes ADD COLUMN billingPeriodEnd DATETIME NULL",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='billingBaseAmount')=0,"ALTER TABLE restaurantes ADD COLUMN billingBaseAmount DECIMAL(12,2) NULL DEFAULT 0",'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
