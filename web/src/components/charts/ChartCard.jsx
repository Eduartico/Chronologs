import { ResponsiveContainer } from 'recharts';

import { useChartTheme } from './ChartThemeProvider.jsx';
import ChartTable from './ChartTable.jsx';
import ViewToggle from './ViewToggle.jsx';
import Icon from '../Icon.jsx';
import { usePersistentState } from '../../lib/usePersistentState.js';
import { useT } from '../../i18n/index.js';

/**
 * Frame around every chart: title, controls, the empty and loading states — and
 * the same data as a table.
 *
 * The table is the part that matters. An SVG full of `<path>` elements says
 * nothing to a screen reader however many `aria-label`s it carries, and a chart is
 * useless to anyone who needs the exact number rather than the shape. So the table
 * is rendered *always*: visibly when asked for, and inside `.sr-only` when the
 * chart is showing. These are fifty-row tables; the cost is nothing.
 *
 * ChartCard cannot build it alone — it receives an already-constructed recharts
 * element as `children` and has no access to the data behind it. Hence the `table`
 * prop. Every call site already has the array in a local variable, so it is a few
 * lines each, and a chart that omits it warns in development rather than failing
 * silently — that warning is how the remaining ones get found.
 *
 * ## One toggle, not two
 *
 * A card used to carry a "lines / bars" control *and*, beside it, a separate
 * "chart / table" pair. Both answer the same question — how do I want to look at
 * this — and splitting that question across two controls meant the reader had to
 * work out which of the two owned the answer. `views` now names every way this
 * card can be drawn, `table` among them, and one segmented control switches
 * between them.
 *
 * ## Controlled or not
 *
 * A dashboard node owns its own view: it is stored on the server as a property of
 * that node, which is what lets the same widget appear twice on one dashboard, a
 * pie and a table. Those cards pass `view` and `onViewChange` and this component
 * holds no state at all.
 *
 * Cards that are not nodes — the Investments page — pass neither, and fall back to
 * the per-sitting `sessionStorage` behaviour they have always had.
 */
export default function ChartCard({
  title,
  subtitle,
  controls,
  height = 260,
  loading,
  empty,
  emptyMessage,
  footnote,
  table,
  storageKey,
  views,
  view,
  onViewChange,
  // Node chrome. A card that is not a dashboard node passes none of these and is
  // rendered exactly as it was before the grid existed.
  actions,
  headerProps,
  className = '',
  children,
}) {
  const theme = useChartTheme();
  const { t } = useT();

  const [stored, setStored] = usePersistentState(
    storageKey ? `chart.view.${storageKey}` : 'chart.view',
    null,
  );
  const controlled = view != null && typeof onViewChange === 'function';
  const showing = controlled ? view : (stored ?? (theme.tables ? 'table' : 'chart'));
  const setShowing = controlled ? onViewChange : setStored;

  if (import.meta.env?.DEV && !table && !loading && !empty) {
    console.warn(`[ChartCard] "${title}" has no table= prop, so it has no accessible fallback.`);
  }

  const placeholder = (text) => (
    <div style={{ height, display: 'grid', placeItems: 'center', color: theme.textSecondary, fontSize: 13 }}>{text}</div>
  );

  const tableEl = table ? <ChartTable title={title} {...table} /> : null;
  // Uncontrolled cards only ever had two: the chart they draw, and its rows.
  const options = views ?? (tableEl ? ['chart', 'table'] : null);

  return (
    <div className={`card chart-container ${className}`.trim()}>
      <div className="chart-head">
        {/* The handle is only drawn where the card is actually a drag source, so
            a card that cannot be moved does not advertise that it can.

            The drag listeners live on the handle and nowhere else. They used to
            be on the whole header, which meant the title was a drag source: you
            could not select it, could not copy it, and every attempt to put the
            cursor in it picked the card up instead. A grip is a grip precisely
            because it is the one part of the card that is not something else. */}
        {headerProps?.draggable && (
          <span
            className="dash-grip"
            title={t('dashboard.edit.drag')}
            aria-label={t('dashboard.edit.drag')}
            {...headerProps}
          >
            <Icon name="grip" size={18} />
          </span>
        )}
        <div className="chart-head-title">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: theme.text, margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: theme.textSecondary, margin: '2px 0 0' }}>{subtitle}</p>}
        </div>
        <div className="chart-head-controls">
          {controls}
          {options && options.length > 1 && (
            <ViewToggle value={showing} onChange={setShowing} options={options} label={title} />
          )}
          {actions}
        </div>
      </div>

      {loading ? (
        placeholder(t('common.loading'))
      ) : empty ? (
        placeholder(emptyMessage ?? t('chart.empty'))
      ) : showing === 'table' && tableEl ? (
        tableEl
      ) : (
        <>
          <ResponsiveContainer width="100%" height={height}>
            {children}
          </ResponsiveContainer>
          {/* Always in the page, never on the screen: the chart's own data, for
              anyone reading with something other than their eyes. */}
          {tableEl && <div className="sr-only">{tableEl}</div>}
        </>
      )}

      {footnote && !loading && !empty && (
        <p style={{ fontSize: 11, color: theme.textSecondary, margin: '8px 0 0' }}>{footnote}</p>
      )}
    </div>
  );
}
