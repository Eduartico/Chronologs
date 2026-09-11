import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The merge in loadSettings() lists every top-level object by hand. A forgotten
 * line does not throw — it silently drops that whole section on the next partial
 * save, and the user sees a setting that "won't stick" with no error anywhere.
 * These tests are what makes that impossible to ship.
 *
 * The data directory is pointed at a temp folder *before* anything imports
 * paths.js, because that module reads CHRONOLOGS_DATA_DIR once, at load. Hence
 * the dynamic imports below — a static one would be hoisted above this line and
 * the tests would quietly run against the real user-data.
 */
const DIR = mkdtempSync(join(tmpdir(), 'chronologs-settings-'));
process.env.CHRONOLOGS_DATA_DIR = DIR;
mkdirSync(join(DIR, 'state'), { recursive: true });

const settingsFile = join(DIR, 'state', 'settings.json');
const write = (contents) => writeFileSync(settingsFile, JSON.stringify(contents), 'utf-8');

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test('a settings file with only a version still yields every default', async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await import('./settings.js');
  write({ version: 1 });
  const loaded = loadSettings();
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    // `currency.rates` is the one derived value: it is empty in the defaults and
    // seeded from `usdToEur` on read, so that an installation upgrading from the
    // old scalar keeps *its* rate rather than the shipped one. Everything else
    // must come back exactly as declared — this loop is what makes a forgotten
    // line in the per-key merge impossible to ship.
    const [got, want] =
      key === 'currency'
        ? [{ ...loaded[key], rates: undefined }, { ...DEFAULT_SETTINGS[key], rates: undefined }]
        : [loaded[key], DEFAULT_SETTINGS[key]];
    assert.deepEqual(got, want, `loadSettings() dropped "${key}" — add it to the per-key merge in settings.js`);
  }
  assert.deepEqual(
    loaded.currency.rates,
    { USD: DEFAULT_SETTINGS.currency.usdToEur },
    'a fresh install still starts with the dollar rate the scalar carries',
  );
});

test('a partial write of one section keeps the rest of that section', async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await import('./settings.js');
  write({ version: 1, appearance: { theme: 'jacarina' } });
  const loaded = loadSettings();
  assert.equal(loaded.appearance.theme, 'jacarina');
  assert.equal(loaded.appearance.locale, DEFAULT_SETTINGS.appearance.locale, 'the rest of appearance must survive');
  assert.equal(loaded.appearance.finance, 'standard');
});

test('the locale helper answers from the stored appearance', async () => {
  const { currentLocale } = await import('./settings.js');
  write({ version: 1, appearance: { locale: 'pt' } });
  assert.equal(currentLocale(), 'pt');
  write({ version: 1 });
  assert.equal(currentLocale(), 'en');
});

test('the shipped default language is English', async () => {
  // Eduardo's own user-data says `pt`; that is a data fact, not a code branch.
  const { DEFAULT_SETTINGS } = await import('./settings.js');
  assert.equal(DEFAULT_SETTINGS.appearance.locale, 'en');
  assert.equal(DEFAULT_SETTINGS.appearance.theme, 'guardian');
});

test('appearance never stores the flags that are properties of the theme', async () => {
  // mode / panel / ramp are looked up from themes.js. Storing them would let a
  // hand-edited file describe a theme that cannot exist.
  const { DEFAULT_SETTINGS } = await import('./settings.js');
  for (const derived of ['mode', 'panel', 'ramp']) {
    assert.ok(!(derived in DEFAULT_SETTINGS.appearance), `appearance must not store "${derived}"`);
  }
});

test('every theme the appearance default names actually exists', async () => {
  const { DEFAULT_SETTINGS } = await import('./settings.js');
  const { themeById } = await import('../../web/src/styles/themes.js');
  assert.equal(themeById(DEFAULT_SETTINGS.appearance.theme).id, DEFAULT_SETTINGS.appearance.theme);
});

/* ---- the currency migration ------------------------------------------------
   Conversion went from one scalar to a table against the euro pivot. The one
   thing that must not happen is an existing installation reading differently
   afterwards, so the scalar becomes the table's dollar row on load rather than
   asking anyone to re-enter it. */

test('a settings file written before the rate table keeps its dollar rate', async () => {
  const { loadSettings } = await import('./settings.js');
  write({ version: 1, currency: { base: 'EUR', usdToEur: 0.865876, autoRate: true, rateFetchedAt: '2026-08-06T06:34:21.194Z' } });
  const { currency } = loadSettings();

  assert.equal(currency.rates.USD, 0.865876, 'the old scalar is the table’s dollar row');
  assert.equal(currency.usdToEur, 0.865876, 'and is still written, so a rollback reads its own file');
  assert.deepEqual(currency.manual, {}, 'nothing is silently treated as hand-entered');
  assert.equal(currency.autoRate, true, 'the rest of the section survives the migration');
});

