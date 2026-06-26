const DEFAULT_TIME_ZONE =
  String(process.env.MOVYO_TIMEZONE || process.env.MOVYO_OPERATIONAL_TIMEZONE || 'America/Sao_Paulo').trim()
  || 'America/Sao_Paulo';

const MOVYO_TZ_OFFSET_MINUTES = Number(process.env.MOVYO_TZ_OFFSET_MINUTES || -180);

function mysqlWallClockParts(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
    second: match[6] || '00',
  };
}

function parseOperationalDate(value) {
  if (value instanceof Date) return new Date(value.getTime());

  const wall = mysqlWallClockParts(value);
  if (wall) {
    const utcWallTime = Date.UTC(
      Number(wall.year),
      Number(wall.month) - 1,
      Number(wall.day),
      Number(wall.hour),
      Number(wall.minute),
      Number(wall.second)
    );
    return new Date(utcWallTime - MOVYO_TZ_OFFSET_MINUTES * 60 * 1000);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function partsInOperationalTimeZone(value = new Date()) {
  const wall = mysqlWallClockParts(value);
  if (wall) return wall;

  const date = parseOperationalDate(value);
  if (!date) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  } catch {
    const shifted = new Date(date.getTime() + MOVYO_TZ_OFFSET_MINUTES * 60 * 1000);
    const pad = (number) => String(number).padStart(2, '0');
    return {
      year: String(shifted.getUTCFullYear()),
      month: pad(shifted.getUTCMonth() + 1),
      day: pad(shifted.getUTCDate()),
      hour: pad(shifted.getUTCHours()),
      minute: pad(shifted.getUTCMinutes()),
      second: pad(shifted.getUTCSeconds()),
    };
  }
}

function formatOperationalDateISO(value = new Date()) {
  const parts = partsInOperationalTimeZone(value);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatOperationalTimeBR(value = new Date()) {
  const parts = partsInOperationalTimeZone(value);
  if (!parts) return '';
  return `${parts.hour}:${parts.minute}`;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  MOVYO_TZ_OFFSET_MINUTES,
  formatOperationalDateISO,
  formatOperationalTimeBR,
  parseOperationalDate,
};
