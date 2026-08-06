/**
 * Shared chart theme.
 *
 * Every page used to declare its own COLORS array, so the same category was a
 * different colour on the dashboard than on the assets page. These are the
 * single source of truth.
 *
 * The categorical ramp is the eight-hue set validated for a dark surface
 * (#161b22) with scripts/validate_palette.js: lightness band, chroma floor,
 * adjacent-pair CVD separation (worst ΔE 8.4), normal-vision floor (worst ΔE
 * 19.3) and ≥3:1 contrast all pass. Slots are assigned in fixed order and never
 * cycled — a ninth series folds into "Outros" instead.
 */
import { baseCurrency } from '../../lib/money.js';

export const SERIES = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
];

export const MAX_SERIES = SERIES.length;

// Reserved for meaning, never reused as "series N".
export const STATUS = {
  good: '#199e70',
  warning: '#c98500',
  critical: '#e66767',
  neutral: '#8b949e',
};

export const INK = {
  primary: '#e6edf3',
  secondary: '#8b949e',
  grid: 'rgba(139, 148, 158, 0.15)',
  axis: 'rgba(139, 148, 158, 0.35)',
  surface: '#161b22',
};

/**
 * Colour follows the entity, not its position — filtering a series out must not
 * repaint the ones that remain. Callers pass the full, stable key list once.
 */
export function colorScale(keys = []) {
  const map = new Map();
  keys.forEach((key, i) => map.set(key, SERIES[i % SERIES.length]));
  return (key) => map.get(key) || STATUS.neutral;
}

/**
 * Caps a breakdown at the palette size, folding the tail into "Outros" so no
 * series ever gets a generated hue.
 */
export function capSeries(rows, { key = 'name', value = 'value', max = MAX_SERIES } = {}) {
  if (rows.length <= max) return rows;
  const sorted = [...rows].sort((a, b) => (b[value] || 0) - (a[value] || 0));
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  return [
    ...head,
    { [key]: 'Outros', [value]: tail.reduce((s, r) => s + (r[value] || 0), 0), isOther: true },
  ];
}

const compact = new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });

/**
 * Axis ticks: "€1,2 mil" rather than "1240" — readable at tick density.
 *
 * The currency follows the display setting rather than the axis's own data, so
 * a chart drawn from dollar amounts has to convert before it gets here. That is
 * deliberate: one screen, one currency, and the conversion happens once where
 * the series is built instead of in every formatter.
 */
export function axisMoney(value, currency = baseCurrency()) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${compact.format(value || 0)}`;
}

export function tooltipMoney(value, currency = baseCurrency()) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${exact.format(value || 0)}`;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** "2026-03" -> "Mar 26". */
export function axisMonth(value) {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}`;
}

export function axisDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
}

/** Recharts props shared by every cartesian chart, so axes stay recessive. */
export const cartesianDefaults = {
  grid: {
    stroke: INK.grid,
    strokeDasharray: '0',
    vertical: false,
  },
  axis: {
    stroke: INK.axis,
    tick: { fill: INK.secondary, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  },
};
