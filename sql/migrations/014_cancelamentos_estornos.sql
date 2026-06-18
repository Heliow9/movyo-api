ALTER TABLE restaurantes
  ADD COLUMN tempoAutoCancelamentoVitrineMin INT DEFAULT 6;

ALTER TABLE pedidos
  ADD COLUMN motivoCancelamento TEXT NULL,
  ADD COLUMN canceladoPor VARCHAR(191) NULL,
  ADD COLUMN canceladoPorRole VARCHAR(64) NULL,
  ADD COLUMN cancelamentoTipo VARCHAR(64) NULL,
  ADD COLUMN valorCancelado DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN itensCancelados LONGTEXT NULL,
  ADD COLUMN pedidoOriginalSnapshot LONGTEXT NULL,
  ADD COLUMN estornoStatus VARCHAR(64) NULL,
  ADD COLUMN estornoValor DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN estornoEm DATETIME NULL,
  ADD COLUMN estornoErro TEXT NULL,
  ADD COLUMN estornoDetalhes LONGTEXT NULL;
