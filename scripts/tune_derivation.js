/**
 * Solve the derivation percentages against the frozen Guardian palette.
 *
 * A percentage in `web/src/styles/derive.js` cannot be reasoned out on paper —
 * oklab's cube-root lightness moves further per percent at the dark end than at the
 * light end, so the number that reproduces `--surface-1` is not the number that
 * reproduces `--surface-3` scaled. This walks the whole range per token and prints
 * the best fit next to the current one.
 *
 *     node scripts/tune_derivation.js
 *
 * It changes nothing. Copy the winning percentages into derive.js and tokens.css by
 * hand, then let web/src/lib/theme.test.js hold them there.
 */
import { interpolate, differenceCiede2000, formatHex } from 'culori';
import { MIX, INTERMEDIATE, GUARDIAN_FROZEN } from '../web/src/styles/derive.js';
import { THEMES } from '../web/src/styles/themes.js';

const de = differenceCiede2000();

/** `color-mix(in oklab, base p%, toward)` is a lerp at t = 1 − p. */
export function mix(base, toward, pct) {
  return interpolate([base, toward], 'oklab')(1 - pct / 100);
}

/** Resolve the four anchors of a theme into every derived colour token. */
export function derive(anchors) {
  const c = { ...anchors };
  for (const [name, spec] of Object.entries(INTERMEDIATE)) {
    c[name.slice(2)] = mix(c[spec.base], c[spec.toward], spec.pct);
  }
  const out = {};
  for (const [token, spec] of Object.entries(MIX)) {
    out[token] = mix(c[spec.base], c[spec.toward], spec.pct);
  }
  return out;
}

const guardian = THEMES.find((t) => t.id === 'guardian');
const anchors = guardian.anchors;
const resolved = { ...anchors };
for (const [name, spec] of Object.entries(INTERMEDIATE)) {
  resolved[name.slice(2)] = mix(resolved[spec.base], resolved[spec.toward], spec.pct);
  console.log(`${name} = ${formatHex(resolved[name.slice(2)])}  (${spec.base} ${spec.pct}% → ${spec.toward})`);
}
console.log();

const pad = (v, n) => String(v).padEnd(n);
console.log(pad('token', 20), pad('now%', 6), pad('ΔE', 6), pad('gives', 9), pad('best%', 6), pad('ΔE', 6), pad('gives', 9), 'frozen');

for (const [token, spec] of Object.entries(MIX)) {
  const target = GUARDIAN_FROZEN[token];
  if (!target) {
    console.log(pad(token, 20), pad(spec.pct, 6), '(not frozen — nothing to fit)');
    continue;
  }
  let best = null;
  for (let p = 0; p <= 100; p += 0.5) {
    const d = de(mix(resolved[spec.base], resolved[spec.toward], p), target);
    if (!best || d < best.d) best = { p, d, hex: formatHex(mix(resolved[spec.base], resolved[spec.toward], p)) };
  }
  const now = mix(resolved[spec.base], resolved[spec.toward], spec.pct);
  console.log(
    pad(token, 20),
    pad(spec.pct, 6), pad(de(now, target).toFixed(2), 6), pad(formatHex(now), 9),
    pad(best.p, 6), pad(best.d.toFixed(2), 6), pad(best.hex, 9), target,
  );
}
