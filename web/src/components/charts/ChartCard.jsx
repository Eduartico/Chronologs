import { ResponsiveContainer } from 'recharts';
import { INK } from './chartTheme.js';

/**
 * Frame around every chart: title, optional controls, and the empty/loading
 * states. Charts used to render an axis pair over no data, which read as a bug.
 */
export default function ChartCard({
  title,
  subtitle,
  controls,
  height = 260,
  loading,
  empty,
  emptyMessage = 'Sem dados para este período.',
  footnote,
  children,
}) {
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
          <h3 style={{ fontSize: 13, fontWeight: 600, color: INK.primary, margin: 0 }}>{title}</h3>
          {subtitle && (
            <p style={{ fontSize: 12, color: INK.secondary, margin: '2px 0 0' }}>{subtitle}</p>
          )}
        </div>
        {controls && <div style={{ display: 'flex', gap: 6 }}>{controls}</div>}
      </div>

      {loading ? (
        <div style={{ height, display: 'grid', placeItems: 'center', color: INK.secondary, fontSize: 13 }}>
          A carregar…
        </div>
      ) : empty ? (
        <div style={{ height, display: 'grid', placeItems: 'center', color: INK.secondary, fontSize: 13 }}>
          {emptyMessage}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}

      {footnote && !loading && !empty && (
        <p style={{ fontSize: 11, color: INK.secondary, margin: '8px 0 0' }}>{footnote}</p>
      )}
    </div>
  );
}
