import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Resolve the theme's colours into values JavaScript can use.
 *
 * Recharts will happily take `var(--series-1)` and let the browser resolve it in
 * the SVG attribute. That is not enough here: the accessibility layer needs the
 * actual colour in JS — to pick a hatch stroke that contrasts with the fill it sits
 * on, to draw a swatch in the table fallback, and to dim a series on hover.
 *
 * The obvious way to get it does not work. `getComputedStyle(el).getPropertyValue
 * ('--surface-1')` on a token defined as `color-mix(...)` returns the substituted
 * *token stream* — the literal text `color-mix(in oklab, #0c1016 94%, …)` — because
 * untyped custom properties are never resolved. `@property { syntax: '<color>' }`
 * would fix it at the cost of a registration block per token and a support surface.
 *
 * So: paint each token onto a throwaway element as its `color`, and read `color`
 * back. That property *is* typed, so the browser resolves the whole chain, however
 * deep, and hands back `rgb(r, g, b)`. Twenty lines, no caveats.
 */

const PROBED = [
  ...Array.from({ length: 8 }, (_, i) => `--series-${i + 1}`),
  // Six steps of one hue, for the heatmap. Categorical and sequential are
  // different jobs and neither ramp can do the other's.
  ...Array.from({ length: 6 }, (_, i) => `--seq-${i}`),
  '--chart-grid',
  '--chart-axis',
  '--chart-cursor',
  '--text',
  '--text-secondary',
  '--text-muted',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--border',
  '--good',
  '--warn',
  '--bad',
  '--info',
  '--accent',
  '--pnl-up',
  '--pnl-down',
];

/** What the app looked like before themes existed. Used if the probe comes back
    empty — a chart rendering in the wrong colours is a bug; a chart rendering with
    no colours at all is a blank page, and that is the failure worth preventing. */
const FALLBACK = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  sequential: ['#1e242c', '#213347', '#254a68', '#2b6395', '#317dc3', '#4b93ec'],
  grid: 'rgba(139, 148, 158, 0.15)',
  axis: 'rgba(139, 148, 158, 0.35)',
  cursor: 'rgba(139, 148, 158, 0.08)',
  text: '#e6edf3',
  textSecondary: '#8b949e',
  textMuted: '#75828f',
  surface1: '#141a22',
  surface2: '#1b232d',
  surface3: '#232d39',
  border: '#232b35',
  good: '#35b782',
  warn: '#d9a03c',
  bad: '#ef6a63',
  info: '#9085e9',
  accent: '#4b93ec',
  pnlUp: '#35b782',
  pnlDown: '#ef6a63',
  textures: false,
  tables: false,
};

let snapshot = FALLBACK;

/** The current resolved theme, for formatters and helpers that run outside React. */
export function chartTheme() {
  return snapshot;
}

const ChartThemeContext = createContext(FALLBACK);

function shape(read) {
  const value = (name, fallback) => {
    const v = read(name);
    return v && v !== 'rgba(0, 0, 0, 0)' ? v : fallback;
  };
  const root = document.documentElement;
  return {
    series: FALLBACK.series.map((f, i) => value(`--series-${i + 1}`, f)),
    sequential: FALLBACK.sequential.map((f, i) => value(`--seq-${i}`, f)),
    grid: value('--chart-grid', FALLBACK.grid),
    axis: value('--chart-axis', FALLBACK.axis),
    cursor: value('--chart-cursor', FALLBACK.cursor),
    text: value('--text', FALLBACK.text),
    textSecondary: value('--text-secondary', FALLBACK.textSecondary),
    textMuted: value('--text-muted', FALLBACK.textMuted),
    surface1: value('--surface-1', FALLBACK.surface1),
    surface2: value('--surface-2', FALLBACK.surface2),
    surface3: value('--surface-3', FALLBACK.surface3),
    border: value('--border', FALLBACK.border),
    good: value('--good', FALLBACK.good),
    warn: value('--warn', FALLBACK.warn),
    bad: value('--bad', FALLBACK.bad),
    info: value('--info', FALLBACK.info),
    accent: value('--accent', FALLBACK.accent),
    pnlUp: value('--pnl-up', FALLBACK.pnlUp),
    pnlDown: value('--pnl-down', FALLBACK.pnlDown),
    textures: root.dataset.textures === 'on',
    tables: root.dataset.tables === 'on',
  };
}

export function ChartThemeProvider({ children }) {
  const probe = useRef(null);
  const [theme, setTheme] = useState(FALLBACK);

  const read = useCallback(() => {
    const host = probe.current;
    if (!host) return;
    const next = shape((name) => {
      const span = host.querySelector(`[data-var="${name}"]`);
      return span ? getComputedStyle(span).color : '';
    });
    snapshot = next;
    setTheme(next);
  }, []);

  useEffect(() => {
    read();
    // The theme lives in attributes on <html>, so that is what to watch. Nothing
    // else can change these colours.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode', 'data-ramp', 'data-finance', 'data-textures', 'data-tables'],
    });
    return () => observer.disconnect();
  }, [read]);

  const value = useMemo(() => theme, [theme]);

  return (
    <ChartThemeContext.Provider value={value}>
      <div ref={probe} aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {PROBED.map((name) => (
          <span key={name} data-var={name} style={{ color: `var(${name})` }} />
        ))}
      </div>
      {children}
    </ChartThemeContext.Provider>
  );
}

export function useChartTheme() {
  return useContext(ChartThemeContext);
}
