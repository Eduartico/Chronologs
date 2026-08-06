/**
 * Display formatting.
 *
 * Dates were rendered as the ISO strings the API speaks — 2026-04-21 — which is
 * the right thing to store and the wrong thing to show to someone in Portugal.
 * Everything the user reads goes through here; `<input type="date">` keeps ISO,
 * because that is what the element requires.
 */

const PT = 'pt-PT';

/** 2026-04-21 → 21/04/2026 */
export function formatDate(value) {
  const iso = String(value || '').slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** 2026-04-21 → 21/04, for axes and dense tables where the year is implied. */
export function formatDayMonth(value) {
  const iso = String(value || '').slice(0, 10);
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : iso;
}

/**
 * A timestamp with its time of day → "21/04/2026 às 14:30".
 *
 * `toLocaleString()` with no locale follows the machine, so the same app read
 * "8/4/2026, 2:15:00 PM" on an en-US Windows and dd/mm elsewhere. The format is
 * a product decision, not a machine setting.
 */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? '');
  const date = new Intl.DateTimeFormat(PT, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat(PT, { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${date} às ${time}`;
}

/** 2026-04 → abr/2026 */
export function formatMonth(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return String(value || '');
  const label = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString(PT, {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${label.replace('.', '')}/${m[1]}`;
}

/** A date range, collapsing a single day to just that day. */
export function formatRange(from, to) {
  const a = formatDate(from);
  const b = formatDate(to);
  return a === b ? a : `${a} – ${b}`;
}

export function formatCurrency(value, { signed = false } = {}) {
  const n = Number(value) || 0;
  const text = new Intl.NumberFormat(PT, { style: 'currency', currency: 'EUR' }).format(Math.abs(n));
  if (!signed) return n < 0 ? `−${text}` : text;
  return `${n < 0 ? '−' : '+'}${text}`;
}

/** How many nights a trip covers, counted the way people count them. */
export function nightsBetween(from, to) {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** "1 dia" / "3 dias", from an inclusive date range. */
export function formatDuration(from, to) {
  const days = nightsBetween(from, to) + 1;
  return days === 1 ? '1 dia' : `${days} dias`;
}
