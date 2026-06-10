// utils/atendimento.js
// Calcula status de atendimento usando horariosFuncionamento no fuso do restaurante.
// Suporta dia fechado, horário faltando e horário que cruza meia-noite.

const DEFAULT_TIMEZONE = process.env.BOT_TIMEZONE || process.env.TZ || 'America/Recife';

function parseHHMM(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtMin(min) {
  const hh = Math.floor(Number(min || 0) / 60) % 24;
  const mm = Number(min || 0) % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}

const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const diasLabel = {
  domingo: "domingo",
  segunda: "segunda",
  terca: "terça",
  quarta: "quarta",
  quinta: "quinta",
  sexta: "sexta",
  sabado: "sábado",
};

function getLocalParts(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = String(get('weekday') || '').toLowerCase();
    const weekMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    let hour = Number(get('hour') || 0);
    const minute = Number(get('minute') || 0);
    if (hour === 24) hour = 0;

    return {
      dayIndex: weekMap[weekday.slice(0, 3)] ?? date.getDay(),
      minutesNow: hour * 60 + minute,
      timezone,
    };
  } catch {
    return {
      dayIndex: date.getDay(),
      minutesNow: date.getHours() * 60 + date.getMinutes(),
      timezone: 'server',
    };
  }
}

function getDiaKeyByIndex(idx) {
  return dias[((Number(idx) % 7) + 7) % 7];
}

function normalizeHorarios(horariosFuncionamento) {
  if (!horariosFuncionamento) return null;
  if (typeof horariosFuncionamento === 'string') {
    try { return JSON.parse(horariosFuncionamento); } catch { return null; }
  }
  return horariosFuncionamento;
}

function getConfigDia(horariosFuncionamento, diaKey) {
  const horarios = normalizeHorarios(horariosFuncionamento);
  if (!horarios) return null;

  // Aceita chaves antigas/variações para não quebrar dados já salvos.
  const aliases = {
    domingo: ['domingo', 'Domingo', 'sunday', 'sun', '0'],
    segunda: ['segunda', 'Segunda', 'segunda-feira', 'monday', 'mon', '1'],
    terca: ['terca', 'terça', 'Terça', 'Terca', 'terça-feira', 'terca-feira', 'tuesday', 'tue', '2'],
    quarta: ['quarta', 'Quarta', 'quarta-feira', 'wednesday', 'wed', '3'],
    quinta: ['quinta', 'Quinta', 'quinta-feira', 'thursday', 'thu', '4'],
    sexta: ['sexta', 'Sexta', 'sexta-feira', 'friday', 'fri', '5'],
    sabado: ['sabado', 'sábado', 'Sábado', 'Sabado', 'saturday', 'sat', '6'],
  };

  let cfg = null;
  for (const key of aliases[diaKey] || [diaKey]) {
    if (horarios[key]) { cfg = horarios[key]; break; }
  }
  if (!cfg || typeof cfg !== 'object') return null;

  const fechado = cfg.fechado === true || cfg.fechado === 1 || String(cfg.fechado).toLowerCase() === 'true';
  return {
    abre: parseHHMM(cfg.abre || cfg.abertura || cfg.inicio || cfg.horaInicio),
    fecha: parseHHMM(cfg.fecha || cfg.fechamento || cfg.fim || cfg.horaFim),
    fechado,
  };
}

function isAbertoAgora(horariosFuncionamento, now = new Date(), timezone = DEFAULT_TIMEZONE) {
  const local = getLocalParts(now, timezone);
  const diaKey = getDiaKeyByIndex(local.dayIndex);
  const cfgHoje = getConfigDia(horariosFuncionamento, diaKey);
  const minutesNow = local.minutesNow;

  const diaOntemKey = getDiaKeyByIndex(local.dayIndex - 1);
  const cfgOntem = getConfigDia(horariosFuncionamento, diaOntemKey);

  if (cfgOntem && !cfgOntem.fechado && cfgOntem.abre != null && cfgOntem.fecha != null && cfgOntem.fecha < cfgOntem.abre) {
    if (minutesNow < cfgOntem.fecha) {
      return { aberto: true, fechaMin: cfgOntem.fecha, vindoDe: diaOntemKey, cruzaMeiaNoite: true, timezone: local.timezone };
    }
  }

  if (!cfgHoje || cfgHoje.fechado) return { aberto: false, fechaMin: null, timezone: local.timezone };
  if (cfgHoje.abre == null || cfgHoje.fecha == null) return { aberto: false, fechaMin: null, motivo: 'horario_indefinido', timezone: local.timezone };
  if (cfgHoje.fecha === cfgHoje.abre) return { aberto: false, fechaMin: null, motivo: 'abre_igual_fecha', timezone: local.timezone };

  if (cfgHoje.fecha < cfgHoje.abre) {
    const aberto = minutesNow >= cfgHoje.abre || minutesNow < cfgHoje.fecha;
    return { aberto, fechaMin: cfgHoje.fecha, vindoDe: diaKey, cruzaMeiaNoite: true, timezone: local.timezone };
  }

  const aberto = minutesNow >= cfgHoje.abre && minutesNow < cfgHoje.fecha;
  return { aberto, fechaMin: cfgHoje.fecha, vindoDe: diaKey, cruzaMeiaNoite: false, timezone: local.timezone };
}

function proximaAbertura(horariosFuncionamento, now = new Date(), timezone = DEFAULT_TIMEZONE) {
  const local = getLocalParts(now, timezone);
  const minutesNow = local.minutesNow;

  for (let i = 0; i < 7; i++) {
    const diaKey = getDiaKeyByIndex(local.dayIndex + i);
    const cfg = getConfigDia(horariosFuncionamento, diaKey);
    if (!cfg || cfg.fechado || cfg.abre == null || cfg.fecha == null) continue;

    if (i === 0) {
      if (minutesNow < cfg.abre) return { emDias: i, diaKey, abreMin: cfg.abre, fechaMin: cfg.fecha };
      continue;
    }
    return { emDias: i, diaKey, abreMin: cfg.abre, fechaMin: cfg.fecha };
  }

  return null;
}

function statusAtendimento(restaurante, now = new Date()) {
  const horarios = restaurante?.horariosFuncionamento;
  const timezone = restaurante?.timezone || restaurante?.fusoHorario || restaurante?.config?.timezone || DEFAULT_TIMEZONE;
  const s = isAbertoAgora(horarios, now, timezone);

  if (s.aberto) {
    return {
      aberto: true,
      texto: `✅ Estamos abertos agora. Fechamos às ${fmtMin(s.fechaMin)}.`,
      fechaAs: s.fechaMin != null ? fmtMin(s.fechaMin) : null,
      timezone: s.timezone,
    };
  }

  const prox = proximaAbertura(horarios, now, timezone);
  if (!prox) {
    return { aberto: false, texto: `⛔ Estamos fechados no momento.`, proximaAbertura: null, timezone: s.timezone };
  }

  const quando = prox.emDias === 0 ? "hoje" : (prox.emDias === 1 ? "amanhã" : `na ${diasLabel[prox.diaKey] || prox.diaKey}`);
  return {
    aberto: false,
    texto: `⛔ Estamos fechados agora. Abrimos ${quando} às ${fmtMin(prox.abreMin)}.`,
    proximaAbertura: { dia: prox.diaKey, abreAs: fmtMin(prox.abreMin) },
    timezone: s.timezone,
  };
}

module.exports = { statusAtendimento, isAbertoAgora, proximaAbertura };
