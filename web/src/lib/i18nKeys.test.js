import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Every `t('key')` written in the source resolves to something in the catalogue.
 *
 * `i18n.test.js` holds the fourteen catalogues to each other, which catches a
 * key that exists in English and nowhere else. It cannot catch the other
 * direction: a key that a component asks for and no catalogue has. `t()` falls
 * back to returning the key itself, so the failure is a raw dotted string sitting
 * on screen where a sentence should be — and it survives every test, the build,
 * and a quick look at a page that happens not to render that particular card.
 *
 * This became worth writing while renaming the dashboard's cards, which moved
 * around fifty keys at once and left several call sites pointing at names that
 * no longer existed.
 *
 * Only literal keys are checked. `t(\`view.${name}\`)` is built at runtime and
 * cannot be resolved from the source text; the catalogue tests in
 * `dashboard.test.js` cover the interpolated families this app actually has, by
 * iterating the registry that supplies the names.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const en = (await import(pathToFileURL(join(SRC, 'i18n', 'locales', 'en.js')).href)).default;

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // The catalogues themselves quote keys constantly; they are the answer,
      // not a question.
      if (entry !== 'locales') out.push(...sources(path));
    } else if (/\.jsx?$/.test(path) && !path.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

test('every literal t() key in the source exists in the catalogue', () => {
  const missing = new Map();

  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf-8');
    for (const match of text.matchAll(/\b(?:t|tx)\(\s*'([^']+)'/g)) {
      const key = match[1];
      if (key in en) continue;
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(relative(SRC, file).replace(/\\/g, '/'));
    }
  }

  assert.deepEqual(
    [...missing].map(([key, files]) => `${key} — asked for by ${[...files].join(', ')}`),
    [],
    'these keys would render as their own raw dotted name',
  );
});
