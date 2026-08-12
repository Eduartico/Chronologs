import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import en from '../../web/src/i18n/en.js';
import { loadRegistry } from '../framework/registry.js';
import { registerModuleCatalogues } from '../framework/i18n.js';

/**
 * Every notification key must exist in the catalogue.
 *
 * A typo here does not throw. It writes a notification whose title is the literal
 * string `notify.quotes.fetchd.title`, into a file, permanently — and nobody sees
 * it until the bell is opened days later.
 *
 * Keys used to be readable straight off each `notify()` call, and this test read
 * them that way. They no longer all are: the shared ingestion kit takes its
 * wording from the module through a `notifyKeys` object, so the key and the call
 * are in different files by design. Scanning for the *key shape* rather than for
 * the call finds both, and finds a key that was written down and then never
 * wired up — which the old form could not.
 */

const SERVER = fileURLToPath(new URL('..', import.meta.url));
const MODULES = fileURLToPath(new URL('../../modules', import.meta.url));

function sources(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(js|jsx)$/.test(entry) && !entry.endsWith('.test.js')) out.push(full);
  }
  return out;
}

/**
 * Any string literal shaped like a notification key, wherever it is written.
 *
 * `.title` and `.body` are the two halves a key renders as, not keys in their
 * own right — a catalogue file naturally contains both, and counting them as
 * base keys would demand `notify.x.title.title`.
 */
const KEY = /'(notify\.[A-Za-z][\w.]*?)(?:\.(?:title|body))?'/g;

/** `notify('warning', 'notify.some.key', …)` — the second argument. */
const CALL = /\bnotify\(\s*(?:[^,]+),\s*'([^']+)'/g;

function allSources() {
  return [...sources(SERVER), ...sources(MODULES)].filter(
    (file) => !file.endsWith(join('lib', 'notify.js'))
  );
}

test('every notification key has a title and a body in the catalogue', async () => {
  // A module may name its notifications in `modules/<id>/i18n/` rather than in
  // the shipped catalogue, so both are consulted.
  const { modules } = await loadRegistry({ reload: true });
  const contributed = registerModuleCatalogues([...modules.values()]).en;
  const text = (key) => en[key] ?? contributed[key];

  const found = new Map();

  for (const file of allSources()) {
    for (const match of readFileSync(file, 'utf8').matchAll(KEY)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }

  assert.ok(found.size >= 10, `expected to find the notification keys, found ${found.size}`);

  for (const [key, file] of found) {
    assert.ok(text(`${key}.title`), `${file} uses '${key}', which has no ${key}.title in English`);
    assert.ok(text(`${key}.body`), `${file} uses '${key}', which has no ${key}.body in English`);
  }
});

test('no notify() call still passes a literal sentence', () => {
  // The old signature was notify(type, title, body). A key always looks like a
  // key; a sentence never does.
  const offenders = [];
  for (const file of allSources()) {
    for (const match of readFileSync(file, 'utf8').matchAll(CALL)) {
      if (!/^notify\.[a-zA-Z]+(\.[a-zA-Z]+)+$/.test(match[1])) {
        offenders.push(`${file}: ${JSON.stringify(match[1])}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these notify() calls pass prose where a key belongs');
});
