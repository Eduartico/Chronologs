import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

import { LOCALES, DEFAULT_LOCALE } from './locale.js';

/*
 * Every catalogue against English.
 *
 * This used to be an `en` ↔ `pt` pairwise comparison with both files imported at
 * the top. With fourteen languages that shape does not scale and, worse, it
 * quietly stops covering the twelve it does not name. So the catalogues are read
 * off disk — the same directory `web/src/i18n/index.js` globs — and every one of
 * them is held to the shipped English file.
 *
 * The catalogues cannot be reached through `i18n/index.js` here: that module
 * uses `import.meta.glob`, which is Vite's and not Node's. Reading the directory
 * is the equivalent, and it means a locale file that exists but was never added
 * to `LOCALES` still gets caught, by the first test below.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'locales');

const catalogues = {};
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
  const code = file.replace(/\.js$/, '');
  catalogues[code] = (await import(pathToFileURL(join(DIR, file)).href)).default;
}

const en = catalogues[DEFAULT_LOCALE];
const others = Object.entries(catalogues).filter(([code]) => code !== DEFAULT_LOCALE);

/** Every `{placeholder}` in a value, including inside plural categories. */
function placeholders(value) {
  const text = typeof value === 'object' ? Object.values(value).join(' ') : String(value);
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

test('the locale registry and the catalogue files agree', () => {
  // A file with no registry entry is unreachable — nothing can select it. A
  // registry entry with no file silently renders the whole app in English.
  const onDisk = Object.keys(catalogues).sort();
  const declared = Object.keys(LOCALES).sort();
  assert.deepEqual(onDisk, declared, 'i18n/locales/*.js and LOCALES in lib/locale.js differ');
});

test('every locale tag is one Intl actually supports', () => {
  for (const [code, entry] of Object.entries(LOCALES)) {
    assert.equal(
      Intl.NumberFormat.supportedLocalesOf([entry.tag]).length,
      1,
      `${code}: "${entry.tag}" is not a locale this runtime can format with`,
    );
    assert.ok(entry.name?.trim(), `${code} has no endonym, so the picker would render a blank option`);
    assert.ok(entry.firstDay === 0 || entry.firstDay === 1, `${code}.firstDay must be 0 (Sunday) or 1 (Monday)`);
  }
});

test('every catalogue carries exactly the English keys', () => {
  for (const [code, cat] of others) {
    const missing = Object.keys(en).filter((k) => !(k in cat));
    const extra = Object.keys(cat).filter((k) => !(k in en));
    assert.deepEqual(missing, [], `keys in en.js with no ${code}.js counterpart`);
    assert.deepEqual(
      extra,
      [],
      `keys in ${code}.js that do not exist in en.js — English is the fallback, so these never render`,
    );
  }
});

test('no value is empty', () => {
  for (const [name, cat] of Object.entries(catalogues)) {
    for (const [key, value] of Object.entries(cat)) {
      if (typeof value === 'object') {
        assert.ok(value.other, `${name}.${key}: a plural entry must at least have "other"`);
        for (const [category, text] of Object.entries(value)) {
          assert.ok(String(text).trim(), `${name}.${key}.${category} is empty`);
        }
      } else {
        assert.ok(String(value).trim(), `${name}.${key} is empty`);
      }
    }
  }
});

test('a translation keeps every placeholder its English original has', () => {
  // Dropping {count} does not throw — it renders a sentence with a hole in it.
  for (const [code, cat] of others) {
    for (const key of Object.keys(en)) {
      const wanted = placeholders(en[key]);
      const got = placeholders(cat[key]);
      for (const name of wanted) {
        assert.ok(got.has(name), `${code}.${key} is missing {${name}}`);
      }
      for (const name of got) {
        assert.ok(wanted.has(name), `${code}.${key} has {${name}}, which en.${key} never supplies`);
      }
    }
  }
});

test('the Portuguese stays pre-AO90', () => {
  // Eduardo writes "transacções", "actualizar", "correcção". That is his register,
  // not a typo, and a well-meaning spellcheck pass would quietly rewrite the whole
  // catalogue. This fails if the post-1990 spellings appear.
  //
  // Scoped to `pt` on purpose and permanently: it is a fact about one catalogue,
  // and pointing it at the others would flag correct Spanish and correct
  // Brazilian Portuguese as errors.
  const AO90 = /\b(transaç|atualiz|correç|aç(ão|ões)\b|ót(imo|ima)|conta(c)?to\b)/i;
  const offenders = Object.entries(catalogues.pt)
    .filter(([, v]) => AO90.test(typeof v === 'object' ? Object.values(v).join(' ') : String(v)))
    .map(([k]) => k);
  assert.deepEqual(offenders, [], 'these pt.js values use post-AO90 spelling');
});

test('a plural in English is a plural everywhere', () => {
  for (const [code, cat] of others) {
    for (const key of Object.keys(en)) {
      assert.equal(
        typeof en[key] === 'object',
        typeof cat[key] === 'object',
        `${key}: en and ${code} disagree about whether this is a plural`,
      );
    }
  }
});

/*
 * The counts this app can actually put in front of a plural: days in a trip,
 * unread notifications, hidden chart series. Nothing here counts to a million.
 *
 * That matters, because CLDR's category list is not the same as the set a
 * catalogue has to fill. European Portuguese formally has a `many`, but it is
 * selected only for exact millions — demanding it would mean writing "1000000
 * dias" five times to satisfy a case no screen can reach. Deriving the required
 * set from real counts instead pulls in Russian's and Polish's `few` and `many`,
 * which absolutely are reachable, and leaves out the ceremonial ones.
 */
const REAL_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 14, 21, 22, 25, 31, 100, 101, 365, 1000];

test('a plural entry carries every category its language can actually select', () => {
  /*
   * The test that earns its keep once there are more than two languages.
   *
   * A `{ one, other }` pasted straight into ru.js builds, passes every other
   * check here, and then renders "5 дня" — wrong in a way nobody reviewing the
   * English would ever see. `Intl.PluralRules` already knows the right answer
   * for every locale, so the catalogue is held to it rather than to a habit
   * carried over from English.
   */
  for (const [code, cat] of Object.entries(catalogues)) {
    const rules = new Intl.PluralRules(LOCALES[code].tag);
    const reachable = new Set(REAL_COUNTS.map((n) => rules.select(n)));
    const allowed = new Set(rules.resolvedOptions().pluralCategories);
    for (const [key, value] of Object.entries(cat)) {
      if (typeof value !== 'object') continue;
      const got = new Set(Object.keys(value));
      for (const category of reachable) {
        assert.ok(got.has(category), `${code}.${key} has no "${category}" form, which ${LOCALES[code].tag} needs`);
      }
      for (const category of got) {
        assert.ok(allowed.has(category), `${code}.${key} has a "${category}" form, which ${LOCALES[code].tag} never selects`);
      }
    }
  }
});
