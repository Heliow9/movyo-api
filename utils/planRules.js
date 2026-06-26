const PLAN_CODES = {
  FREE: "free",
  START: "starter-mobile",
  ESSENTIAL: "essencial",
  PROFESSIONAL: "professional",
  PREMIUM: "premium",
  FULL: "full",
};

const PLAN_ALIASES = {
  free: PLAN_CODES.FREE,
  trial: PLAN_CODES.FREE,
  teste: PLAN_CODES.FREE,
  start: PLAN_CODES.START,
  starter: PLAN_CODES.START,
  "start-mobile": PLAN_CODES.START,
  "starter-mobile": PLAN_CODES.START,
  mobile: PLAN_CODES.START,
  essencial: PLAN_CODES.ESSENTIAL,
  essential: PLAN_CODES.ESSENTIAL,
  profissional: PLAN_CODES.PROFESSIONAL,
  professional: PLAN_CODES.PROFESSIONAL,
  pro: PLAN_CODES.PROFESSIONAL,
  premium: PLAN_CODES.PREMIUM,
  full: PLAN_CODES.FULL,
  admin: PLAN_CODES.FULL,
};

const PLAN_RANK = {
  [PLAN_CODES.FREE]: 0,
  [PLAN_CODES.START]: 1,
  [PLAN_CODES.ESSENTIAL]: 2,
  [PLAN_CODES.PROFESSIONAL]: 3,
  [PLAN_CODES.PREMIUM]: 4,
  [PLAN_CODES.FULL]: 99,
};

const PLAN_LIMITS = {
  [PLAN_CODES.FREE]: { garcons: 1 },
  [PLAN_CODES.START]: { garcons: 1 },
  [PLAN_CODES.ESSENTIAL]: { garcons: 3 },
  [PLAN_CODES.PROFESSIONAL]: { garcons: 8 },
  [PLAN_CODES.PREMIUM]: { garcons: null },
  [PLAN_CODES.FULL]: { garcons: null },
};

const PLAN_CATALOG = [
  {
    codigo: PLAN_CODES.FREE,
    nome: "Teste gratis",
    valorMensal: 0,
    valorAnualMensal: 0,
    ordem: 1,
    descricao: "7 dias gratis com recursos do plano Profissional liberados temporariamente.",
    recursos: [
      "Teste por 7 dias",
      "Recursos do Profissional durante o teste",
      "Sem taxa de implantacao",
    ],
  },
  {
    codigo: PLAN_CODES.START,
    nome: "Start Mobile",
    valorMensal: 69.9,
    valorAnualMensal: 59.9,
    ordem: 2,
    descricao: "Operacao essencial pelo Movyo Hub para mesas, balcao e caixa.",
    recursos: [
      "App Movyo Hub",
      "Gestao de mesas e comandas",
      "Pedidos no balcao",
      "Frente de caixa",
      "Abertura e fechamento de caixa",
      "1 usuario garcom",
      "Visao basica das vendas",
    ],
  },
  {
    codigo: PLAN_CODES.ESSENTIAL,
    nome: "Essencial",
    valorMensal: 129.9,
    valorAnualMensal: 109.9,
    ordem: 3,
    descricao: "Tudo do Start Mobile com cardapio digital, delivery, desktop, pagamentos e relatorios de vendas.",
    recursos: [
      "Tudo do Start Mobile",
      "Cardapio digital personalizado",
      "Vitrine propria sem comissao",
      "Delivery, balcao e mesas",
      "Movyo Desktop",
      "PIX e cartao no cardapio",
      "Impressao automatica",
      "Relatorios de vendas",
    ],
  },
  {
    codigo: PLAN_CODES.PROFESSIONAL,
    nome: "Profissional",
    valorMensal: 179.9,
    valorAnualMensal: 149.9,
    ordem: 4,
    descricao: "Automacao comercial, WhatsApp, estoque, receitas, producao e relatorios avancados.",
    recursos: [
      "Tudo do Essencial",
      "Robo no WhatsApp",
      "Recuperador de vendas",
      "Programa de fidelidade",
      "Controle de estoque",
      "Receitas e baixa automatica",
      "Tela de producao",
      "Relatorios avancados",
    ],
  },
  {
    codigo: PLAN_CODES.PREMIUM,
    nome: "Premium",
    valorMensal: 229.9,
    valorAnualMensal: 194.9,
    ordem: 5,
    descricao: "Suite completa com motoristas, entregas, indicadores em tempo real, auditoria e prioridade.",
    recursos: [
      "Tudo do Profissional",
      "App motorista/entregador",
      "Gestao completa das entregas",
      "Indicadores em tempo real",
      "Auditoria de operadores",
      "Relatorios gerenciais completos",
      "Usuarios ilimitados",
      "Atendimento prioritario",
    ],
  },
  {
    codigo: PLAN_CODES.FULL,
    nome: "Full SaaS Admin",
    valorMensal: 0,
    valorAnualMensal: 0,
    ordem: 6,
    descricao: "Plano interno administrativo sem limitacoes.",
    recursos: ["Sem limites", "Administracao SaaS", "Homologacao", "Suporte interno"],
  },
];

