const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function parseHHMM(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const h = Math.max(0, Math.min(23, Math.floor(value)));
    return h * 60;
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2] || 0);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function fmtMin(minutes) {
  if (minutes == null) return "";
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizarConfigDia(raw) {
  if (!raw) return null;
  const cfg = parseJsonMaybe(raw) || raw;
  const fechado = cfg.fechado === true || cfg.aberto === false || cfg.ativo === false;
  const abre = parseHHMM(cfg.abre ?? cfg.abertura ?? cfg.inicio ?? cfg.horarioInicio ?? cfg.open ?? cfg.from);
  const fecha = parseHHMM(cfg.fecha ?? cfg.fechamento ?? cfg.fim ?? cfg.horarioFim ?? cfg.close ?? cfg.to);
  return { fechado, abre, fecha };
}

function getHorarios(restaurante) {
  return parseJsonMaybe(restaurante?.horariosFuncionamento) || parseJsonMaybe(restaurante?.horarios) || null;
}

function getConfigDia(horarios, diaKey) {
  if (!horarios) return null;
  return normalizarConfigDia(horarios[diaKey]);
}

export function statusAtendimentoLoja(restaurante, now = new Date()) {
  const horarios = getHorarios(restaurante);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const diaKey = DIAS[now.getDay()];

  const ontem = new Date(now);
  ontem.setDate(now.getDate() - 1);
  const cfgOntem = getConfigDia(horarios, DIAS[ontem.getDay()]);
  if (cfgOntem && !cfgOntem.fechado && cfgOntem.abre != null && cfgOntem.fecha != null && cfgOntem.fecha < cfgOntem.abre) {
    if (minutesNow < cfgOntem.fecha) {
      return { aberto: true, label: "Aberto", texto: `Aberto até ${fmtMin(cfgOntem.fecha)}`, fechaAs: fmtMin(cfgOntem.fecha) };
    }
  }

  const cfgHoje = getConfigDia(horarios, diaKey);
  if (cfgHoje && !cfgHoje.fechado && cfgHoje.abre != null && cfgHoje.fecha != null && cfgHoje.abre !== cfgHoje.fecha) {
    const aberto = cfgHoje.fecha < cfgHoje.abre
      ? minutesNow >= cfgHoje.abre || minutesNow < cfgHoje.fecha
      : minutesNow >= cfgHoje.abre && minutesNow < cfgHoje.fecha;
    if (aberto) {
      return { aberto: true, label: "Aberto", texto: `Aberto até ${fmtMin(cfgHoje.fecha)}`, fechaAs: fmtMin(cfgHoje.fecha) };
    }
  }

  if (!horarios && restaurante?.horarioInicio != null && restaurante?.horarioFim != null) {
    const abre = parseHHMM(restaurante.horarioInicio);
    const fecha = parseHHMM(restaurante.horarioFim);
    if (abre != null && fecha != null && abre !== fecha) {
      const aberto = fecha < abre ? minutesNow >= abre || minutesNow < fecha : minutesNow >= abre && minutesNow < fecha;
      if (aberto) return { aberto: true, label: "Aberto", texto: `Aberto até ${fmtMin(fecha)}`, fechaAs: fmtMin(fecha) };
    }
  }

  return { aberto: false, label: "Fechado", texto: "Fechado agora" };
}

export function calcularStatusLoja(restaurante) {
  return statusAtendimentoLoja(restaurante).label;
}
