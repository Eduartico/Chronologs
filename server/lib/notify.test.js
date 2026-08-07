import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import en from '../../web/src/i18n/en.js';

/**
 * Every key passed to `notify()` must exist in the catalogue.
 *
 * A typo here does not throw. It writes a notification whose title is the literal
 * string `notify.quotes.fetchd.title`, into a file, permanently — and nobody sees
 * it until the bell is opened days later. Since the keys are string literals at
 * every call site, they can simply be read out of the source.
 */

const SERVER = fileURLToPath(new URL('..', import.meta.url));

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full);
  }
  return out;
}

/** `notify('warning', 'notify.some.key', …)` — the second argument. */
const CALL = /\bnotify\(\s*(?:[^,]+),\s*'([^']+)'/g;

test('every notify() key has a title and a body in the catalogue', () => {
  const found = new Set();

  for (const file of sources(SERVER)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith(join('lib', 'notify.js'))) continue;
    for (const match of source.matchAll(CALL)) found.add(match[1]);
  }

  assert.ok(found.size >= 10, `expected to find the notify() call sites, found ${found.size}`);

  for (const key of found) {
    assert.ok(en[`${key}.title`], `notify('…', '${key}') has no ${key}.title in en.js`);
    assert.ok(en[`${key}.body`], `notify('…', '${key}') has no ${key}.body in en.js`);
  }
});

test('no notify() call still passes a literal sentence', () => {
  // The old signature was notify(type, title, body). A key always looks like a
  // key; a sentence never does.
  const offenders = [];
  for (const file of sources(SERVER)) {
    if (file.endsWith(join('lib', 'notify.js'))) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(CALL)) {
      if (!/^notify\.[a-zA-Z]+(\.[a-zA-Z]+)+$/.test(match[1])) {
        offenders.push(`${file}: ${JSON.stringify(match[1])}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these notify() calls pass prose where a key belongs');
});
