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

/**
 * The locales the app ships.
 *
 * Keys are what `settings.json` stores and what the catalogue files under
 * `i18n/locales/` are named. `tag` is what `Intl` wants. `name` is the endonym —
 * the language written in itself — because a picker that says "Japanisch" is
 * only findable by someone who already reads German, which is the wrong way
 * round for the one control whose job is to get you out of a language you
 * cannot read. It also keeps fourteen language names out of fourteen
 * catalogues, which would have been 196 strings to hold in step.
 *
 * `firstDay` is 0 for Sunday, 1 for Monday. `Intl.Locale.getWeekInfo` still is
 * not everywhere, so it is stated rather than derived.
 *
 * Portuguese is European Portuguese and stays that way — see the header of
 * `i18n/locales/pt.js`.
 */
export const LOCALES = {
  en: { tag: 'en-GB', name: 'English', firstDay: 1 },
  es: { tag: 'es-ES', name: 'Español', firstDay: 1 },
  fr: { tag: 'fr-FR', name: 'Français', firstDay: 1 },
  de: { tag: 'de-DE', name: 'Deutsch', firstDay: 1 },
  it: { tag: 'it-IT', name: 'Italiano', firstDay: 1 },
  nl: { tag: 'nl-NL', name: 'Nederlands', firstDay: 1 },
  pl: { tag: 'pl-PL', name: 'Polski', firstDay: 1 },
  pt: { tag: 'pt-PT', name: 'Português', firstDay: 1 },
  ru: { tag: 'ru-RU', name: 'Русский', firstDay: 1 },
  tr: { tag: 'tr-TR', name: 'Türkçe', firstDay: 1 },
  hi: { tag: 'hi-IN', name: 'हिन्दी', firstDay: 0 },
  ja: { tag: 'ja-JP', name: '日本語', firstDay: 0 },
  ko: { tag: 'ko-KR', name: '한국어', firstDay: 0 },
  'zh-CN': { tag: 'zh-CN', name: '中文（简体）', firstDay: 1 },
};

export const DEFAULT_LOCALE = 'en';

/** Codes in picker order: the shipped default first, then alphabetical by endonym
    under the reader's own collation, so the list reads sorted in any language. */
export function localeCodes() {
  const rest = Object.keys(LOCALES).filter((c) => c !== DEFAULT_LOCALE);
  rest.sort((a, b) => LOCALES[a].name.localeCompare(LOCALES[b].name, intlLocale()));
  return [DEFAULT_LOCALE, ...rest];
}

/** The BCP-47 tag for a code, falling back rather than returning undefined —
    every caller of this is about to hand the result to `Intl`. */
export function localeTag(code) {
  return (LOCALES[code] || LOCALES[DEFAULT_LOCALE]).tag;
}

/** The language's own name for itself. */
export function localeName(code) {
  return (LOCALES[code] || LOCALES[DEFAULT_LOCALE]).name;
}

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
  return localeTag(current);
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

/** A currency's name in the reader's language. `Intl.DisplayNames` already knows
    every currency in every locale the app ships, so none of these are strings
    anyone has to translate. Falls back to the code, which is never wrong. */
export function currencyName(code, locale = intlLocale()) {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

/** Month names in the active language. Replaces the hardcoded Portuguese arrays
    that had accumulated in chartTheme.js and Calendar.jsx. */
export function monthNames(month = 'short') {
  const f = df({ month, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2021, i, 1))).replace('.', ''));
}

/**
 * Weekday names, ordered from this locale's first day of the week.
 *
 * The calendar grid used to assume Monday, because Portugal starts there. Most
 * of Europe agrees — but Japan, Korea and India do not, so the offset maths
 * reads the value instead of assuming it.
 */
export function weekdayNames(weekday = 'narrow') {
  const f = df({ weekday, timeZone: 'UTC' });
  const first = firstDayOfWeek();
  // 2021-08-01 was a Sunday, so index 0 of this walk is Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2021, 7, 1 + ((i + first) % 7)))));
}

/** 0 = Sunday, 1 = Monday, from the locale registry rather than a second table. */
export function firstDayOfWeek() {
  return LOCALES[current]?.firstDay ?? 1;
}

/**
 * Which order this locale types a date in, and what it separates the parts with.
 *
 * Read out of `Intl` rather than declared, so a locale added to the table above
 * gets its own order for free. `dd/mm/yyyy` was baked into the typing, the
 * masking and the parsing, which is right for Lisbon and wrong for Tokyo.
 *
 * Returns e.g. `{ order: ['day','month','year'], separator: '/' }`.
 */
const orderCache = new Map();
export function dateFieldOrder(code = current) {
  // An app code, not a tag: `Intl.DateTimeFormat('en')` is American and would
  // put the month first for a locale the app calls `en` and means `en-GB` by.
  const locale = localeTag(code);
  let found = orderCache.get(locale);
  if (found) return found;
  let order = ['day', 'month', 'year'];
  let separator = '/';
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatToParts(new Date(Date.UTC(2021, 10, 22)));
    const seen = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type);
    if (seen.length === 3) order = seen;
    // The first literal that is not whitespace is the separator this locale
    // types. Some locales suffix each part instead (ja: 2021年11月22日); a
    // suffixing locale has no single separator, so those fall back to a slash
    // and only the *order* changes.
    const literal = parts.find((p) => p.type === 'literal' && /[^\s]/.test(p.value));
    const glyph = literal?.value.trim();
    if (glyph && glyph.length === 1 && /[./-]/.test(glyph)) separator = glyph;
  } catch {
    /* the defaults above are the European order */
  }
  found = { order, separator };
  orderCache.set(locale, found);
  return found;
}
