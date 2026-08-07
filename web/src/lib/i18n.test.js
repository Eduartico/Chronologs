import test from 'node:test';
import assert from 'node:assert/strict';

import en from '../i18n/en.js';
import pt from '../i18n/pt.js';

/** Every `{placeholder}` in a value, including inside plural categories. */
function placeholders(value) {
  const text = typeof value === 'object' ? Object.values(value).join(' ') : String(value);
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

test('both catalogues carry the same keys', () => {
  const missingPt = Object.keys(en).filter((k) => !(k in pt));
  const extraPt = Object.keys(pt).filter((k) => !(k in en));
  assert.deepEqual(missingPt, [], 'keys in en.js with no pt.js counterpart');
  assert.deepEqual(extraPt, [], 'keys in pt.js that do not exist in en.js — English is the fallback, so these never render');
});

test('no value is empty', () => {
  for (const [name, cat] of [['en', en], ['pt', pt]]) {
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
  for (const key of Object.keys(en)) {
    const wanted = placeholders(en[key]);
    const got = placeholders(pt[key]);
    for (const name of wanted) {
      assert.ok(got.has(name), `pt.${key} is missing {${name}}`);
    }
    for (const name of got) {
      assert.ok(wanted.has(name), `pt.${key} has {${name}}, which en.${key} never supplies`);
    }
  }
});

test('the Portuguese stays pre-AO90', () => {
  // Eduardo writes "transacções", "actualizar", "correcção". That is his register,
  // not a typo, and a well-meaning spellcheck pass would quietly rewrite the whole
  // catalogue. This fails if the post-1990 spellings appear.
  const AO90 = /\b(transaç|atualiz|correç|aç(ão|ões)\b|ót(imo|ima)|conta(c)?to\b)/i;
  const offenders = Object.entries(pt)
    .filter(([, v]) => AO90.test(typeof v === 'object' ? Object.values(v).join(' ') : String(v)))
    .map(([k]) => k);
  assert.deepEqual(offenders, [], 'these pt.js values use post-AO90 spelling');
});

test('plural entries exist on both sides together', () => {
  for (const key of Object.keys(en)) {
    assert.equal(
      typeof en[key] === 'object',
      typeof pt[key] === 'object',
      `${key}: one catalogue treats this as a plural and the other does not`,
    );
  }
});
