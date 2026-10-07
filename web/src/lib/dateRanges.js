/**
 * The dashboard's named ranges, and how a range steps to the one before it.
 *
 * Kept out of the page so the arithmetic can be tested without a browser — the
 * calendar edges (31 March minus one month, a leap February, the first of
 * January) are exactly where a range picker is quietly wrong for years.
 *
 * Every preset except "everything" resolves to *both* bounds. They used to set
 * only the start, which meant the server never had an end to measure the period
 * before against, so "against the period before" silently compared with nothing
 * on every preset anyone actually used.
 *
 * Dates are the reader's local calendar day, not UTC: at 00:30 in Lisbon it is
 * already the 1st, and `toISOString()` would still say the 31st.
 */

/** `labelKey`, not `label` — `t()` cannot run at module scope. */
export const PRESETS = [
  { id: 'thisMonth', labelKey: 'dashboard.preset.thisMonth' },
  { id: 'lastMonth', labelKey: 'dashboard.preset.lastMonth' },
  { id: '3m', labelKey: 'dashboard.preset.3m', months: 3 },
  { id: '12m', labelKey: 'dashboard.preset.12m', months: 12 },
  { id: 'ytd', labelKey: 'dashboard.preset.ytd' },
  { id: 'lastYear', labelKey: 'dashboard.preset.lastYear' },
  { id: '24m', labelKey: 'dashboard.preset.24m', months: 24 },
  { id: 'all', labelKey: 'dashboard.preset.all' },
];

const pad = (n) => String(n).padStart(2, '0');

/** A local calendar day as ISO. */
export function isoLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const daysIn = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/** Parses an ISO day into its parts, or null. */
function parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}

/** The same day `n` months away, clamped to the end of a shorter month. */
export function addMonths(iso, n) {
  const p = parts(iso);
  if (!p) return iso;
  const total = p.y * 12 + p.m + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  return `${y}-${pad(m + 1)}-${pad(Math.min(p.d, daysIn(y, m)))}`;
}

function addDays(iso, n) {
  const ms = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso) => {
  const p = parts(iso);
  return `${iso.slice(0, 7)}-${pad(daysIn(p.y, p.m))}`;
};

/** The range a preset means today. `all` is the only one left open. */
export function rangeFor(preset, now = new Date()) {
  const today = isoLocal(now);
  switch (preset) {
    case 'all':
      return { from: '', to: '' };
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'lastMonth': {
      const start = addMonths(monthStart(today), -1);
      return { from: start, to: monthEnd(start) };
    }
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'lastYear': {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    default: {
      const p = PRESETS.find((x) => x.id === preset);
      // The day after "N months ago", so twelve months is twelve months and not
      // twelve months and a day.
      return { from: addDays(addMonths(today, -(p?.months ?? 12)), 1), to: today };
    }
  }
}

/**
 * The range one step earlier (`-1`) or later (`+1`) than this one.
 *
 * A range that is whole calendar months steps by whole calendar months, so
 * stepping back from September lands on all of August, not on 1–30 August. A
 * month so far steps to the same days of the neighbouring month. Anything else
 * steps by its own length in days. Mirrors `priorSpan` on the server, which is
 * what the "against the period before" figures are measured over.
 */
export function shiftRange({ from, to }, direction) {
  if (!parts(from) || !parts(to)) return null;
  if (from.endsWith('-01')) {
    const months =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
      1;
    const step = months * direction;
    const nextFrom = addMonths(from, step);
    const wholeMonths = to === monthEnd(to);
    const nextTo = wholeMonths ? monthEnd(addMonths(monthStart(to), step)) : addMonths(to, step);
    return { from: nextFrom, to: nextTo };
  }
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return { from: addDays(from, days * direction), to: addDays(to, days * direction) };
}

/**
 * The preset a range *is*, if it is one — so stepping forward from August back
 * onto last month relabels the control rather than leaving it on "custom".
 */
export function presetOf(range, now = new Date()) {
  for (const p of PRESETS) {
    const r = rangeFor(p.id, now);
    if (r.from === range.from && r.to === range.to) return p.id;
  }
  return 'custom';
}
