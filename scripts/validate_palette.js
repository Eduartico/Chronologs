/**
 * Validate the chart series ramps and the semantic colours as *sets*.
 *
 * A palette is not eight independent choices. Two series that look distinct to you
 * can collapse into one colour for a deuteranope, and a colour that reads on a card
 * can vanish inside a tooltip, which sits one surface higher. Those failures are
 * invisible to code review and to a screenshot, so they get a script.
 *
 *     node scripts/validate_palette.js
 *
 * It runs as part of `npm test`. The previous version of this file was described in
 * chartTheme.js's header but never committed, and the palette drifted from the
 * surface it had been validated against — hence checking it in this time.
 *
 * What it checks, per ramp bucket (deep / dim / light — see themes.js):
 *   - adjacent series pairs separate by ΔE2000 ≥ 8 under normal vision and under
 *     deuteranopia, protanopia and tritanopia
 *   - every series pair separates by ΔE2000 ≥ 11 under normal vision
 *   - every series colour holds ≥ 3:1 against --surface-1, evaluated at the worst
 *     surface any theme in that bucket actually produces — not against one
 *     hardcoded hex, which is how the old palette silently drifted
 *   - semantic colours hold ≥ 4.5:1 against --surface-1, because they carry text
 *
 * The floors are where they are because the shipped `deep` set scores 9.1 adjacent
 * and 14.1 worst-pair; a floor above that would fail the palette this refactor
 * promised not to move. Series are not checked against --surface-3: they appear
 * there only as tooltip swatches, which carry a border, and WCAG 1.4.11 is
 * satisfied by that adjacency rather than by the fill itself.
 */
import { readFileSync } from 'node:fs';
import {
  interpolate, differenceCiede2000, formatHex, parse,
  filterDeficiencyDeuter, filterDeficiencyProt, filterDeficiencyTrit,
} from 'culori';

import { MIX, INTERMEDIATE } from '../web/src/styles/derive.js';
import { THEMES } from '../web/src/styles/themes.js';

const TOKENS = new URL('../web/src/styles/tokens.css', import.meta.url);
const de = differenceCiede2000();
const mix = (a, b, pct) => interpolate([a, b], 'oklab')(1 - pct / 100);

const ADJACENT_FLOOR = 8;
const GLOBAL_FLOOR = 11;
const SERIES_CONTRAST = 3;
const SEMANTIC_CONTRAST = 4.5;
const BUCKETS = ['deep', 'dim', 'light'];

/* ---- read the ramps straight out of tokens.css, so the check cannot go stale ---- */

function block(css, selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`tokens.css has no ${selector} block`);
  return css.slice(i, css.indexOf('}', i));
}

function readVars(text, names) {
  const out = {};
  for (const name of names) {
    const m = text.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
    if (m) out[name] = m[1];
  }
  return out;
}

const css = readFileSync(TOKENS, 'utf8');
const SERIES_NAMES = Array.from({ length: 8 }, (_, i) => `--series-${i + 1}`);
const SEMANTIC_NAMES = ['--good', '--warn', '--bad', '--info'];
const ALL = [...SERIES_NAMES, ...SEMANTIC_NAMES];

const DEEP = readVars(block(css, ':root {'), ALL);
const RAMPS = {
  deep: DEEP,
  dim: { ...DEEP, ...readVars(block(css, "[data-ramp='dim'] {"), ALL) },
  light: { ...DEEP, ...readVars(block(css, "[data-ramp='light'] {"), ALL) },
};

/* ---- the surfaces those ramps actually have to survive ---- */

function surfaces(anchors) {
  const c = { ...anchors };
  for (const [name, spec] of Object.entries(INTERMEDIATE)) c[name.slice(2)] = mix(c[spec.base], c[spec.toward], spec.pct);
  const s = (token) => mix(c[MIX[token].base], c[MIX[token].toward], MIX[token].pct);
  return { 1: s('--surface-1'), 3: s('--surface-3') };
}

const relLum = (color) => {
  const { r, g, b } = parse(formatHex(color));
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** For each bucket, the surface that is hardest for its ramp to sit on — the
    lightest under a dark theme, the darkest under a light one. That is the only
    one worth testing, and finding it from the registry rather than hardcoding a
    hex is what stops this check drifting the way the last one did. */
function worstSurfaces(bucket) {
  const themes = THEMES.filter((t) => t.ramp === bucket);
  const pick = bucket === 'light' ? Math.min : Math.max;
  const out = {};
  for (const level of [1, 3]) {
    let best = null;
    for (const theme of themes) {
      const s = surfaces(theme.anchors)[level];
      const l = relLum(s);
      if (!best || pick(l, best.l) === l) best = { l, hex: formatHex(s), theme: theme.id };
    }
    out[level] = best;
  }
  return out;
}

const CVD = {
  deuteranopia: filterDeficiencyDeuter(1),
  protanopia: filterDeficiencyProt(1),
  tritanopia: filterDeficiencyTrit(1),
};

/* ---- run ---- */

const failures = [];
const note = (msg) => failures.push(msg);

const unbucketed = THEMES.filter((t) => !BUCKETS.includes(t.ramp));
if (unbucketed.length) note(`themes.js: unknown ramp on ${unbucketed.map((t) => t.id).join(', ')}`);

for (const bucket of BUCKETS) {
  const ramp = RAMPS[bucket];
  const series = SERIES_NAMES.map((n) => ramp[n]);
  const worst = worstSurfaces(bucket);
  const members = THEMES.filter((t) => t.ramp === bucket).map((t) => t.id);

  console.log(`\n── ${bucket} ── ${members.length} theme(s): ${members.join(', ')}`);
  console.log(`   worst --surface-1: ${worst[1].hex} (${worst[1].theme})`);

  for (let i = 0; i < series.length - 1; i++) {
    for (const [vision, filter] of [['normal', (c) => c], ...Object.entries(CVD)]) {
      const d = de(filter(series[i]), filter(series[i + 1]));
      if (d < ADJACENT_FLOOR) {
        note(`${bucket}: --series-${i + 1} and --series-${i + 2} are only ΔE ${d.toFixed(1)} apart under ${vision} (floor ${ADJACENT_FLOOR})`);
      }
    }
  }

  let worstPair = { d: Infinity };
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const d = de(series[i], series[j]);
      if (d < worstPair.d) worstPair = { d, i, j };
      if (d < GLOBAL_FLOOR) {
        note(`${bucket}: --series-${i + 1} and --series-${j + 1} are only ΔE ${d.toFixed(1)} apart (floor ${GLOBAL_FLOOR})`);
      }
    }
  }
  console.log(`   worst pair overall: --series-${worstPair.i + 1}/--series-${worstPair.j + 1} at ΔE ${worstPair.d.toFixed(1)}`);

  for (const [name, floor] of [...SERIES_NAMES.map((n) => [n, SERIES_CONTRAST]), ...SEMANTIC_NAMES.map((n) => [n, SEMANTIC_CONTRAST])]) {
    const r = ratio(ramp[name], worst[1].hex);
    if (r < floor) {
      note(`${bucket}: ${name} (${ramp[name]}) is ${r.toFixed(2)}:1 on --surface-1 ${worst[1].hex} of ${worst[1].theme} (floor ${floor})`);
    }
  }
}

console.log();
if (failures.length) {
  for (const f of failures) console.error(`✖ ${f}`);
  console.error(`\n${failures.length} palette problem(s). Fix the ramp in web/src/styles/tokens.css.`);
  process.exit(1);
}
console.log(`✔ all ${BUCKETS.length} ramps validate`);
