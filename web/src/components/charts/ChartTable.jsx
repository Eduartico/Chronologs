import { useT } from '../../i18n/index.js';

/**
 * A chart's data, as a table.
 *
 * Every chart in the app renders one of these, always — visibly when the reader
 * asks for it, and inside a screen-reader-only wrapper when the chart is showing.
 * An SVG full of `<path>` elements says nothing to a screen reader no matter how
 * many `aria-label`s it carries, and these are ≤50-row tables, so the cost of
 * always rendering one is nothing.
 *
 * `colorBy` names the column whose value maps to a series colour, so the swatch
 * carries the same mapping the chart used and the two can be read side by side.
 */
export default function ChartTable({ title, rows = [], columns = [], colorBy, colorOf }) {
  const { t } = useT();

  if (!rows.length) return <p className="empty-state">{t('chart.empty')}</p>;

  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <caption className="sr-only">{t('chart.tableLabel', { title })}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.align === 'right' ? 'num' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row[columns[0]?.key] ?? i}>
              {columns.map((col, c) => {
                const value = col.get ? col.get(row) : row[col.key];
                const text = col.format ? col.format(value, row) : value;
                const swatch = c === 0 && colorBy && colorOf ? colorOf(row[colorBy], i) : null;
                return (
                  <td key={col.key} className={col.align === 'right' ? 'num' : undefined}>
                    {swatch && <span className="series-dot" style={{ background: swatch }} aria-hidden="true" />}
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
