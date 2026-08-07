/**
 * Display formatting.
 *
 * Dates were rendered as the ISO strings the API speaks — 2026-04-21 — which is
 * the right thing to store and the wrong thing to show a reader. Everything the
 * user reads goes through here; `<input type="date">` keeps ISO, because that is
 * what the element requires.
 *
 * The locale used to be the literal `'pt-PT'`, seven times in this file. It now
 * comes from `lib/locale.js`, which is the only module that knows the language.
 * Note the consequence: `formatDate` is no longer guaranteed to be dd/mm/yyyy — it
 * is whatever the active locale considers a short date, which is dd/mm for both
 * pt-PT and en-GB but would be mm/dd the day en-US is added. That is the point.
 */

import { df, nf, intlLocale } from './locale.js';
import { t } from '../i18n/index.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 2026-04-21 → 21/04/2026 */
export function formatDate(value) {
  const iso = String(value || '').slice(0, 10);
  const m = iso.match(ISO);
  if (!m) return iso;
  // Built as UTC so a date-only string never slips a day in a negative offset.
  return df({ day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}

/** 2026-04-21 → 21/04, for axes and dense tables where the year is implied. */
export function formatDayMonth(value) {
  const iso = String(value || '').slice(0, 10);
  const m = iso.match(ISO);
  if (!m) return iso;
  return df({ day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * A timestamp with its time of day → "21/04/2026 at 14:30".
 *
 * `toLocaleString()` with no locale follows the machine, so the same app read
 * "8/4/2026, 2:15:00 PM" on an en-US Windows and dd/mm elsewhere. The format is a
 * product decision, not a machine setting — and the connector word between the two
 * halves is a translation, not punctuation.
 */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? '');
  return t('format.dateTime', {
    date: df({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(d),
    time: df({ hour: '2-digit', minute: '2-digit' }).format(d),
  });
}

/** 2026-04 → abr/2026 */
export function formatMonth(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return String(value || '');
  const label = df({ month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
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
  const text = nf({ style: 'currency', currency: 'EUR' }).format(Math.abs(n));
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

/** "1 day" / "3 days", from an inclusive date range. Pluralised by the locale's
    own rules rather than by a `=== 1` check, which is wrong in most languages. */
export function formatDuration(from, to) {
  return t('format.days', { count: nightsBetween(from, to) + 1 });
}

/** Exposed for the rare caller that needs the raw tag, e.g. an `Intl` call this
    module does not wrap. Prefer adding a helper here over reaching for it. */
export { intlLocale };
