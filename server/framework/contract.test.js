/**
 * Every installed module, held to the contract.
 *
 * This is what makes `modules/` safe to fork into: someone drops a folder in,
 * runs `npm test`, and is told in a sentence what is wrong with their manifest
 * rather than discovering it as an undefined property three screens into the
 * interface. It also protects the other direction — a change to the framework
 * that quietly breaks the shape every module was written against fails here
 * instead of in production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateManifest, KNOWN_EVENT_TYPES } from './contracts.js';
import { loadRegistry, listModules, MODULES_DIR } from './registry.js';
import { registerModuleCatalogues } from './i18n.js';
// Both catalogues are plain ESM objects precisely so the server can read them;
// see the note at the top of web/src/i18n/index.js.
import en from '../../web/src/i18n/en.js';
import pt from '../../web/src/i18n/pt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const icons = readFileSync(join(__dirname, '..', '..', 'web', 'src', 'components', 'Icon.jsx'), 'utf-8');

test('every module loads without a problem', async () => {
  const { problems } = await loadRegistry({ reload: true });
  assert.deepEqual(problems, []);
});

test('every manifest satisfies the contract', async () => {
  for (const manifest of await listModules()) {
    assert.deepEqual(
      validateManifest(manifest, { folder: manifest.folder }),
      [],
      `module "${manifest.id}"`
    );
  }
});

test('every module names itself with a key both catalogues carry', async () => {
  const modules = await listModules();
  // A module may bring its own strings in `modules/<id>/i18n/` rather than
  // editing a shipped catalogue — that is what makes a module one folder you can
  // copy or delete whole. Both places count, and a key present in only one
  // language shows a raw key on screen in the other.
  const contributed = registerModuleCatalogues(modules);
  const has = (catalogue, extra, key) => catalogue[key] !== undefined || extra[key] !== undefined;

  for (const manifest of modules) {
    const keys = [manifest.label, ...(manifest.configSchema ?? []).map((f) => f.label)].filter(Boolean);
    for (const key of keys) {
      assert.ok(has(en, contributed.en, key), `${manifest.id}: "${key}" has no English text`);
      assert.ok(has(pt, contributed.pt, key), `${manifest.id}: "${key}" has no Portuguese text`);
    }
  }
});

test('a module that brings strings brings them in both languages', async () => {
  for (const manifest of await listModules()) {
    const english = Object.keys(manifest.i18n?.en ?? {});
    const portuguese = new Set(Object.keys(manifest.i18n?.pt ?? {}));
    for (const key of english) {
      assert.ok(portuguese.has(key), `${manifest.id} defines "${key}" in English only`);
    }
  }
});

test('every module picks an icon that exists', async () => {
  for (const manifest of await listModules()) {
    // Icon.jsx is one inline SVG set keyed by name; a name it does not know
    // renders as nothing at all, which reads on screen as a broken layout
    // rather than as a missing icon.
    assert.ok(
      icons.includes(`${manifest.icon}:`) || icons.includes(`'${manifest.icon}'`),
      `module "${manifest.id}" uses icon "${manifest.icon}", which Icon.jsx does not define`
    );
  }
});

test('no module claims to emit an event nothing reads', async () => {
  for (const manifest of await listModules()) {
    for (const type of manifest.emits) {
      assert.ok(KNOWN_EVENT_TYPES.has(type), `${manifest.id} emits unknown "${type}"`);
    }
  }
});

test('a source module offers at least one thing to do', async () => {
  for (const manifest of await listModules()) {
    if (manifest.kind !== 'source') continue;
    const declared = Object.keys(manifest.capabilities).filter((k) => k !== 'actions');
    assert.ok(declared.length > 0, `${manifest.id} declares no capabilities`);
  }
});

test('no module writes a colour of its own', async () => {
  // Every colour in this app resolves from four anchors per theme. A literal in
  // a module is a colour that does not move when the theme does, and there are
  // seventeen themes for it to be wrong in.
  const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  for (const manifest of await listModules()) {
    if (!manifest.folder) continue;
    for (const name of ['module.js', 'ui.jsx']) {
      const file = join(MODULES_DIR, manifest.folder, name);
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf-8');
      for (const [i, line] of source.split('\n').entries()) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
        assert.ok(!literal.test(line), `${manifest.folder}/${name}:${i + 1} writes a colour literal`);
      }
    }
  }
});

test('the two modules this app was built around are installed and configured', async () => {
  const ids = (await listModules()).map((m) => m.id).sort();
  // Not a general rule for forks — a fork is expected to delete these. It is a
  // check that *this* repository still ships what its ledger is full of, since
  // an instance whose module is missing cannot sync, reparse or be configured.
  assert.ok(ids.includes('activobank'), 'the activobank module is gone');
  assert.ok(ids.includes('pricempire'), 'the pricempire module is gone');
});
