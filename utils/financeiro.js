const OPEN_STATUSES = ['em_aberto', 'parcial', 'vencida'];

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function monthKey(value) {
  return dateOnly(value).slice(0, 7);
}

function addMonths(dateText, amount) {
  const [year, month, day] = dateText.split('-').map(Number);
  const first = new Date(year, month - 1 + amount, 1, 12, 0, 0);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const result = new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay), 12, 0, 0);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function effectiveStatus(row) {
  const status = String(row?.status || 'em_aberto').toLowerCase();
  if (!OPEN_STATUSES.includes(status)) return status;
  if (Number(row?.saldo || 0) <= 0) return 'paga';
  const due = dateOnly(row?.vencimento);
  const today = dateOnly(new Date().toISOString());
  if (due && due < today) return 'vencida';
  return Number(row?.saldo || 0) < Number(row?.valorOriginal || 0) ? 'parcial' : 'em_aberto';
}

module.exports = { addMonths, cleanPhone, dateOnly, effectiveStatus, monthKey };
