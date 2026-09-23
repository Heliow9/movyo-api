function text(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function boolTrue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['true', '1', 'sim', 'yes'].includes(text(value));
  return false;
}

function endOfLocalDay(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBillingManagedByPontoCerto(restaurante = {}) {
  return String(restaurante?.billingSource || '').trim().toUpperCase() === 'PONTO_CERTO';
}

function isPontoCertoFinanciallyBlocked(restaurante = {}) {
  if (!isBillingManagedByPontoCerto(restaurante)) return false;
  const status = String(restaurante?.billingStatus || '').trim().toUpperCase();
  return boolTrue(restaurante?.billingAccessBlocked) || status === 'BLOCKED' || status === 'CANCELED';
}

function isLegacyLicenseExpired(restaurante = {}, now = new Date()) {
  if (isBillingManagedByPontoCerto(restaurante)) return false;
  const end = endOfLocalDay(restaurante?.dataFimPlano);
  return Boolean(end && end.getTime() < now.getTime());
}

function isStaleLegacyFinancialBlock(restaurante = {}) {
  // Antes da integração com o Ponto Certo, a rotina automática da Movyo gravava
  // ativo=0 + statusAssinatura=bloqueado ao vencer dataFimPlano. Quando a cobrança
  // passou a ser gerida pelo Ponto Certo, esse par antigo não pode sobrepor GRACE/ACTIVE.
  return isBillingManagedByPontoCerto(restaurante)
    && restaurante?.bloqueado !== true
    && restaurante?.ativo === false
    && text(restaurante?.statusAssinatura) === 'bloqueado';
}

function isOperationallyBlocked(restaurante = {}) {
  if (restaurante?.bloqueado === true) return true;
  if (isStaleLegacyFinancialBlock(restaurante)) return false;
  if (restaurante?.ativo === false) return true;
  if (!isBillingManagedByPontoCerto(restaurante) && text(restaurante?.statusAssinatura) === 'bloqueado') return true;
  return false;
}

function getRestaurantAccessDecision(restaurante = {}, now = new Date()) {
  if (isPontoCertoFinanciallyBlocked(restaurante)) {
    return {
      blocked: true,
      code: 'LICENCA_FINANCEIRA_BLOQUEADA',
      message: 'Assinatura com acesso financeiro bloqueado. Regularize a cobrança para continuar usando o Movyo.',
      reason: 'FINANCIAL',
    };
  }
  if (isLegacyLicenseExpired(restaurante, now)) {
    return {
      blocked: true,
      code: 'LICENCA_VENCIDA',
      message: 'Licença vencida. Regularize o plano para continuar usando o Movyo.',
      reason: 'LEGACY_EXPIRED',
    };
  }
  if (isOperationallyBlocked(restaurante)) {
    return {
      blocked: true,
      code: 'RESTAURANTE_BLOQUEADO',
      message: 'Restaurante bloqueado/desativado. Fale com o suporte Movyo.',
      reason: 'OPERATIONAL',
    };
  }
  return { blocked: false, code: null, message: null, reason: null };
}

module.exports = {
  getRestaurantAccessDecision,
  isBillingManagedByPontoCerto,
  isLegacyLicenseExpired,
  isOperationallyBlocked,
  isPontoCertoFinanciallyBlocked,
  isStaleLegacyFinancialBlock,
};
