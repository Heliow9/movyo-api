const DEFAULT_TIME_ZONE = process.env.MOVYO_OPERATIONAL_TIMEZONE || 'America/Sao_Paulo';

function ymdInTimeZone(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function todayYmd(timeZone = DEFAULT_TIME_ZONE) {
  return ymdInTimeZone(new Date(), timeZone);
}

function dayRangeSql(ymd = todayYmd()) {
  const value = String(ymd || '').slice(0, 10);
  return {
    inicio: `${value} 00:00:00`,
    fim: `${value} 23:59:59`,
    ymd: value,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  ymdInTimeZone,
  todayYmd,
  dayRangeSql,
};
