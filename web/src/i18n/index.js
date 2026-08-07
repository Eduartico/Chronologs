/**
 * Translation.
 *
 * Hand-rolled, and deliberately so. i18next brings ~40 kB, an init lifecycle, a
 * Suspense story and a namespace loader, and this app has one user, two languages,
 * no lazy loading and no right-to-left. The single feature worth importing a
 * library for — plural rules — is already in the platform as `Intl.PluralRules`.
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

import en from './en.js';
import pt from './pt.js';
import { currentLocale, setLocale, onLocaleChange, intlLocale, DEFAULT_LOCALE } from '../lib/locale.js';

const CATALOGUES = { en, pt };

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
