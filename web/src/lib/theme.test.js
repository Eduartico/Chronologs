import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpolate, differenceCiede2000, formatHex, parse } from 'culori';

import { MIX, INTERMEDIATE, PANEL_MIX, GUARDIAN_FROZEN, DELTA_E_BUDGET, mixCss } from '../styles/derive.js';
import { THEMES, themeById, DEFAULT_THEME } from '../styles/themes.js';

const de = differenceCiede2000();
const TOKENS_CSS = new URL('../styles/tokens.css', import.meta.url);

/** `color-mix(in oklab, base p%, toward)` is a lerp at t = 1 − p. */
const mix = (base, toward, pct) => interpolate([base, toward], 'oklab')(1 - pct / 100);

function derive(anchors) {
  const c = { ...anchors };
  for (const [name, spec] of Object.entries(INTERMEDIATE)) c[name.slice(2)] = mix(c[spec.base], c[spec.toward], spec.pct);
  const out = {};
  for (const [token, spec] of Object.entries(MIX)) out[token] = mix(c[spec.base], c[spec.toward], spec.pct);
  return out;
}

test('Guardian derives back to its frozen palette', () => {
  const derived = derive(themeById('guardian').anchors);
  for (const [token, frozen] of Object.entries(GUARDIAN_FROZEN)) {
    const d = de(derived[token], frozen);
    assert.ok(
      d <= DELTA_E_BUDGET,
      `${token}: derived ${formatHex(derived[token])} is ΔE2000 ${d.toFixed(2)} from the frozen ${frozen} ` +
        `(budget ${DELTA_E_BUDGET}). Re-fit with: node scripts/tune_derivation.js`,
    );
  }
});

test('every theme declares four parseable anchors and valid flags', () => {
  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(theme.anchors).sort(), ['accent', 'bg', 'ink', 'panel'], `${theme.id} anchors`);
    for (const [k, v] of Object.entries(theme.anchors)) {
      assert.ok(parse(v), `${theme.id}.${k} is not a colour: ${v}`);
    }
    assert.ok(['light', 'dark'].includes(theme.mode), `${theme.id}.mode`);
    assert.ok(['light', 'dark'].includes(theme.panel), `${theme.id}.panel`);
  }
});

test('theme ids are unique and the default exists', () => {
  const ids = THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate theme id');
  assert.ok(ids.includes(DEFAULT_THEME));
  assert.equal(themeById('a-theme-that-was-renamed').id, DEFAULT_THEME, 'unknown id must fall back, never render unstyled');
});

test('a theme flagged dark has a dark background, and light a light one', () => {
  // Guards against a paste error putting light-mode shadows on a black page.
  for (const theme of THEMES) {
    const { r, g, b } = parse(theme.anchors.bg);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.equal(lum > 0.5 ? 'light' : 'dark', theme.mode, `${theme.id} bg ${theme.anchors.bg} contradicts mode=${theme.mode}`);
  }
});

test('the ink anchor is readable on its own background', () => {
  // Body text is the one thing no derivation can rescue, so it is checked at the source.
  const rel = (c) => {
    const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const { r, g, b } = parse(c);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  for (const theme of THEMES) {
    const [a, b] = [rel(theme.anchors.ink), rel(theme.anchors.bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    assert.ok(ratio >= 4.5, `${theme.id}: ink on bg is ${ratio.toFixed(2)}:1, below the 4.5:1 body-text floor`);
  }
});

test('tokens.css spells every derived token exactly as derive.js says', () => {
  // The stylesheet is written by hand from the table; this is what stops the two
  // drifting the way chartTheme.js drifted from --surface-1.
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const collapse = (s) => s.replace(/\s+/g, ' ');
  const flat = collapse(css);
  for (const [token, spec] of Object.entries({ ...INTERMEDIATE, ...MIX, ...PANEL_MIX })) {
    const expected = collapse(`${token}: ${mixCss(spec)};`);
    assert.ok(flat.includes(expected), `tokens.css is missing or disagrees on:\n  ${expected}`);
  }
});

test('tokens.css defines an anchor block for every registered theme', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  for (const theme of THEMES) {
    assert.ok(css.includes(`[data-theme='${theme.id}']`), `tokens.css has no block for ${theme.id}`);
    for (const [k, v] of Object.entries(theme.anchors)) {
      assert.ok(css.includes(`--anchor-${k}: ${v}`), `tokens.css ${theme.id}: missing --anchor-${k}: ${v}`);
    }
  }
});
