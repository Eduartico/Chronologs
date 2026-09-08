import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir, ext = /\.jsx$/) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full, ext));
    else if (ext.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/**
 * `t()` at module scope is the failure that took the whole app down.
 *
 * A column descriptor written as `const COLUMNS = [{ label: t('x') }]` looks
 * fine, builds fine, and throws `t is not defined` at *import* time — before any
 * provider mounts, so nothing renders at all and the stack points at a file that
 * seems unrelated to what you were editing. It happened twice while the pages
 * were being translated.
 *
 * The fix in both cases was to make the descriptor a function of `t`, called from
 * inside the component. This test is what stops the third time.
 */
test('no module-scope t() call in a component file', () => {
  const offenders = [];

  for (const file of sources(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let depth = 0;
    lines.forEach((line, i) => {
      const stripped = line.replace(/\/\/.*$/, '');
      // A t() call while no brace is open is at module scope. `(t) =>` and
      // `function f(t)` re-bind it as a parameter, which is the sanctioned shape.
      if (depth === 0 && /[^.\w]t\(['"`]/.test(stripped) && !/\(\s*t\s*\)\s*=>|\bfunction \w+\([^)]*\bt\b/.test(stripped)) {
        offenders.push(`${file.slice(SRC.length)}:${i + 1}  ${stripped.trim().slice(0, 70)}`);
      }
      depth += (stripped.match(/[{([]/g) || []).length - (stripped.match(/[})\]]/g) || []).length;
      if (depth < 0) depth = 0;
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'these call t() at module scope, which runs at import time.\n' +
      'Make the surrounding constant a function of `t` and call it from the component.',
  );
});

/**
 * `get: (t) => t.amount` shadowed the translator in Transactions.jsx, which is
 * how a working file broke the moment a label beside it became `t('…')`.
 */
test('no row accessor names its parameter `t`', () => {
  const offenders = [];
  for (const file of sources(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/\bget:\s*\(\s*t\s*\)\s*=>/.test(line)) {
          offenders.push(`${file.slice(SRC.length)}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(offenders, [], 'rename the parameter to `row` — `t` is the translator');
});

/**
 * A callback parameter named `t` shadows the translator for the whole callback
 * body — and JSX callbacks are exactly where `t('…')` gets used.
 *
 * `{g.transactions.map((t) => <button title={t('duplicates.keepOnlyThis')} …>)}`
 * builds, type-checks as far as anything here does, and throws
 * `t is not a function` the moment the list is non-empty. That took the whole
 * Duplicates page down; Rules and Travel carried the same shape, waiting for a
 * text condition and a rejected proposal respectively.
 *
 * The rule is narrow on purpose: `.map((t) => t.id)` with no translation in it
 * is harmless and stays legal. Only a `t('…')` call *inside* a callback that
 * rebound `t` is an error.
 */
test('no callback shadows the translator and then calls it', () => {
  const CALLBACK = /\.\s*(map|filter|find|forEach|some|every|flatMap|sort|reduce)\(\s*\(?\s*t\s*[,)]/;
  const offenders = [];

  for (const file of sources(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!CALLBACK.test(line)) return;
      let depth = 0;
      let opened = false;
      for (let j = i; j < lines.length; j++) {
        const text = j === i ? lines[j].slice(lines[j].search(CALLBACK)) : lines[j];
        const probe = j === i ? text.replace(CALLBACK, '') : text;
        if (/[^.\w]t\(['"`]/.test(probe)) {
          offenders.push(`${file.slice(SRC.length)}:${j + 1}  ${lines[j].trim().slice(0, 70)}`);
        }
        for (const ch of text) {
          if ('([{'.includes(ch)) {
            depth++;
            opened = true;
          } else if (')]}'.includes(ch)) depth--;
        }
        if (opened && depth <= 0) break;
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'these call t() inside a callback whose parameter is also named `t`.\n' +
      'Rename the parameter (`tx`, `row`, `cond`) — `t` is the translator.',
  );
});
