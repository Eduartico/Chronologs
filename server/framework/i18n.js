/**
 * Module-supplied translations, on the server side.
 *
 * The server renders English into every stored notification so that an export,
 * or a row read years later, still says something. That fallback reads the
 * catalogue directly (`lib/httpError.js`), and a module's own strings are not in
 * it — they live in `modules/<id>/i18n/`, which the *frontend* reaches with
 * `import.meta.glob`, a Vite-only mechanism Node cannot use.
 *
 * So the two halves read the same files by different routes: the browser globs
 * them (`web/src/i18n/index.js`), and a manifest declares them as
 * `i18n: { en, pt }` for this side. They are registered once at startup into a
 * plain object that `english()` consults after the core catalogue.
 *
 * Registration is synchronous and additive on purpose. Before it runs — during
 * boot, before any module has been asked for anything — lookups fall through to
 * the core catalogue, which is exactly right, because nothing that could need a
 * module string has happened yet.
 *
 * The object starts empty rather than pre-seeded with the shipped locales. The
 * app now ships fourteen, and a module author is asked for two of them
 * (`REQUIRED_MODULE_LOCALES` in `contracts.js`); anything else it brings is
 * welcome and anything it omits falls back to English, so a locale list here
 * would only be a third place to forget to update.
 */
const registered = {};

/** Folds every installed module's catalogue in. Called once, from index.js. */
export function registerModuleCatalogues(manifests) {
  for (const manifest of manifests) {
    for (const [locale, entries] of Object.entries(manifest.i18n ?? {})) {
      if (!registered[locale]) registered[locale] = {};
      // Core keys win. A module cannot redefine "Save" out from under the app,
      // and a collision is a module's problem to rename rather than a mystery
      // for whoever notices the button changed.
      for (const [key, value] of Object.entries(entries)) {
        if (!(key in registered[locale])) registered[locale][key] = value;
      }
    }
  }
  return registered;
}

/** A key a module brought, or undefined. */
export function moduleString(key, locale = 'en') {
  return registered[locale]?.[key];
}

/** Everything registered, for tests and for the contract check. */
export function moduleCatalogues() {
  return registered;
}
