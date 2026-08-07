import { useChartTheme } from './ChartThemeProvider.jsx';
import { useT } from '../../i18n/index.js';

/**
 * Shared tooltip. Labels and values wear text tokens; the series colour appears
 * only as a small swatch beside them, so identity is never carried by the text
 * colour alone.
 *
 * The swatch carries a hairline border. That is what lets the series ramp be
 * validated against `--surface-1` alone: a tooltip sits on `--surface-3`, one step
 * lighter, where some series would fall under 3:1 as a bare fill — WCAG 1.4.11 is
 * satisfied by the adjacent border instead.
 */
export default function ChartTooltip({ active, payload, label, formatLabel, formatValue, total }) {
  const theme = useChartTheme();
  const { t } = useT();
  if (!active || !payload?.length) return null;

  const rows = payload.filter((p) => p.value != null && p.value !== 0);
  if (rows.length === 0) return null;

  const sum = total ? rows.reduce((s, r) => s + Math.abs(r.value), 0) : null;

  return (
    <div
      style={{
        background: theme.surface3,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: 'var(--shadow-2)',
        minWidth: 140,
      }}
    >
      {label != null && (
        <div style={{ color: theme.text, fontWeight: 600, marginBottom: 6 }}>
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
              border: `1px solid ${theme.border}`,
              flexShrink: 0,
            }}
          />
          <span style={{ color: theme.textSecondary }}>{row.name}</span>
          <span style={{ color: theme.text, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {/* The row goes along too, so a formatter can reach the datum —
                a clamped savings rate shows its real value here, not the
                value the line was drawn at. */}
            {formatValue ? formatValue(row.value, row) : row.value}
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
            borderTop: `1px solid ${theme.border}`,
            color: theme.textSecondary,
          }}
        >
          <span>{t('common.total')}</span>
          <span style={{ color: theme.text, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {formatValue ? formatValue(sum) : sum}
          </span>
        </div>
      )}
    </div>
  );
}
