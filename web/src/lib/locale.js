/**
 * The one place that knows which language the app is in.
 *
 * Before this, `'pt-PT'` was a literal in eight places across five files and the
 * exchange rate lived in a module variable seeded by whichever page happened to
 * fetch settings last. Both are the same bug: a global that anyone can set and
 * nobody owns. This module owns the locale; `SettingsProvider` is the only caller
 * of `setLocale()`.
 *
 * It is deliberately not a React module. `format.js`, `money.js` and
 * `chartTheme.js` are called from formatters and axis ticks that have no component
 * around them, so the value has to be readable synchronously. The provider still
 * re-renders the tree on a change — this is the value those renders read.
 *
 * It is seeded at import time from the same localStorage blob the boot script in
 * index.html reads, so the very first paint is already in the right language and
 * nothing has to flash through English on the way to Portuguese.
 */

/** The locales the app ships. Keys are what settings.json stores; values are what
    `Intl` wants. Portuguese is European Portuguese and stays that way. */
export const LOCALES = {
  en: 'en-GB',
  pt: 'pt-PT',
};

export const DEFAULT_LOCALE = 'en';

let current = DEFAULT_LOCALE;
const listeners = new Set();

/** Read the mirror the boot script wrote. Never throws — a corrupt blob just means
    the default, which the settings fetch will correct a moment later. */
function seed() {
  try {
    const raw = globalThis.localStorage?.getItem('chronologs.appearance');
    const lang = raw && JSON.parse(raw).locale;
    if (lang && LOCALES[lang]) current = lang;
  } catch {
    /* keep the default */
  }
}
seed();

export function currentLocale() {
  return current;
}

/** The BCP-47 tag for `Intl`. */
export function intlLocale() {
  return LOCALES[current] || LOCALES[DEFAULT_LOCALE];
}

export function setLocale(next) {
  if (!LOCALES[next] || next === current) return false;
  current = next;
  cache.clear();
  for (const fn of listeners) fn(current);
  return true;
}

/** For the few non-React consumers that have to invalidate their own memoisation. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- formatters ------------------------------------------------------------
   `Intl.NumberFormat` and `Intl.DateTimeFormat` are expensive to construct and
   were being built inside render loops and axis tick callbacks. Memoised on
   locale + options; the cache is cleared whenever the locale moves. */

const cache = new Map();

function memo(kind, options) {
  const key = `${kind}:${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = kind === 'number' ? new Intl.NumberFormat(intlLocale(), options) : new Intl.DateTimeFormat(intlLocale(), options);
    cache.set(key, f);
  }
  return f;
}

export const nf = (options) => memo('number', options);
export const df = (options) => memo('date', options);

/** Month names in the active language. Replaces the hardcoded Portuguese arrays
    that had accumulated in chartTheme.js and Calendar.jsx. */
export function monthNames(month = 'short') {
  const f = df({ month, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2021, i, 1))).replace('.', ''));
}

/**
 * Weekday names, ordered from this locale's first day of the week.
 *
 * The calendar grid used to assume Monday, because Portugal starts there. English
 * (GB) does too, so today both locales agree — but the offset maths now reads the
 * value instead of assuming it, which is what makes adding en-US a data change.
 */
export function weekdayNames(weekday = 'narrow') {
  const f = df({ weekday, timeZone: 'UTC' });
  const first = firstDayOfWeek();
  // 2021-08-01 was a Sunday, so index 0 of this walk is Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2021, 7, 1 + ((i + first) % 7)))));
}

/** 0 = Sunday, 1 = Monday. `Intl.Locale.getWeekInfo` is not everywhere yet, so the
    two locales the app ships are stated outright. */
export function firstDayOfWeek() {
  return { 'pt-PT': 1, 'en-GB': 1, 'en-US': 0 }[intlLocale()] ?? 1;
}
