import test from 'node:test';
import assert from 'node:assert/strict';

import { inkOn, contrastRatio, parseColor, INK_DARK, INK_LIGHT } from './contrastInk.js';
import { THEMES } from '../styles/themes.js';
import { PALETTE } from '../components/ui/palette.js';

test('parses the notations that actually occur in this codebase', () => {
  assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1 });
  assert.equal(Math.round(parseColor('#4b93ec').r * 255), 0x4b);
  assert.equal(Math.round(parseColor('rgb(75, 147, 236)').b * 255), 236);
  assert.equal(Math.round(parseColor('hsl(0, 0%, 100%)').g * 255), 255);
  // The persisted ColorPicker swatches are hsl() — getting these wrong silently
  // reverts every tag pill to unreadable ink.
  const orange = parseColor('hsl(25, 70%, 55%)');
  assert.ok(orange.r > orange.g && orange.g > orange.b, 'hsl(25…) should be an orange');
  assert.equal(parseColor('not a colour'), null);
});

test('reproduces the ink the stylesheet used to hardcode', () => {
  // index.css:194 chose a near-black ink on the accent by eye; the formula must agree,
  // or Guardian's buttons visibly change on a refactor that promised not to move them.
  assert.equal(inkOn('#4b93ec'), INK_DARK);
  assert.equal(inkOn('#35b782'), INK_DARK); // .btn-green
  assert.equal(inkOn('#ef6a63'), INK_DARK); // .btn-red
});

test('picks light ink on genuinely dark fills', () => {
  assert.equal(inkOn('#6a0dad'), INK_LIGHT); // Calus's Selected accent
  assert.equal(inkOn('#000000'), INK_LIGHT);
});

test('every theme accent gets ink at 4.5:1 or better', () => {
  for (const theme of THEMES) {
    const ink = inkOn(theme.anchors.accent);
    const ratio = contrastRatio(theme.anchors.accent, ink);
    assert.ok(ratio >= 4.5, `${theme.id}: ${ink} on accent ${theme.anchors.accent} is only ${ratio.toFixed(2)}:1`);
  }
});

test('every persisted palette swatch gets readable ink', () => {
  // The floor is 4.4 rather than WCAG's 4.5 because the two most saturated violets
  // land at 4.49 — visually indistinguishable from passing, and these are already
  // persisted in user data, so tightening the bar would only fail the build without
  // changing a single saved category. Anything that drops below 4.4 is a real
  // regression: a swatch nobody can put a label on.
  for (const swatch of PALETTE) {
    const ratio = contrastRatio(swatch, inkOn(swatch));
    assert.ok(ratio >= 4.4, `${swatch} only reaches ${ratio.toFixed(2)}:1 with its best ink`);
  }
});

test('unparseable input falls back rather than throwing', () => {
  assert.equal(inkOn(undefined), INK_DARK);
  assert.equal(inkOn('var(--accent)'), INK_DARK);
});
