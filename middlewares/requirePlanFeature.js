const {
  planHasFeature,
  getFeatureDefinition,
  getPlanSummary,
  getPlanLimit,
} = require("../utils/planRules");

function deny(res, req, featureKey, extra = {}) {
  const feature = getFeatureDefinition(featureKey) || {};
  const planInfo = getPlanSummary(req.restaurante || { plano: req.plano });
  return res.status(403).json({
    code: "PLANO_RECURSO_INDISPONIVEL",
    mensagem: `${feature.label || "Este recurso"} nao esta disponivel no plano atual.`,
    recurso: featureKey,
    recursoNome: feature.label || featureKey,
    planoAtual: planInfo.codigo,
    planoEfetivo: planInfo.efetivoCodigo,
    planoNecessario: feature.minPlan || null,
    planoInfo: planInfo,
    ...extra,
  });
}

function requirePlanFeature(featureKey) {
  return function planFeatureMiddleware(req, res, next) {
    if (planHasFeature(req.restaurante || { plano: req.plano }, featureKey)) return next();
    return deny(res, req, featureKey);
  };
}

function countActiveGarcons(restaurante) {
  const garcons = Array.isArray(restaurante?.garcons) ? restaurante.garcons : [];
  return garcons.filter((garcom) => garcom?.ativo !== false).length;
}

function requireGarcomSlot(req, res, next) {
  const limit = getPlanLimit(req.restaurante || { plano: req.plano }, "garcons");
  if (limit == null) return next();

  const current = countActiveGarcons(req.restaurante);
  if (current < Number(limit)) return next();

  const planInfo = getPlanSummary(req.restaurante || { plano: req.plano });
  return res.status(403).json({
    code: "PLANO_LIMITE_GARCONS",
    mensagem: `O plano atual permite ate ${limit} usuario(s) garcom. Faça upgrade para liberar mais usuarios.`,
    recurso: "garcons",
    limite: limit,
    atual: current,
    planoAtual: planInfo.codigo,
    planoEfetivo: planInfo.efetivoCodigo,
    planoNecessario: "essencial",
    planoInfo: planInfo,
  });
}

module.exports = {
  requirePlanFeature,
  requireGarcomSlot,
};
