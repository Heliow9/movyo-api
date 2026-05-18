// utils/atendimento.js
// ✅ calcula se a loja está aberta AGORA baseado em horariosFuncionamento
// ✅ suporta: dia fechado, horários faltando, e horário que cruza meia-noite (ex 18:00 -> 02:00)
// ✅ retorna também próximo horário de abertura e horário de fechamento quando aberto

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
  const hh = Math.floor(min / 60) % 24;
  const mm = min % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}

const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function getDiaKey(date) {
  return dias[date.getDay()];
}

function getConfigDia(horariosFuncionamento, diaKey) {
  if (!horariosFuncionamento) return null;
  const cfg = horariosFuncionamento[diaKey];
  if (!cfg) return null;
  return {
    abre: parseHHMM(cfg.abre),
    fecha: parseHHMM(cfg.fecha),
    fechado: !!cfg.fechado,
  };
}

// Retorna { aberto: bool, fechaMin: number|null }
// Considera o dia atual E o “spill” do dia anterior (quando fecha após meia-noite)
function isAbertoAgora(horariosFuncionamento, now = new Date()) {
  const diaKey = getDiaKey(now);
  const cfgHoje = getConfigDia(horariosFuncionamento, diaKey);

  const minutesNow = now.getHours() * 60 + now.getMinutes();

  // 1) Caso esteja aberto por conta do dia ANTERIOR cruzando meia-noite
  const ontem = new Date(now);
  ontem.setDate(now.getDate() - 1);
  const diaOntemKey = getDiaKey(ontem);
  const cfgOntem = getConfigDia(horariosFuncionamento, diaOntemKey);

  if (cfgOntem && !cfgOntem.fechado && cfgOntem.abre != null && cfgOntem.fecha != null) {
    // cruza meia-noite se fecha < abre
    if (cfgOntem.fecha < cfgOntem.abre) {
      // ex: abre 18:00 (1080), fecha 02:00 (120)
      // então está aberto se agora < fecha (no começo do dia seguinte)
      if (minutesNow < cfgOntem.fecha) {
        return { aberto: true, fechaMin: cfgOntem.fecha, vindoDe: diaOntemKey, cruzaMeiaNoite: true };
      }
    }
  }

  // 2) Verifica o dia atual normal
  if (!cfgHoje || cfgHoje.fechado) return { aberto: false, fechaMin: null };

  if (cfgHoje.abre == null || cfgHoje.fecha == null) {
    // Sem horário definido: trata como fechado (mais seguro)
    return { aberto: false, fechaMin: null, motivo: "horario_indefinido" };
  }

  if (cfgHoje.fecha === cfgHoje.abre) {
    // mesmo horário = ambíguo; trata como fechado
    return { aberto: false, fechaMin: null, motivo: "abre_igual_fecha" };
  }

  // Cruza meia-noite?
  if (cfgHoje.fecha < cfgHoje.abre) {
    // aberto se >= abre OU < fecha
    const aberto = minutesNow >= cfgHoje.abre || minutesNow < cfgHoje.fecha;
    return { aberto, fechaMin: cfgHoje.fecha, vindoDe: diaKey, cruzaMeiaNoite: true };
  }

  // Normal: abre <= now < fecha
  const aberto = minutesNow >= cfgHoje.abre && minutesNow < cfgHoje.fecha;
  return { aberto, fechaMin: cfgHoje.fecha, vindoDe: diaKey, cruzaMeiaNoite: false };
}

// Próxima abertura (até 7 dias)
function proximaAbertura(horariosFuncionamento, now = new Date()) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const diaKey = getDiaKey(d);
    const cfg = getConfigDia(horariosFuncionamento, diaKey);

    if (!cfg || cfg.fechado || cfg.abre == null || cfg.fecha == null) continue;

    // Se for hoje, só serve se a abertura ainda não passou (ou se cruza meia-noite e estamos antes de abrir)
    if (i === 0) {
      // se cruza meia-noite, "abre" é sempre hoje em minutos
      if (minutesNow < cfg.abre) {
        return { emDias: i, diaKey, abreMin: cfg.abre, fechaMin: cfg.fecha };
      }
      // se já passou do abre, então "próxima abertura" é amanhã (não retorna hoje)
      continue;
    }

    return { emDias: i, diaKey, abreMin: cfg.abre, fechaMin: cfg.fecha };
  }

  return null;
}

function statusAtendimento(restaurante, now = new Date()) {
  const horarios = restaurante?.horariosFuncionamento;
  const s = isAbertoAgora(horarios, now);

  if (s.aberto) {
    return {
      aberto: true,
      texto: `✅ Estamos abertos agora. Fechamos às ${fmtMin(s.fechaMin)}.`,
      fechaAs: s.fechaMin != null ? fmtMin(s.fechaMin) : null,
    };
  }

  const prox = proximaAbertura(horarios, now);
  if (!prox) {
    return {
      aberto: false,
      texto: `⛔ Estamos fechados no momento.`,
      proximaAbertura: null,
    };
  }

  const diaLabel = {
    domingo: "domingo",
    segunda: "segunda",
    terca: "terça",
    quarta: "quarta",
    quinta: "quinta",
    sexta: "sexta",
    sabado: "sábado",
  }[prox.diaKey] || prox.diaKey;

  const quando = prox.emDias === 0 ? "hoje" : (prox.emDias === 1 ? "amanhã" : `na ${diaLabel}`);

  return {
    aberto: false,
    texto: `⛔ Estamos fechados agora. Abrimos ${quando} às ${fmtMin(prox.abreMin)}.`,
    proximaAbertura: { dia: prox.diaKey, abreAs: fmtMin(prox.abreMin) },
  };
}

module.exports = {
  statusAtendimento,
  isAbertoAgora,
  proximaAbertura,
};
