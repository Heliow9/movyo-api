-- Movyo SaaS: controle de assinatura, expiração automática e invalidação de sessão
ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS sessaoVersao DECIMAL(18,6) NULL;

UPDATE restaurantes
SET plano = 'free'
WHERE plano IS NULL OR TRIM(plano) = '';

UPDATE restaurantes
SET sessaoVersao = 1
WHERE sessaoVersao IS NULL OR sessaoVersao = 0;

UPDATE restaurantes
SET ativo = 0,
    statusAssinatura = 'bloqueado',
    sessaoVersao = COALESCE(sessaoVersao, 1) + 1
WHERE dataFimPlano IS NOT NULL
  AND DATE(dataFimPlano) < CURDATE()
  AND COALESCE(statusAssinatura, '') NOT IN ('bloqueado', 'cancelado');