const FEATURES = {
  hub: { label: "App Movyo Hub", minPlan: PLAN_CODES.START },
  tables: { label: "Gestao de mesas e comandas", minPlan: PLAN_CODES.START },
  counter: { label: "Pedidos no balcao", minPlan: PLAN_CODES.START },
  cashRegister: { label: "Frente de caixa", minPlan: PLAN_CODES.START },
  basicSalesView: { label: "Visao basica das vendas", minPlan: PLAN_CODES.START },

  digitalMenu: { label: "Cardapio digital personalizado", minPlan: PLAN_CODES.ESSENTIAL },
  delivery: { label: "Delivery, balcao e mesas", minPlan: PLAN_CODES.ESSENTIAL },
  desktop: { label: "Movyo Desktop", minPlan: PLAN_CODES.ESSENTIAL },
  onlinePayments: { label: "PIX e cartao no cardapio", minPlan: PLAN_CODES.ESSENTIAL },
  autoPrint: { label: "Impressao automatica", minPlan: PLAN_CODES.ESSENTIAL },
  salesReports: { label: "Relatorios de vendas", minPlan: PLAN_CODES.ESSENTIAL },

  whatsappBot: { label: "Robo no WhatsApp", minPlan: PLAN_CODES.PROFESSIONAL },
  salesRecovery: { label: "Recuperador de vendas", minPlan: PLAN_CODES.PROFESSIONAL },
  loyalty: { label: "Programa de fidelidade", minPlan: PLAN_CODES.PROFESSIONAL },
  inventory: { label: "Controle de estoque", minPlan: PLAN_CODES.PROFESSIONAL },
  recipes: { label: "Receitas e baixa automatica", minPlan: PLAN_CODES.PROFESSIONAL },
  production: { label: "Tela de producao", minPlan: PLAN_CODES.PROFESSIONAL },
  advancedReports: { label: "Relatorios avancados", minPlan: PLAN_CODES.PROFESSIONAL },

  driversApp: { label: "App motorista/entregador", minPlan: PLAN_CODES.PREMIUM },
  deliveryManagement: { label: "Gestao completa das entregas", minPlan: PLAN_CODES.PREMIUM },
  realtimeIndicators: { label: "Indicadores em tempo real", minPlan: PLAN_CODES.PREMIUM },
  audit: { label: "Auditoria de operadores", minPlan: PLAN_CODES.PREMIUM },
  managementReports: { label: "Relatorios gerenciais completos", minPlan: PLAN_CODES.PREMIUM },
  unlimitedUsers: { label: "Usuarios ilimitados", minPlan: PLAN_CODES.PREMIUM },
  prioritySupport: { label: "Atendimento prioritario", minPlan: PLAN_CODES.PREMIUM },
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "-");
}

