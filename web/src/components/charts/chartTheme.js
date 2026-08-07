/**
 * Shared chart theme.
 *
 * Every page used to declare its own COLORS array, so the same category was a
 * different colour on the dashboard than on the assets page. This is the single
 * source of truth — but it no longer *holds* the colours.
 *
 * It used to. Eight hex literals lived here, validated once against a surface
 * colour (`#161b22`) that the stylesheet had since moved away from, and there was
 * no way to notice: the palette and the surface it was checked against were in
 * different files with nothing tying them together. Now the ramps are declared in
 * `styles/tokens.css` alongside every other colour, `ChartThemeProvider` resolves
 * them, and `scripts/validate_palette.js` checks each one against the surfaces the
 * themes actually produce. Drift of that kind cannot recur silently.
 *
 * What is left here is the *arrangement*: which slot a series gets, how a long tail
 * is folded, how an axis is formatted, and the non-colour channels — dash patterns
 * and point markers — that let a chart be read without colour at all.
 */
import { baseCurrency } from '../../lib/money.js';
import { nf, df, intlLocale, monthNames } from '../../lib/locale.js';
import { t } from '../../i18n/index.js';
import { chartTheme } from './ChartThemeProvider.jsx';

/** How many distinct series a chart may show before the tail is folded. */
export const MAX_SERIES = 8;

/** The live ramp. Prefer `useChartTheme().series` inside a component; this is for
    formatters and helpers that run outside the tree. */
export function series() {
  return chartTheme().series;
}

/** Reserved for meaning, never reused as "series N". */
export function status() {
  const theme = chartTheme();
  return { good: theme.good, warning: theme.warn, critical: theme.bad, neutral: theme.textMuted };
}

/**
 * Colour follows the entity, not its position — filtering a series out must not
 * repaint the ones that remain. Callers pass the full, stable key list once.
 */
export function colorScale(keys = [], theme = chartTheme()) {
  const map = new Map();
  keys.forEach((key, i) => map.set(key, theme.series[i % theme.series.length]));
  const scale = (key) => map.get(key) || theme.textMuted;
  scale.indexOf = (key) => keys.indexOf(key);
  return scale;
}

/**
 * Caps a breakdown at the palette size, folding the tail into "Other" so no series
 * ever gets a generated hue — a generated hue is exactly what the validator cannot
 * check, and therefore exactly what will collide for a colourblind reader.
 */
export function capSeries(rows, { key = 'name', value = 'value', max = MAX_SERIES } = {}) {
  if (rows.length <= max) return rows;
  const sorted = [...rows].sort((a, b) => (b[value] || 0) - (a[value] || 0));
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  return [
    ...head,
    { [key]: t('chart.other'), [value]: tail.reduce((s, r) => s + (r[value] || 0), 0), isOther: true },
  ];
}

/*
 * Non-colour channels.
 *
 * A line chart that distinguishes its series only by hue is unreadable in
 * greyscale, in print, and for a reader who cannot separate two of the eight. Dash
 * patterns and marker shapes cost nothing and are always on — unlike the texture
 * fills, which are a setting because they do add visual noise.
 */
export const DASH = ['0', '6 3', '2 3', '10 4', '4 2 1 2', '1 3', '12 3 2 3', '3 3'];
export const MARKER = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'wye', 'circle'];

export const dashOf = (i) => DASH[i % DASH.length];
export const markerOf = (i) => MARKER[i % MARKER.length];

/**
 * Axis ticks: "€1.2K" rather than "1240" — readable at tick density.
 *
 * The currency follows the display setting rather than the axis's own data, so a
 * chart drawn from dollar amounts has to convert before it gets here. That is
 * deliberate: one screen, one currency, and the conversion happens once where the
 * series is built instead of in every formatter.
 */
export function axisMoney(value, currency = baseCurrency()) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${nf({ notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`;
}

export function tooltipMoney(value, currency = baseCurrency()) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${nf({ maximumFractionDigits: 2 }).format(value || 0)}`;
}

/** "2026-03" -> "Mar 26". Month names come from the locale, not from an array. */
export function axisMonth(value) {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (!m) return value;
  return `${monthNames('short')[Number(m[2]) - 1]} ${m[1].slice(2)}`;
}

export function axisDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : df({ day: '2-digit', month: 'short' }).format(d);
}

/**
 * Recharts props shared by every cartesian chart, so axes stay recessive.
 *
 * Spread at the call site — `<CartesianGrid {...cartesianDefaults.grid} />` — so it
 * has to stay an object, but its colours now change with the theme. Getters give
 * both: the property is read at spread time, which is render time.
 */
export const cartesianDefaults = {
  get grid() {
    return { stroke: chartTheme().grid, strokeDasharray: '0', vertical: false };
  },
  get axis() {
    const theme = chartTheme();
    return {
      stroke: theme.axis,
      tick: { fill: theme.textSecondary, fontSize: 11 },
      tickLine: false,
      axisLine: false,
    };
  },
  /** The band that follows the pointer. Replaces the `rgba(139,148,158,0.08)` that
      was pasted into four chart call sites. */
  get cursor() {
    return { fill: chartTheme().cursor };
  },
};

/**
 * Slice separators.
 *
 * Two adjacent pie slices in similar colours read as one shape. A stroke in the
 * card's own surface colour reads as a gap rather than as an outline, and it is
 * correct in every theme because it *is* the background behind the chart.
 */
export function sliceSeparator(theme = chartTheme()) {
  return { stroke: theme.surface1, strokeWidth: 2 };
}

/*
 * Live views of the theme, under the names the chart pages already use.
 *
 * `SERIES[2]`, `INK.secondary` and `STATUS.critical` appear about eighty times
 * across Dashboard and Investments. They used to be frozen literals; they now have
 * to follow whichever of the seventeen themes is active. Rewriting all eighty at
 * once would be a large, mechanical, entirely untestable diff in the middle of a
 * refactor that already changes those files.
 *
 * A Proxy keeps the exact syntax working while making every read live: the value
 * is fetched from the resolved snapshot at the moment it is used, so a theme change
 * repaints without the call site knowing anything happened. `SERIES` genuinely
 * needs the Proxy rather than a getter, because the access is by index.
 *
 * These are compatibility, not the intended API. New code should take the theme
 * from `useChartTheme()`.
 */
export const SERIES = new Proxy([], {
  get(_, prop) {
    const live = chartTheme().series;
    return typeof prop === 'symbol' ? live[prop] : Reflect.get(live, prop);
  },
  has: (_, prop) => Reflect.has(chartTheme().series, prop),
  ownKeys: () => Reflect.ownKeys(chartTheme().series),
  getOwnPropertyDescriptor: (_, prop) => Reflect.getOwnPropertyDescriptor(chartTheme().series, prop),
});

export const INK = {
  get primary() {
    return chartTheme().text;
  },
  get secondary() {
    return chartTheme().textSecondary;
  },
  get grid() {
    return chartTheme().grid;
  },
  get axis() {
    return chartTheme().axis;
  },
  get cursor() {
    return chartTheme().cursor;
  },
  /** The card a chart is drawn on. Used as the stroke between pie slices, so the
      separator reads as a gap. The old constant `#161b22` had already drifted from
      the stylesheet's actual surface colour. */
  get surface() {
    return chartTheme().surface1;
  },
};

export const STATUS = {
  get good() {
    return chartTheme().good;
  },
  get warning() {
    return chartTheme().warn;
  },
  get critical() {
    return chartTheme().bad;
  },
  get neutral() {
    return chartTheme().textMuted;
  },
};

export { intlLocale };
