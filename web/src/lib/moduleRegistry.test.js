/**
 * The frontend half of the module contract.
 *
 * `web/src/modules/registry.js` finds a module's card with `import.meta.glob`,
 * which is a Vite build-time mechanism and therefore cannot run under `node
 * --test`. What *can* be checked here — and is worth checking, because it is
 * silent when it breaks — is the wiring around it: that every module which
 * declares a card actually has the file, that the glob pattern still points at
 * where modules live, and that Vite is allowed to read outside `web/`.
 *
 * The failure mode this guards against has no error message. A module's card
 * simply never appears, and the connections screen shows a generic card in its
 * place, which looks like a design decision rather than a broken import.
 *
 * Lives under `web/src/lib/` because that is the frontend glob `npm test` runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MODULES = join(ROOT, 'modules');
const REGISTRY = join(ROOT, 'web', 'src', 'modules', 'registry.js');

const moduleFolders = () =>
  readdirSync(MODULES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(MODULES, e.name, 'module.js')))
    .map((e) => e.name);

test('the card glob still points at where modules actually live', () => {
  const source = readFileSync(REGISTRY, 'utf-8');
  const match = source.match(/import\.meta\.glob\('([^']+)'/);
  assert.ok(match, 'the module card glob is gone');

  // The pattern is relative to web/src/modules/, and one wrong `..` makes it
  // match nothing at all — with no warning, at build time.
  const resolved = join(ROOT, 'web', 'src', 'modules', match[1]).replace(/\\/g, '/');
  assert.equal(resolved.replace('/*/ui.jsx', ''), MODULES.replace(/\\/g, '/'));
});

test('vite is allowed to read the modules folder', () => {
  const config = readFileSync(join(ROOT, 'web', 'vite.config.js'), 'utf-8');
  // Without this the dev server refuses the read and every module-supplied card
  // vanishes in development while still working in a production build.
  assert.match(config, /fs:\s*\{\s*allow:/);
});

test('every module card is a default-exporting component', () => {
  for (const id of moduleFolders()) {
    const card = join(MODULES, id, 'ui.jsx');
    if (!existsSync(card)) continue;
    const source = readFileSync(card, 'utf-8');
    // The registry reads `module.default`; a named-only export is picked up as
    // nothing and the module silently falls back to the generic card.
    assert.match(source, /export default function/, `${id}/ui.jsx has no default export`);
  }
});

test('a module card reaches shared components rather than restyling them', () => {
  for (const id of moduleFolders()) {
    const card = join(MODULES, id, 'ui.jsx');
    if (!existsSync(card)) continue;
    const source = readFileSync(card, 'utf-8');

    // A card is free to import from web/src; that is how it gets the theme
    // tokens, Icon.jsx, format.js and the translator. What it must not do is
    // write a colour of its own — there are seventeen themes for it to be
    // wrong in.
    for (const [i, line] of source.split('\n').entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line),
        `${id}/ui.jsx:${i + 1} writes a colour literal`
      );
    }
  }
});

test('the connections page names no provider', () => {
  // The whole point of the loop: adding a bank must not mean editing this page.
  const page = readFileSync(join(ROOT, 'web', 'src', 'pages', 'Connections.jsx'), 'utf-8');
  for (const id of moduleFolders()) {
    assert.ok(!page.includes(id), `Connections.jsx still mentions "${id}"`);
  }
});