test('the pivot is never stored as a rate against itself', async () => {
  const { loadSettings } = await import('./settings.js');
  // A hand-edited file could put one here, and a EUR row that is not exactly 1
  // would rescale every amount in the ledger without anything saying so.
  write({ version: 1, currency: { base: 'EUR', rates: { EUR: 1.5, USD: 0.9 }, manual: { EUR: 2 } } });
  const { currency } = loadSettings();

  assert.equal(currency.rates.EUR, undefined);
  assert.equal(currency.manual.EUR, undefined);
  assert.equal(currency.rates.USD, 0.9, 'the currencies that are not the pivot are left alone');
});

test('a file already carrying the table is not re-migrated over', async () => {
  const { loadSettings } = await import('./settings.js');
  write({ version: 1, currency: { base: 'JPY', rates: { USD: 0.91, JPY: 0.0061 }, manual: { JPY: 0.0062 }, usdToEur: 0.5 } });
  const { currency } = loadSettings();

  assert.equal(currency.rates.USD, 0.91, 'the stale scalar does not overwrite a fetched rate');
  assert.equal(currency.manual.JPY, 0.0062, 'a hand-typed rate survives a reload');
  assert.equal(currency.base, 'JPY');
});

/* ---- the dashboard layout --------------------------------------------------
   The one section that is a list rather than a set of flags, and the one a user
   edits constantly. Its failure mode is the same as every other section's — a
   forgotten merge line drops it on the next partial save — but louder, because
   losing it means losing an arrangement someone built by hand. */

test('a stored dashboard layout wins over the shipped one entirely', async () => {
  const { loadSettings } = await import('./settings.js');
  // Not merged element-by-element: a layout is an ordered list, and laying the
  // defaults under it would resurrect nodes the reader deleted.
  write({ version: 1, dashboard: { nodes: [{ id: 'a', widget: 'breakdown', view: 'table', size: 2 }] } });
  const { dashboard } = loadSettings();

  assert.equal(dashboard.nodes.length, 1, 'the shipped nodes do not come back underneath');
  assert.deepEqual(dashboard.nodes[0], { id: 'a', widget: 'breakdown', view: 'table', size: 2 });
});

test('an empty dashboard is a layout, not a missing one', async () => {
  const { loadSettings } = await import('./settings.js');
  // Removing every card is a thing someone can do, and the next load must not
  // helpfully put six back.
  write({ version: 1, dashboard: { nodes: [] } });
  assert.deepEqual(loadSettings().dashboard.nodes, []);
});

test('a settings file written before the dashboard existed gets the shipped one', async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await import('./settings.js');
  write({ version: 1, appearance: { theme: 'jacarina' } });
  assert.deepEqual(loadSettings().dashboard, DEFAULT_SETTINGS.dashboard);
});

test('every shipped node is well formed and names a widget once each', async () => {
  const { DEFAULT_SETTINGS } = await import('./settings.js');
  const ids = new Set();
  for (const node of DEFAULT_SETTINGS.dashboard.nodes) {
    assert.ok(node.id && !ids.has(node.id), `duplicate or missing node id: ${node.id}`);
    ids.add(node.id);
    assert.equal(typeof node.widget, 'string');
    assert.equal(typeof node.view, 'string');
    // The names in web/src/dashboard/catalogue.js. The server never resolves a
    // size, but it does ship six of them, and a shipped layout naming a width
    // the client has to fall back from is a default that was never looked at.
    assert.ok(
      ['quarter', 'third', 'half', 'twoThirds', 'full', 'tall'].includes(node.size),
      `node ${node.id} has size ${node.size}`,
    );
  }
});

test('the shipped layout is not one user’s layout', async () => {
  const { DEFAULT_SETTINGS } = await import('./settings.js');
  // Someone installing this gets a plain six-card dashboard. The longer list
  // with duplicate nodes lives in user-data, which is the distinction the whole
  // defaults/user-data split exists for.
  assert.equal(DEFAULT_SETTINGS.dashboard.nodes.length, 6);
  const widgets = DEFAULT_SETTINGS.dashboard.nodes.map((n) => n.widget);
  assert.equal(new Set(widgets).size, widgets.length, 'the shipped default has no duplicate cards');
});
