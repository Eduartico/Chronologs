/**
 * Which ink goes on top of a filled colour.
 *
 * The stylesheet used to answer this by hand — `#08111c` on the accent button,
 * `#0d1117` on a tag pill, `#fff` on a badge — which worked while there was one
 * accent and one set of tag colours. With seventeen themes the answer changes per
 * theme, and the theme's light/dark flag is the wrong input: a light theme can
 * still have a dark accent (Calus's Selected is a white page with a deep purple),
 * and a dark theme can have a near-white one.
 *
 * So it is a contrast decision, computed from the colour itself. CSS cannot do
 * this — there is no luminance function, and `color-contrast()` ships nowhere — so
 * the applier computes `--on-accent` and friends at theme-apply time and writes
 * them onto the root element.
 *
 * Checked against what the old hardcoded values already did: the accent #4b93ec has
 * relative luminance 0.284, which contrasts 5.20:1 with the dark ink and 3.14:1 with
 * the light one. Dark wins, which is exactly what index.css:194 chose by eye.
 */

/** The two candidates. Not pure black and white — both are slightly tinted so a
    filled pill does not look like a hole punched in the page. */
export const INK_DARK = '#0b0f14';
export const INK_LIGHT = '#f5f9ff';

/** Parse the notations that actually appear in this codebase: hex (3, 4, 6 or 8
    digits), `rgb()/rgba()`, and `hsl()/hsla()` — the ColorPicker palette is all
    `hsl()`, and those values are persisted in user data. Returns 0–1 channels. */
export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }

  const nums = (body) => body.split(/[\s,/]+/).filter(Boolean);

  const rgb = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b] = nums(rgb[1]).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / 255));
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
  }

  const hsl = s.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = nums(hsl[1]);
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    if (![h, sat, l].every(Number.isFinite)) return null;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
    return { r: seg[0] + m, g: seg[1] + m, b: seg[2] + m };
  }

  return null;
}

/** WCAG relative luminance. */
export function relativeLuminance(color) {
  const c = parseColor(color);
  if (!c) return 0;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The readable ink for text or an icon sitting on `color`. Unparseable input
    falls back to the dark ink rather than throwing — a wrong-but-visible label
    beats a crashed page. */
export function inkOn(color) {
  if (!parseColor(color)) return INK_DARK;
  return contrastRatio(color, INK_DARK) >= contrastRatio(color, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}
