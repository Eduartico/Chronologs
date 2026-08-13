import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { EXPERIMENTS, EXPERIMENT_IDS, allOn } from '../experiments.js';
import { DEFAULT_SETTINGS } from '../../../server/lib/settings.js';

/*
 * The registry, the server's defaults and the catalogues are three lists that
 * have to agree, and nothing in the running app forces them to: a flag added to
 * `experiments.js` alone renders a switch with a raw dotted key on it and never
 * persists, because `loadSettings` drops what its defaults do not name. This is
 * the test that ties the three together.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const catalogues = {};
for (const file of readdirSync(join(SRC, 'i18n', 'locales')).filter((f) => f.endsWith('.js'))) {
  catalogues[file.replace(/\.js$/, '')] = (await import(pathToFileURL(join(SRC, 'i18n', 'locales', file)).href)).default;
}

test('every experiment has a server-side default, and every default an experiment', () => {
  assert.deepEqual(
    EXPERIMENT_IDS.slice().sort(),
    Object.keys(DEFAULT_SETTINGS.experimental).sort(),
    'web/src/experiments.js and DEFAULT_SETTINGS.experimental name different things',
  );
});

test('the shipped defaults are all off', () => {
  // Someone installing this should get the finished app. Eduardo's own
  // user-data/state/settings.json turns them on; that is a data fact, not a
  // default, and the distinction is the whole point of having defaults.
  for (const [id, value] of Object.entries(DEFAULT_SETTINGS.experimental)) {
    assert.equal(value, false, `${id} ships switched on`);
  }
});

test('every experiment has a label and a sentence in every language', () => {
  for (const [code, cat] of Object.entries(catalogues)) {
    for (const id of EXPERIMENT_IDS) {
      assert.ok(cat[`settings.experimental.${id}.label`], `${code} has no label for ${id}`);
      assert.ok(cat[`settings.experimental.${id}.help`], `${code} has no help text for ${id}`);
    }
    for (const surface of new Set(EXPERIMENTS.map((e) => e.surface))) {
      assert.ok(
        cat[`settings.experimental.surface.${surface}`],
        `${code} does not say where the "${surface}" experiments appear`,
      );
    }
  }
});

test('every experiment picks an icon Icon.jsx actually draws', () => {
  // A name Icon.jsx does not know renders as nothing at all, which reads on
  // screen as a broken layout rather than as a missing icon.
  const icons = readFileSync(join(SRC, 'components', 'Icon.jsx'), 'utf-8');
  for (const experiment of EXPERIMENTS) {
    assert.match(icons, new RegExp(`\\b${experiment.icon}:`), `Icon.jsx has no "${experiment.icon}"`);
  }
});

test('every experiment declares a surface that a page actually hosts', () => {
  const hosts = { dashboard: 'pages/Dashboard.jsx', accounts: 'pages/Accounts.jsx' };
  for (const experiment of EXPERIMENTS) {
    const page = hosts[experiment.surface];
    assert.ok(page, `no page is declared for the "${experiment.surface}" surface`);
    const source = readFileSync(join(SRC, page), 'utf-8');
    assert.match(
      source,
      new RegExp(`flags\\.${experiment.id}\\b`),
      `${page} never checks flags.${experiment.id}, so the switch would do nothing`,
    );
  }
});

test('ids are unique and allOn covers every one of them', () => {
  assert.equal(new Set(EXPERIMENT_IDS).size, EXPERIMENT_IDS.length);
  assert.deepEqual(Object.keys(allOn()).sort(), EXPERIMENT_IDS.slice().sort());
  assert.ok(Object.values(allOn()).every((v) => v === true));
  assert.ok(Object.values(allOn(false)).every((v) => v === false));
});
