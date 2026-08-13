/**
 * Translation.
 *
 * Hand-rolled, and deliberately so. i18next brings ~40 kB, an init lifecycle, a
 * Suspense story and a namespace loader, and this app has one user, no lazy
 * loading and no right-to-left. The single feature worth importing a library
 * for — plural rules — is already in the platform as `Intl.PluralRules`, and it
 * carries every category Russian and Polish need without being told.
 *
 * The other reason is the server. `server/lib/notify.js` renders an English
 * fallback into the stored notification so exports and old rows still read, which
 * means the catalogue has to import cleanly into Node. A plain ESM object does;
 * an i18next instance would need a second init and a second config.
 *
 * Missing keys fall through to English and then to the key itself, so a typo shows
 * up as `transactions.ttile` on screen rather than as a blank button.
 */
import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from 'react';

import { currentLocale, setLocale, onLocaleChange, intlLocale, localeTag, DEFAULT_LOCALE } from '../lib/locale.js';

/**
 * Catalogues are discovered, not registered.
 *
 * There used to be a hardcoded `{ en, pt }` and two static imports, so adding a
 * language meant editing this file — the same "list you must not forget" that
 * `modules/*​/module.js` was globbed to get rid of. Dropping `locales/sv.js` in
 * is now the whole of adding Swedish, and the parity test will immediately say
 * which of the 568 keys it is missing.
 *
 * Eager, because `t()` is synchronous in several hundred call sites and a lazy
 * catalogue would make every one of them a loading state. The whole set is
 * strings; it costs a fraction of what the chart library does.
 *
 * Module catalogues are merged underneath, so a module can name its own screens
 * — core keys win a collision, matching what `registerModuleCatalogues` does on
 * the server.
 */
/*
 * The `try` is not defensiveness, it is the seam between two runtimes.
 * `import.meta.glob` is Vite's and is replaced with an object literal at build
 * time; under plain Node — which is what `node --test` gives the pure modules in
 * lib/ — it does not exist. Catching means `money.js` and friends can be
 * imported by a test without dragging Vite in. `t()` returns its key there,
 * which is exactly what a test of currency arithmetic wants; a test that needs
 * real strings imports `locales/en.js` directly, as i18n.test.js does.
 */
let CORE = {};
let MODULE = {};
try {
  CORE = import.meta.glob('./locales/*.js', { eager: true, import: 'default' });
  MODULE = import.meta.glob('../../../modules/*/i18n/*.js', { eager: true, import: 'default' });
} catch {
  /* not running under Vite */
}

function byLocale(files, nameOf) {
  const out = {};
  for (const [path, strings] of Object.entries(files)) {
    const code = nameOf(path);
    if (!code) continue;
    out[code] = { ...(out[code] || {}), ...strings };
  }
  return out;
}

const moduleStrings = byLocale(MODULE, (p) => p.match(/\/i18n\/([\w-]+)\.js$/)?.[1]);
const coreStrings = byLocale(CORE, (p) => p.match(/\/locales\/([\w-]+)\.js$/)?.[1]);

const CATALOGUES = Object.fromEntries(
  Object.keys(coreStrings).map((code) => [code, { ...(moduleStrings[code] || {}), ...coreStrings[code] }]),
);

const en = CATALOGUES[DEFAULT_LOCALE] || {};

/** Every locale that actually has a catalogue file. The locale registry in
    lib/locale.js and this list are asserted equal by i18n.test.js. */
export function catalogueCodes() {
  return Object.keys(CATALOGUES);
}

export function catalogue(locale = currentLocale()) {
  return CATALOGUES[locale] || CATALOGUES[DEFAULT_LOCALE];
}

const INTERPOLATION = /\{(\w+)\}/g;

/**
 * Look a key up and fill in its parameters.
 *
 * A value can be a string, or an object of plural categories when the wording
 * changes with a count: `{ one: '{count} dia', other: '{count} dias' }`.
 */
export function t(key, params) {
  const active = catalogue();
  let value = active[key];
  if (value === undefined) value = en[key];
  if (value === undefined) return key;

  if (value && typeof value === 'object') {
    const category = new Intl.PluralRules(intlLocale()).select(Number(params?.count) || 0);
    value = value[category] ?? value.other ?? Object.values(value)[0];
  }

  if (!params) return value;
  return String(value).replace(INTERPOLATION, (_, name) => (params[name] ?? ''));
}

/**
 * The same lookup, but for the fifty-odd strings that contain markup — "Found
 * **12 duplicates** across 3 accounts". Returns an array of strings and nodes,
 * which JSX renders directly.
 *
 * Splitting on the placeholder means the translator moves `{count}` wherever the
 * sentence needs it, and the `<strong>` travels with it. No mini-parser, no
 * `dangerouslySetInnerHTML`.
 */
export function tx(key, params) {
  const value = t(key, undefined);
  if (typeof value !== 'string' || !params) return [value];

  const out = [];
  let last = 0;
  for (const match of value.matchAll(INTERPOLATION)) {
    if (match.index > last) out.push(value.slice(last, match.index));
    out.push(params[match[1]] ?? '');
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push(value.slice(last));
  return out.map((part, i) => (typeof part === 'string' ? part : createElement('span', { key: i }, part)));
}

/* ---- React binding ---------------------------------------------------------
   The locale lives in a plain module (see lib/locale.js) because formatters call
   it outside React. This subscribes the tree to it, so a language change repaints
   without every component having to be a settings consumer. */

function subscribe(onChange) {
  return onLocaleChange(onChange);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const locale = useSyncExternalStore(subscribe, currentLocale, () => DEFAULT_LOCALE);
  const value = useMemo(() => ({ locale, t, tx }), [locale]);
  return createElement(I18nContext.Provider, { value }, children);
}

/** `const { t } = useT()` in a component; the bare `t` import works anywhere else. */
export function useT() {
  return useContext(I18nContext) ?? { locale: currentLocale(), t, tx };
}

export { setLocale, currentLocale };
