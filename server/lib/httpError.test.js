import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { english, fail, httpError, failFrom } from './httpError.js';
import en from '../../web/src/i18n/en.js';

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

/** A stand-in for express's `res`, recording what a handler would have sent. */
function fakeRes() {
  const sent = {};
  return {
    sent,
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
}

test('every api.error key a route can emit exists in the catalogue', () => {
  // A typo here is a 404 whose body reads `api.error.transacionNotFound` — no
  // exception, no failing request, just an untranslatable string in a toast.
  const used = new Set();
  for (const file of sources(SERVER)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/'(api\.error\.[A-Za-z.]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 20, `expected to find the keyed error sites, found ${used.size}`);
  for (const key of used) {
    assert.ok(en[key], `${key} is used by a route but missing from en.js`);
  }
});

test('no route still answers with a literal sentence', () => {
  const offenders = [];
  const routes = join(SERVER, 'routes', 'api.js');
  for (const m of readFileSync(routes, 'utf8').matchAll(/res\.status\(\d+\)\.json\(\{\s*error:\s*['"`]([^'"`]+)/g)) {
    offenders.push(m[1]);
  }
  assert.deepEqual(offenders, [], 'these routes bypass fail()/failFrom() and cannot be translated');
});

test('fail() sends the key, the params and an English sentence', () => {
  const res = fakeRes();
  fail(res, 404, 'api.error.transactionNotFound');
  assert.equal(res.sent.status, 404);
  assert.equal(res.sent.body.errorKey, 'api.error.transactionNotFound');
  // `error` stays English prose so anything reading the API directly, or logging
  // err.message, still gets something true.
  assert.equal(res.sent.body.error, 'Movement not found');
});

test('failFrom forwards a key thrown from an engine', () => {
  const res = fakeRes();
  failFrom(res, httpError(400, 'api.error.ruleGone'));
  assert.equal(res.sent.status, 400);
  assert.equal(res.sent.body.errorKey, 'api.error.ruleGone');
});

test('failFrom gives an unkeyed exception the generic key and keeps its message', () => {
  const res = fakeRes();
  failFrom(res, new Error('ENOENT: no such file'));
  assert.equal(res.sent.status, 500);
  assert.equal(res.sent.body.errorKey, 'api.error.unexpected');
  assert.equal(res.sent.body.errorParams.detail, 'ENOENT: no such file');
  assert.match(res.sent.body.error, /ENOENT/);
});

test('english() interpolates and falls back to the key', () => {
  assert.equal(english('api.error.unexpected', { detail: 'boom' }), 'Something went wrong: boom');
  assert.equal(english('api.error.doesNotExist'), 'api.error.doesNotExist');
  // Plural entries resolve through Intl rather than a === 1 check.
  assert.equal(english('format.days', { count: 1 }), '1 day');
  assert.equal(english('format.days', { count: 3 }), '3 days');
});
