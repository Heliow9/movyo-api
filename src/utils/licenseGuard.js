// src/utils/licenseGuard.js
// Centraliza a regra de bloqueio/licença para Login, Hub Restaurante e Garçom.

const BLOCKED_WORDS = ["bloqueado", "bloqueada", "suspenso", "suspensa", "inativo", "inativa", "desativado", "desativada"];
const EXPIRED_WORDS = ["vencido", "vencida", "expirado", "expirada", "licença vencida", "licenca vencida", "assinatura vencida", "plano vencido", "inadimplente"];

export const RESTAURANTE_BLOQUEADO_MSG = "Restaurante bloqueado. Entre em contato com o suporte Movyo.";
export const LICENCA_VENCIDA_MSG = "Licença vencida. Regularize o plano para continuar usando o Movyo.";

function text(v) {
  return String(v ?? "").trim().toLowerCase();
}

function boolTrue(v) {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return ["true", "1", "sim", "yes", "bloqueado", "suspenso"].includes(text(v));
  return false;
}

function boolFalse(v) {
  if (v === false) return true;
  if (typeof v === "number") return v === 0;
  if (typeof v === "string") return ["false", "0", "nao", "não", "inativo", "desativado"].includes(text(v));
  return false;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  // Aceita yyyy-mm-dd, ISO e dd/mm/yyyy.
  let d = null;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 23, 59, 59, 999);
  else d = new Date(raw);

  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function isBeforeTodayEnd(dateLike) {
  const d = parseDate(dateLike);
  if (!d) return false;
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return d.getTime() < todayEnd.getTime() && d.toDateString() !== todayEnd.toDateString();
}

export function pickRestauranteFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.restaurante ||
    payload.restaurant ||
    payload.empresa ||
    payload.loja ||
    payload.data?.restaurante ||
    payload.data?.restaurant ||
    payload.garcom?.restaurante ||
    payload.usuario?.restaurante ||
    null
  );
}

export function isRestauranteBloqueado(restaurante = {}) {
  const r = restaurante || {};
  if (boolTrue(r.bloqueado || r.blocked || r.suspenso || r.suspended)) return true;
  if (boolFalse(r.ativo ?? r.active ?? r.habilitado ?? r.enabled)) return true;

  const statusFields = [r.status, r.statusConta, r.statusSistema, r.statusRestaurante, r.situacao, r.situacaoConta];
  return statusFields.some((v) => BLOCKED_WORDS.includes(text(v)));
}

export function isLicencaVencida(restaurante = {}) {
  const r = restaurante || {};
  const statusFields = [r.statusAssinatura, r.statusPlano, r.statusLicenca, r.statusLicença, r.planoStatus, r.assinaturaStatus];
  if (statusFields.some((v) => EXPIRED_WORDS.includes(text(v)))) return true;

  const dateFields = [
    r.dataFimPlano,
    r.dataVencimentoPlano,
    r.vencimentoPlano,
    r.vencimento,
    r.licencaAte,
    r.licençaAte,
    r.licencaValidaAte,
    r.licençaValidaAte,
    r.validadePlano,
    r.validade,
    r.assinaturaAte,
    r.expiresAt,
  ];

  return dateFields.some(isBeforeTodayEnd);
}

export function getRestauranteAccessBlockMessage(restaurante) {
  if (!restaurante || typeof restaurante !== "object") return null;

  // Prioridade intencional:
  // 1) bloqueio/desativação só quando o cadastro realmente está bloqueado/inativo;
  // 2) vencimento só quando campo/status de licença/plano indicar vencido.
  // Assim não mistura “restaurante bloqueado” com “licença vencida”.
  if (isRestauranteBloqueado(restaurante)) return RESTAURANTE_BLOQUEADO_MSG;
  if (isLicencaVencida(restaurante)) return LICENCA_VENCIDA_MSG;
  return null;
}

export function getAuthBlockMessageFromError(err) {
  const data = err?.response?.data || {};
  const msg = data?.message || data?.mensagem || data?.error || err?.message || "";
  const s = text(msg);

  // Primeiro licença: mensagens como “licença vencida” não podem cair como
  // “restaurante bloqueado/desativado”.
  if (s.includes("licen") && s.includes("venc")) return LICENCA_VENCIDA_MSG;
  if (s.includes("assinatura") && s.includes("venc")) return LICENCA_VENCIDA_MSG;
  if (s.includes("plano") && s.includes("venc")) return LICENCA_VENCIDA_MSG;
  if (EXPIRED_WORDS.some((w) => s.includes(w))) return LICENCA_VENCIDA_MSG;

  // Depois bloqueio real do restaurante. Evita interpretar textos genéricos
  // de sessão/permissão como bloqueio do restaurante.
  if (s.includes("restaurante bloque") || s.includes("restaurante desativ") || s.includes("restaurante inativ")) return RESTAURANTE_BLOQUEADO_MSG;
  if (s.includes("conta bloque") || s.includes("conta desativ") || s.includes("conta inativ")) return RESTAURANTE_BLOQUEADO_MSG;

  const restaurante = pickRestauranteFromPayload(data);
  return getRestauranteAccessBlockMessage(restaurante);
}
