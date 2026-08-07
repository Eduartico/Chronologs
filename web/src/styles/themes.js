/**
 * The theme registry.
 *
 * Each theme is four colours and three flags. Everything else — the surface
 * ladder, the ink ramp, borders, hovers, the focus ring, the sidebar — is derived
 * from the four by `tokens.css` using the percentages in `derive.js`.
 *
 * The flags are properties *of the theme*, not choices the user makes separately.
 * They are looked up from here whenever a theme is applied, which is what makes an
 * invalid combination — a light background wearing dark-mode shadows — impossible
 * to construct.
 *
 *   mode  — is the page background light or dark? Drives shadows and scrims, which
 *           are an alpha problem rather than a hue problem and so cannot derive.
 *   panel — is the *sidebar* light or dark? Independent of `mode`: four of these
 *           seventeen pair a light page with a dark rail, which is why cards and
 *           sidebar run two separate ladders.
 *   ramp  — which chart/semantic colour set can survive this theme's surfaces.
 *           Two buckets were not enough. `deep` covers the near-black backgrounds,
 *           but Iron Battalion, Rasmussen Clan and Refurbished Black Armory are
 *           mid-grey and mid-green: their --surface-1 climbs to L≈0.043, where the
 *           deep ramp drops under 3:1 and the semantic colours under 4.5:1. Those
 *           three get `dim`, a lighter set. Every light theme uses `light`.
 *           Enforced by scripts/validate_palette.js, which evaluates each bucket
 *           against the worst surface any theme in it actually produces.
 *
 * Theme names are proper nouns (Destiny shaders) and are never translated.
 */
export const THEMES = [
  {
    id: 'guardian',
    name: 'Guardian',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#0c1016', panel: '#141a22', ink: '#e8eef5', accent: '#4b93ec' },
  },
  {
    id: 'metro-shift',
    name: 'Metro Shift',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#181c25', panel: '#111217', ink: '#d0d5db', accent: '#3b82f6' },
  },
  {
    id: 'jacarina',
    name: 'Jacarina',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#121212', panel: '#212225', ink: '#eaeaea', accent: '#00e5ff' },
  },
  {
    id: 'calus-selected',
    name: "Calus's Selected",
    mode: 'light',
    ramp: 'light',
    panel: 'light',
    anchors: { bg: '#f8f9fa', panel: '#e9ecef', ink: '#212529', accent: '#6a0dad' },
  },
  {
    id: 'dreaming-spectrum',
    name: 'Dreaming Spectrum',
    mode: 'light',
    ramp: 'light',
    panel: 'dark',
    anchors: { bg: '#e6e1d8', panel: '#2e273a', ink: '#1a1625', accent: '#a98f6b' },
  },
  {
    id: 'gambit-jadestone',
    name: 'Gambit Jadestone',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#0d110f', panel: '#161a18', ink: '#e0e5e2', accent: '#39ff14' },
  },
  {
    id: 'precursor-vex-chrome',
    name: 'Precursor Vex Chrome',
    mode: 'light',
    ramp: 'light',
    panel: 'dark',
    anchors: { bg: '#ffffff', panel: '#242625', ink: '#1a1a1a', accent: '#cfb53b' },
  },
  {
    id: 'amethyst-veil',
    name: 'Amethyst Veil',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#08080c', panel: '#13131a', ink: '#d1d1d6', accent: '#8a2be2' },
  },
  {
    id: 'carminica',
    name: 'Carminica',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#0a0a0a', panel: '#141010', ink: '#b3b3b3', accent: '#d32f2f' },
  },
  {
    id: 'iron-battalion',
    name: 'Iron Battalion',
    mode: 'dark',
    ramp: 'dim',
    panel: 'dark',
    anchors: { bg: '#2b2d2f', panel: '#2c3625', ink: '#c0c0c0', accent: '#8c6d46' },
  },
  {
    id: 'vizier-regalia',
    name: 'Vizier Regalia',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#18181a', panel: '#0f0f11', ink: '#f5f5f5', accent: '#e5c158' },
  },
  {
    id: 'new-age-black-armory',
    name: 'New Age Black Armory',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#111111', panel: '#1e1e1e', ink: '#a0a0a0', accent: '#e53935' },
  },
  {
    id: 'satou-tribe',
    name: 'Satou Tribe',
    mode: 'light',
    ramp: 'light',
    panel: 'dark',
    anchors: { bg: '#f0f4f8', panel: '#2c3e50', ink: '#1a252f', accent: '#00e5ff' },
  },
  {
    id: 'refurbished-black-armory',
    name: 'Refurbished Black Armory',
    mode: 'dark',
    ramp: 'dim',
    panel: 'dark',
    anchors: { bg: '#25282a', panel: '#1e2022', ink: '#9aa0a6', accent: '#3e5a5a' },
  },
  {
    id: 'bergusian-night',
    name: 'Bergusian Night',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#1d1128', panel: '#120a1a', ink: '#d8c3e5', accent: '#d4af37' },
  },
  {
    id: 'rasmussen-clan',
    name: 'Rasmussen Clan',
    mode: 'dark',
    ramp: 'dim',
    panel: 'dark',
    anchors: { bg: '#2c352d', panel: '#1e241e', ink: '#e0e2e0', accent: '#c62828' },
  },
  {
    id: 'house-of-meyrin',
    name: 'House of Meyrin',
    mode: 'dark',
    ramp: 'deep',
    panel: 'dark',
    anchors: { bg: '#2a0808', panel: '#1a0505', ink: '#e5e5e5', accent: '#ffd700' },
  },
];

export const DEFAULT_THEME = 'guardian';

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** Always returns a theme — an id from an older build must not leave the app unstyled. */
export function themeById(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_THEME);
}
