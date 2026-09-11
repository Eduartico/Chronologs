/**
 * Every card the dashboard can hold, and every way each one can be drawn.
 *
 * One list, iterated by the add-node picker, by the renderer, and by
 * `web/src/lib/dashboard.test.js` — in the spirit of
 * `server/framework/builtins.js`, where the scheduler and the settings table
 * iterate one kind of thing rather than each keeping their own copy of the same
 * five names.
 *
 * This replaced the experiment flags. Those existed so a chart could be judged
 * in use rather than argued about, and so a losing one could be deleted without
 * an archaeology dig through six pages. Adding and removing a card does both
 * jobs directly, and a flag on top of it would only mean two places to switch
 * the same chart on.
 *
 * ## Why some charts are views and not widgets
 *
 * Four cards used to answer the same question in four places. A waterfall *is*
 * the running balance decomposed into its per-period steps — the same series,
 * drawn as increments rather than as a level. A streamgraph is the category
 * stack with a centred baseline. A treemap and a sunburst are the breakdown pie
 * with rectangles and rings instead of slices. None of those is a different
 * question, so none of them is a different card.
 *
 * The Sankey looks like it belongs with the breakdown family and does not: it
 * draws income, through the accounts that held it, into what it paid for. Three
 * columns of a flow, not a share of one total — different columns in its table,
 * a different answer to a different question.
 *
 * Nothing user-visible lives in this file. A widget's name and the sentence
 * under it are `widget.<id>.name` / `widget.<id>.desc` in the catalogues, and a
 * view's label is `view.<id>`. `t()` is never called at module scope — see
 * `web/src/lib/i18nScope.test.js`.
 */

/** The icon each way of drawing gets in the view switch. `table` is one of them,
    not a separate control: "as bars" and "as rows" answer the same question, and
    two toggles side by side to answer it was the thing being complained about. */
export const VIEW_ICONS = {
  line: 'chartLine',
  bar: 'chartBar',
  area: 'chartArea',
  pie: 'chartPie',
  stacked: 'chartStacked',
  share: 'chartShare',
  stream: 'chartStream',
  waterfall: 'chartWaterfall',
  treemap: 'chartTreemap',
  sunburst: 'chartSunburst',
  sankey: 'chartSankey',
  heatmap: 'chartCalendar',
  table: 'table',
  // The uncontrolled fallback for a card that is not a dashboard node and so has
  // no named views: whatever it draws, or its rows.
  chart: 'chartLine',
};

/**
 * The widths a card can take, and how tall its chart is drawn at each.
 *
 * The grid used to be two columns, so a card was half a row, a whole row, or a
 * whole row twice over — three widths, and no way to put four small figures in a
 * line the way the headline tiles are. It is now twelve columns, which divides
 * by two, three and four, so a quarter, a third, a half and two thirds all land
 * on it exactly.
 *
 * Named rather than numbered. The sizes used to be 1, 2 and 4, meaning "half",
 * "full" and "full, twice as tall" — a numbering that only made sense read as
 * *height in rows*, which is the one thing it did not describe. Adding a third
 * and a quarter to that scheme would have meant fractions or invented integers.
 * `LEGACY_SIZES` keeps a layout written under the old numbering working, because
 * a settings file someone already has is not something to break for tidiness.
 *
 * Height is derived from the width rather than stored beside it, so a node
 * cannot exist at a size its height contradicts.
 */
export const SIZES = [
  { value: 'quarter', columns: 3, icon: 'sizeQuarter' },
  { value: 'third', columns: 4, icon: 'sizeThird' },
  { value: 'half', columns: 6, icon: 'sizeHalf' },
  { value: 'twoThirds', columns: 8, icon: 'sizeTwoThirds' },
  { value: 'full', columns: 12, icon: 'sizeWide' },
  { value: 'tall', columns: 12, rows: 2, icon: 'sizeLarge' },
];

export const SIZE_VALUES = SIZES.map((s) => s.value);

/** What the numbers in an existing layout meant. */
export const LEGACY_SIZES = { 1: 'half', 2: 'full', 4: 'tall' };

