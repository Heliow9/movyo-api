ALTER TABLE restaurantes
  ADD COLUMN cancelamentoPlanoEm DATETIME NULL,
  ADD COLUMN cancelamentoPlanoMotivo LONGTEXT NULL,
  ADD COLUMN cancelamentoPlanoEstornoStatus VARCHAR(255) NULL,
  ADD COLUMN cancelamentoPlanoEstornoValor DECIMAL(12,2) NULL,
  ADD COLUMN cancelamentoPlanoDetalhes LONGTEXT NULL;

ALTER TABLE cobrancas_saas
  ADD COLUMN estornoStatus VARCHAR(255) NULL,
  ADD COLUMN estornoValor DECIMAL(12,2) NULL,
  ADD COLUMN estornoEm DATETIME NULL,
  ADD COLUMN estornoErro LONGTEXT NULL,
  ADD COLUMN estornoDetalhes LONGTEXT NULL;
