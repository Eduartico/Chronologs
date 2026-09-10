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

/** The three sizes a card can take in a two-column grid. Height is derived from
    the size rather than stored alongside it, so a node cannot exist at a size
    its height contradicts. */
export const SIZES = [
  { value: 1, icon: 'sizeHalf' },
  { value: 2, icon: 'sizeWide' },
  { value: 4, icon: 'sizeLarge' },
];

export const SIZE_VALUES = SIZES.map((s) => s.value);

/** How tall the chart inside a card is drawn, per size. A size-4 card is two
    grid rows tall and has to fill them; a size-1 card sits beside a sibling and
    must not out-grow it. */
export const CHART_HEIGHT = { 1: 280, 2: 300, 4: 620 };

export const WIDGETS = [
  {
    id: 'cashflow',
    icon: 'chartLine',
    views: ['line', 'bar', 'table'],
    defaultView: 'line',
    defaultSize: 1,
  },
  {
    id: 'balance',
    icon: 'chartArea',
    views: ['area', 'line', 'waterfall', 'table'],
    defaultView: 'area',
    defaultSize: 1,
  },
  {
    id: 'trend',
    icon: 'chartStacked',
    views: ['stacked', 'share', 'stream', 'table'],
    defaultView: 'stacked',
    defaultSize: 2,
  },
  {
    id: 'breakdown',
    icon: 'chartPie',
    views: ['pie', 'bar', 'treemap', 'sunburst', 'table'],
    defaultView: 'pie',
    defaultSize: 1,
  },
  {
    id: 'merchants',
    icon: 'chartBar',
    views: ['bar', 'table'],
    defaultView: 'bar',
    defaultSize: 1,
  },
  {
    id: 'savings',
    icon: 'chartLine',
    views: ['line', 'table'],
    defaultView: 'line',
    defaultSize: 2,
  },
  {
    id: 'flow',
    icon: 'chartSankey',
    views: ['sankey', 'table'],
    defaultView: 'sankey',
    defaultSize: 2,
  },
  {
    id: 'calendar',
    icon: 'chartCalendar',
    views: ['heatmap', 'table'],
    defaultView: 'heatmap',
    defaultSize: 2,
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
export function resolveNode(node) {
  const widget = widgetById(node?.widget);
  if (!widget) return null;
  return {
    id: node.id,
    widget,
    view: resolveView(widget, node.view),
    size: SIZE_VALUES.includes(node.size) ? node.size : widget.defaultSize,
  };
}