/** A narrow card cannot carry a 300px chart and still leave room for its own
    title, and a `tall` card is two grid rows and has to fill them. */
export const CHART_HEIGHT = {
  quarter: 150,
  third: 170,
  half: 280,
  twoThirds: 280,
  full: 300,
  tall: 620,
};

export const WIDGETS = [
  {
    id: 'cashflow',
    icon: 'chartLine',
    views: ['line', 'bar', 'table'],
    defaultView: 'line',
    defaultSize: 'half',
  },
  {
    id: 'balance',
    icon: 'chartArea',
    views: ['area', 'line', 'waterfall', 'table'],
    defaultView: 'area',
    defaultSize: 'half',
  },
  {
    id: 'trend',
    icon: 'chartStacked',
    views: ['stacked', 'share', 'stream', 'table'],
    defaultView: 'stacked',
    defaultSize: 'full',
  },
  {
    id: 'breakdown',
    icon: 'chartPie',
    views: ['pie', 'bar', 'treemap', 'sunburst', 'table'],
    defaultView: 'pie',
    defaultSize: 'half',
  },
  {
    id: 'merchants',
    icon: 'chartBar',
    views: ['bar', 'table'],
    defaultView: 'bar',
    defaultSize: 'half',
  },
  {
    id: 'savings',
    icon: 'chartLine',
    views: ['line', 'table'],
    defaultView: 'line',
    defaultSize: 'full',
  },
  {
    id: 'flow',
    icon: 'chartSankey',
    views: ['sankey', 'table'],
    defaultView: 'sankey',
    defaultSize: 'full',
  },
  {
    id: 'calendar',
    icon: 'chartCalendar',
    views: ['heatmap', 'table'],
    defaultView: 'heatmap',
    defaultSize: 'full',
  },
  /*
   * The small cards.
   *
   * Every figure below was already computed and already on the wire — `shifts`,
   * `insights.recurring`, `projection` — and none of it was drawn anywhere the
   * reader plans. They open at a third of a row because that is the width they
   * are for: a dashboard of eight full-width charts can only be read by
   * scrolling, and half of what a reader wants at a glance is one number with
   * one comparison beside it.
   */
  {
    id: 'movers',
    icon: 'insights',
    views: ['bar', 'table'],
    defaultView: 'bar',
    defaultSize: 'half',
  },
  {
    id: 'committed',
    icon: 'subscriptions',
    views: ['bar', 'table'],
    defaultView: 'bar',
    defaultSize: 'half',
  },
  {
    id: 'projection',
    icon: 'hourglass',
    views: ['bar', 'table'],
    defaultView: 'bar',
    defaultSize: 'third',
  },
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** `undefined` for a widget this build does not have. Callers render nothing
    rather than throwing: a settings file written by a version that carried a
    card this one has since dropped must not take the whole dashboard down. */
export function widgetById(id) {
  return BY_ID.get(id);
}

/**
 * The view a node should actually be drawn in.
 *
 * A stored view that the widget does not offer falls back to its default — the
 * same tolerance, for the same reason: a hand-edited file, or one written before
 * a view was renamed, should cost the reader one card looking wrong rather than
 * a blank page.
 */
export function resolveView(widget, view) {
  if (!widget) return null;
  return widget.views.includes(view) ? view : widget.defaultView;
}

/** Everything the grid needs to draw one stored node, with every field checked.
    `null` means "skip this node", which is what an unknown widget gets. */
/** A stored width, a width written under the old numbering, or the widget's own
    default — in that order. An unknown one falls back rather than taking the
    page down: a hand-edited settings file must not be able to do that. */
export function resolveSize(size, fallback) {
  if (SIZE_VALUES.includes(size)) return size;
  const legacy = LEGACY_SIZES[size];
  return legacy || fallback;
}

export function resolveNode(node) {
  const widget = widgetById(node?.widget);
  if (!widget) return null;
  return {
    id: node.id,
    widget,
    view: resolveView(widget, node.view),
    size: resolveSize(node?.size, widget.defaultSize),
  };
}