function normalizePlanCode(value) {
  const key = normalizeText(value || PLAN_CODES.FREE);
  return PLAN_ALIASES[key] || PLAN_CODES.FREE;
}

function isTrialStatus(status) {
  const value = normalizeText(status);
  return value === "teste" || value === "trial" || value === "free-trial";
}

function getEffectivePlanCode(restauranteOrPlan = {}) {
  const rawPlan =
    typeof restauranteOrPlan === "string"
      ? restauranteOrPlan
      : restauranteOrPlan?.plano || restauranteOrPlan?.plan || restauranteOrPlan?.codigo;
  const code = normalizePlanCode(rawPlan);
  if (code === PLAN_CODES.FULL) return PLAN_CODES.FULL;

  const status =
    typeof restauranteOrPlan === "object"
      ? restauranteOrPlan?.statusAssinatura || restauranteOrPlan?.statusPlano || restauranteOrPlan?.assinaturaStatus
      : "";

  if (code === PLAN_CODES.FREE || isTrialStatus(status)) return PLAN_CODES.PROFESSIONAL;
  return code;
}

function planRank(value) {
  return PLAN_RANK[normalizePlanCode(value)] || 0;
}

function effectivePlanRank(restauranteOrPlan) {
  return PLAN_RANK[getEffectivePlanCode(restauranteOrPlan)] || 0;
}

function planHasFeature(restauranteOrPlan, featureKey) {
  const feature = FEATURES[featureKey];
  if (!feature) return false;
  return effectivePlanRank(restauranteOrPlan) >= planRank(feature.minPlan);
}

function getPlanLimit(restauranteOrPlan, limitKey) {
  const code = getEffectivePlanCode(restauranteOrPlan);
  const limits = PLAN_LIMITS[code] || PLAN_LIMITS[PLAN_CODES.FREE] || {};
  return Object.prototype.hasOwnProperty.call(limits, limitKey) ? limits[limitKey] : null;
}

function getPlanCatalogItem(code) {
  const normalized = normalizePlanCode(code);
  return PLAN_CATALOG.find((plan) => plan.codigo === normalized) || PLAN_CATALOG[0];
}

function getEnabledFeatures(restauranteOrPlan) {
  return Object.fromEntries(
    Object.keys(FEATURES).map((featureKey) => [featureKey, planHasFeature(restauranteOrPlan, featureKey)])
  );
}

function getPlanSummary(restauranteOrPlan = {}) {
  const declaredCode = normalizePlanCode(
    typeof restauranteOrPlan === "string" ? restauranteOrPlan : restauranteOrPlan?.plano || restauranteOrPlan?.plan
  );
  const effectiveCode = getEffectivePlanCode(restauranteOrPlan);
  const declared = getPlanCatalogItem(declaredCode);
  const effective = getPlanCatalogItem(effectiveCode);

  return {
    codigo: declaredCode,
    nome: declared.nome,
    efetivoCodigo: effectiveCode,
    efetivoNome: effective.nome,
    testeProfissional:
      declaredCode === PLAN_CODES.FREE ||
      (typeof restauranteOrPlan === "object" && isTrialStatus(restauranteOrPlan?.statusAssinatura)),
    rank: PLAN_RANK[effectiveCode] || 0,
    recursos: getEnabledFeatures(restauranteOrPlan),
    limites: PLAN_LIMITS[effectiveCode] || {},
  };
}

function getFeatureDefinition(featureKey) {
  return FEATURES[featureKey] || null;
}

module.exports = {
  PLAN_CODES,
  PLAN_CATALOG,
  PLAN_LIMITS,
  FEATURES,
  normalizePlanCode,
  getEffectivePlanCode,
  planHasFeature,
  getPlanLimit,
  getPlanSummary,
  getFeatureDefinition,
};
