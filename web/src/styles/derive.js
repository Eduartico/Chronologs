/**
 * The derivation table.
 *
 * A theme declares four colours and nothing else. Every other colour token is one
 * `color-mix()` away from those four, and this file is the single place the mix
 * percentages live: `tokens.css` is written from it, `web/src/lib/theme.test.js`
 * checks the result against the frozen Guardian palette, and
 * `scripts/validate_palette.js` uses it to find the worst-case surface any of the
 * seventeen themes produces.
 *
 * The idea that makes one formula serve seventeen themes: elevation is the
 * background mixed *toward the ink*. On a dark theme the ink is near-white, so
 * raised surfaces get lighter; on a light theme the ink is near-black, so they get
 * darker. The formula never has to ask which mode it is in.
 *
 * It does need one correction. A straight background→ink lerp bleeds chroma out of
 * the ramp, because the ink is nearly neutral — Guardian's `--surface-3` (#232d39)
 * is far bluer than `mix(#0c1016, #e8eef5)` at any percentage, which is why the
 * first fit could not get closer than ΔE 3.2. So the ramps run toward two
 * accent-tinted intermediates rather than toward the raw anchors:
 *
 *     --lift  = ink 75% + accent 25%   (surfaces and borders climb toward this)
 *     --shade = bg  80% + accent 20%   (the ink ramp descends toward this)
 *
 * With those, every frozen Guardian token is reproduced within ΔE2000 1.8. The
 * accent influence is deliberate and modest: 25 % is enough to keep a theme's hue
 * running through its greys, far short of tinting the whole app.
 *
 * Mixing space, decided once so nobody re-decides it per token: opaque mixes use
 * `in oklab`, because one percentage then behaves the same under a red accent as
 * under a blue one. Mixes with `transparent` use `in srgb`, matching the
 * `rgba(…, .14)` tokens they replace — oklab premultiplies through a space where
 * the result is not what anyone expects.
 */

/** The two accent-tinted intermediates the ramps run toward. */
export const INTERMEDIATE = {
  '--lift': { base: 'ink', toward: 'accent', pct: 75 },
  '--shade': { base: 'bg', toward: 'accent', pct: 80 },
};

/** Every derived token, as {base, toward, pct}. `pct` is how much of `base` survives. */
export const MIX = {
  // ---- card ladder: derived from the page background, never from the sidebar ----
  '--surface-1': { base: 'bg', toward: 'lift', pct: 94 },
  '--surface-2': { base: 'bg', toward: 'lift', pct: 88 },
  '--surface-3': { base: 'bg', toward: 'lift', pct: 82 },

  // ---- borders: a surface tinted toward the ink, not an ink dimmed down ----
  '--border': { base: 'bg', toward: 'lift', pct: 84 },
  '--border-strong': { base: 'bg', toward: 'lift', pct: 72 },

  // ---- ink ramp ----
  '--text-secondary': { base: 'ink', toward: 'shade', pct: 71 },
  '--text-muted': { base: 'ink', toward: 'shade', pct: 49 },

  // ---- accent ----
  '--accent-hover': { base: 'accent', toward: 'lift', pct: 74 },
  '--focus-ring': { base: 'accent', toward: 'lift', pct: 80 },
};

/** The sidebar runs its own ladder, because six themes pair a dark sidebar with a
    light page and deriving cards from the sidebar would turn every card dark. */
export const PANEL_MIX = {
  '--panel-1': { base: 'panel', toward: 'panelInk', pct: 94 },
  '--panel-2': { base: 'panel', toward: 'panelInk', pct: 88 },
  '--panel-border': { base: 'panel', toward: 'panelInk', pct: 90 },
  '--panel-text-muted': { base: 'panelInk', toward: 'panel', pct: 55 },
};

/** The sidebar's own ink, tinted a little toward the accent so the rail reads as
    part of the theme rather than as stock white or black. */
export const PANEL_INK = {
  dark: { base: 'white', toward: 'accent', pct: 92 },
  light: { base: 'black', toward: 'accent', pct: 88 },
};

/** Guardian's hand-picked values, frozen. Derivation has to land within ΔE2000 2.0
    of these or the default theme has visibly moved — see web/src/lib/theme.test.js.
    Re-fit with `node scripts/tune_derivation.js` if a percentage ever has to change. */
export const GUARDIAN_FROZEN = {
  '--surface-1': '#141a22',
  '--surface-2': '#1b232d',
  '--surface-3': '#232d39',
  '--border': '#232b35',
  '--border-strong': '#33404e',
  '--text-secondary': '#a3b0bf',
  '--text-muted': '#75828f',
  '--accent-hover': '#6aa6f0',
};

/** The budget. Two ΔE2000 units is roughly where a side-by-side comparison stops
    being able to tell two greys apart; the worst token currently sits at 1.79. */
export const DELTA_E_BUDGET = 2.0;

/** Render one entry as the CSS it must appear as in tokens.css. Derived tokens can
    reference the intermediates, so `--lift`/`--shade` resolve to themselves. */
export function mixCss({ base, toward, pct }) {
  const ref = (k) =>
    k === 'lift' || k === 'shade' ? `var(--${k})`
    : k === 'panelInk' ? 'var(--panel-ink)'
    : k === 'white' || k === 'black' ? k
    : `var(--anchor-${k})`;
  return `color-mix(in oklab, ${ref(base)} ${pct}%, ${ref(toward)})`;
}
