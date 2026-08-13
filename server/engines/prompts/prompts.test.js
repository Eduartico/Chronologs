import test from 'node:test';
import assert from 'node:assert/strict';

import { pick, normaliseVerdict } from './index.js';
import { LOCALES } from '../../../web/src/lib/locale.js';

/**
 * The verdict enum is the one place the bilingual prompts can fail silently.
 *
 * `advisor.js` used to read anything that was not exactly the string "discordo"
 * as agreement. Under an English prompt a model will sometimes answer "disagree"
 * however clearly it was told to copy the Portuguese literal — and that answer
 * would have been recorded as a yes, in a feature whose entire purpose is to say
 * whether it agrees. Nobody would have noticed for weeks.
 */

test('recognises the contract tokens in both languages', () => {
  for (const yes of ['concordo', 'Concordo', ' CONCORDO ', 'agree', 'yes', 'true', 'sim']) {
    assert.equal(normaliseVerdict(yes), 'concordo', yes);
  }
  for (const no of ['discordo', 'Discordo', 'disagree', 'no', 'false', 'não', 'nao']) {
    assert.equal(normaliseVerdict(no), 'discordo', no);
  }
});

test('refuses to guess at anything else', () => {
  // Returning null, not a default — a caller that wants to fall back can, but the
  // ambiguity is visible rather than resolved by accident.
  for (const junk of ['maybe', '', null, undefined, 42, 'concordo-ish']) {
    assert.equal(normaliseVerdict(junk), null, String(junk));
  }
});

test('every prompt family builds in every shipped language', () => {
  for (const name of ['advisor', 'classify', 'ruleSuggest']) {
    for (const locale of Object.keys(LOCALES)) {
      assert.equal(typeof pick(name, locale), 'function', `${name}.${locale}`);
    }
  }
  // A locale the app does not ship at all is the only case that gets English
  // untouched — there is no language name to ask the model for.
  assert.equal(pick('advisor', 'kl'), pick('advisor', 'en'), 'an unknown locale falls back to English');
});

test('a locale with no prompt file of its own asks for its language by name', () => {
  const args = {
    categories: ['food'],
    rejections: [],
    collapses: [],
    ambiguous: [],
    shadowed: [],
    anomalies: [],
  };
  const german = pick('advisor', 'de')(args);
  assert.match(german, /write every human-readable sentence in Deutsch/);
  // …and the wire format survives being asked for another language, which is the
  // whole risk of doing this at all.
  assert.match(german, /"concordo"/);
  assert.match(german, /"discordo"/);
  assert.match(german, /Copy them\s*\n?\s*exactly/);

  // Portuguese has its own prompt file, so it is handed over untouched.
  assert.equal(pick('advisor', 'pt'), pick('advisor', 'pt'));
  assert.doesNotMatch(pick('advisor', 'pt')(args), /LANGUAGE: write every human-readable sentence/);
});

test('the English advisor prompt still speaks the Portuguese wire format', () => {
  // If these ever get translated, the parser breaks in a way no test downstream
  // would catch, because the model would answer perfectly — in the wrong schema.
  const prompt = pick('advisor', 'en')({
    categories: ['food'],
    rejections: [],
    collapses: [],
    ambiguous: [],
    shadowed: [],
    anomalies: [],
  });
  for (const token of ['"concordo"', '"discordo"', 'nivel', 'raiz', 'mudariaCategoriaA', 'tapadaPor', 'duranteViagem']) {
    assert.ok(prompt.includes(token), `the English prompt no longer mentions ${token}`);
  }
});

test('the Portuguese advisor prompt asks for the same JSON shape', () => {
  const prompt = pick('advisor', 'pt')({
    categories: ['food'],
    rejections: [],
    collapses: [],
    ambiguous: [],
    shadowed: [],
    anomalies: [],
  });
  assert.ok(prompt.includes('"findings"'));
  assert.ok(prompt.includes('"concordo"'));
});
