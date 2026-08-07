import { ResponsiveContainer } from 'recharts';

import { useChartTheme } from './ChartThemeProvider.jsx';
import ChartTable from './ChartTable.jsx';
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
  children,
}) {
  const theme = useChartTheme();
  const { t } = useT();

  // Per-chart, per-sitting: which view you left a given card in. sessionStorage,
  // matching the convention for every other view preference in the app — the
  // durable "prefer tables everywhere" answer is the accessibility setting.
  const [view, setView] = usePersistentState(storageKey ? `chart.view.${storageKey}` : 'chart.view', null);
  const showing = view ?? (theme.tables ? 'table' : 'chart');

  if (import.meta.env?.DEV && !table && !loading && !empty) {
    console.warn(`[ChartCard] "${title}" has no table= prop, so it has no accessible fallback.`);
  }

  const placeholder = (text) => (
    <div style={{ height, display: 'grid', placeItems: 'center', color: theme.textSecondary, fontSize: 13 }}>{text}</div>
  );

  const tableEl = table ? <ChartTable title={title} {...table} /> : null;

  return (
    <div className="card chart-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: theme.text, margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: theme.textSecondary, margin: '2px 0 0' }}>{subtitle}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {controls}
          {tableEl && (
            <div className="chart-view-toggle" role="group" aria-label={title}>
              <button
                type="button"
                className={`seg-btn${showing === 'chart' ? ' is-on' : ''}`}
                aria-pressed={showing === 'chart'}
                title={t('chart.showChart')}
                onClick={() => setView('chart')}
              >
                <Icon name="chartLine" size={14} />
              </button>
              <button
                type="button"
                className={`seg-btn${showing === 'table' ? ' is-on' : ''}`}
                aria-pressed={showing === 'table'}
                title={t('chart.showTable')}
                onClick={() => setView('table')}
              >
                <Icon name="table" size={14} />
              </button>
            </div>
          )}
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
