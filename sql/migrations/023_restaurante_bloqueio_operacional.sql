-- Separa o bloqueio operacional/manual do bloqueio financeiro gerido pelo Ponto Certo.
-- Idempotente: pode ser executada mais de uma vez sem apagar dados.
SET @sql=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='restaurantes' AND COLUMN_NAME='bloqueado')=0,
  "ALTER TABLE restaurantes ADD COLUMN bloqueado TINYINT(1) NULL DEFAULT 0",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE restaurantes SET bloqueado=COALESCE(bloqueado,0);
