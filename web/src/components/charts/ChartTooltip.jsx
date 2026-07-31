import { INK } from './chartTheme.js';

/**
 * Shared tooltip. Labels and values wear text tokens; the series colour appears
 * only as a small swatch beside them, so identity is never carried by the text
 * colour alone.
 */
export default function ChartTooltip({ active, payload, label, formatLabel, formatValue, total }) {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((p) => p.value != null && p.value !== 0);
  if (rows.length === 0) return null;

  const sum = total ? rows.reduce((s, r) => s + Math.abs(r.value), 0) : null;

  return (
    <div
      style={{
        background: INK.surface,
        border: '1px solid rgba(139,148,158,0.3)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        minWidth: 140,
      }}
    >
      {label != null && (
        <div style={{ color: INK.primary, fontWeight: 600, marginBottom: 6 }}>
          {formatLabel ? formatLabel(label) : label}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.dataKey ?? row.name}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: row.color || row.payload?.fill,
              flexShrink: 0,
            }}
          />
          <span style={{ color: INK.secondary }}>{row.name}</span>
          <span style={{ color: INK.primary, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {formatValue ? formatValue(row.value) : row.value}
          </span>
        </div>
      ))}
      {sum != null && rows.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px solid rgba(139,148,158,0.2)',
            color: INK.secondary,
          }}
        >
          <span>Total</span>
          <span style={{ color: INK.primary, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {formatValue ? formatValue(sum) : sum}
          </span>
        </div>
      )}
    </div>
  );
}
