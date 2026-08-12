/**
 * Error responses the client can translate.
 *
 * Routes used to answer with a literal sentence — about sixty of them, roughly
 * half Portuguese and half English, sometimes adjacent in the same route group —
 * and `web/src/lib/api.js` threw it straight into a toast. There was no way to show
 * that sentence in the reader's language, because by then it was already prose.
 *
 * So the envelope carries a key as well as the text:
 *
 *     { error: "Movement not found", errorKey: "api.error.transactionNotFound",
 *       errorParams: {} }
 *
 * `error` stays, in English, for anything reading the API directly and for the
 * hundred-odd routes that still pass an exception message through untranslated.
 * The client prefers `errorKey` when it is there and falls back to `error` when it
 * is not, so this could be — and was — rolled out one route at a time.
 */

import en from '../../web/src/i18n/en.js';
import { moduleString } from '../framework/i18n.js';

/**
 * Render a key in English, for the `error` field and for anywhere the server has
 * to produce prose (notification fallbacks, log lines).
 *
 * The catalogue is a plain ESM object precisely so it can be imported here; both
 * packages are `"type": "module"` and no bundler is involved.
 *
 * Keys a module brought with it are consulted after the core catalogue, so a
 * fork's own bank can name its notifications without editing a shipped file —
 * and cannot redefine one of the app's own strings by accident.
 */
export function english(key, params = {}) {
  let value = en[key] ?? moduleString(key, 'en');
  if (value === undefined) return key;
  if (value && typeof value === 'object') {
    value = value[new Intl.PluralRules('en').select(Number(params.count) || 0)] ?? value.other;
  }
  return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
}

/** Answer with a translatable error. */
export function fail(res, status, key, params = {}) {
  return res.status(status).json({ error: english(key, params), errorKey: key, errorParams: params });
}

/**
 * Throw a translatable error from inside an engine.
 *
 * Engines cannot reach `res`, and several of them already threw Portuguese
 * sentences that routes turned into 400s. Attaching the key to the Error lets the
 * route catch forward it without knowing what went wrong.
 */
export function httpError(status, key, params = {}) {
  return Object.assign(new Error(english(key, params)), { status, key, params });
}

/** The catch-all a route handler ends with. Uses the thrown error's key when it
    has one, and otherwise reports the raw message under a generic key so the
    reader still sees something true rather than a blank toast. */
export function failFrom(res, err, fallbackStatus = 500) {
  if (err?.key) return fail(res, err.status || fallbackStatus, err.key, err.params);
  return res
    .status(err?.status || fallbackStatus)
    .json({
      error: err?.message || 'Unknown error',
      errorKey: 'api.error.unexpected',
      errorParams: { detail: err?.message || 'unknown' },
    });
}
