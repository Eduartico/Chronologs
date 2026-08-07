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
    assert.deepEqual(
      loaded[key],
      DEFAULT_SETTINGS[key],
      `loadSettings() dropped "${key}" — add it to the per-key merge in settings.js`,
    );
  }
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
