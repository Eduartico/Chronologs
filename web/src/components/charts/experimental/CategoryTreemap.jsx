import { useMemo } from 'react';
import { Treemap, Tooltip } from 'recharts';
import { eur } from '../../../lib/money.js';
import { nf } from '../../../lib/locale.js';
import { useT } from '../../../i18n/index.js';
import ChartCard from '../ChartCard.jsx';
import ChartTooltip from '../ChartTooltip.jsx';
import { useChartTheme } from '../ChartThemeProvider.jsx';
import { inkOn } from '../../../lib/contrastInk.js';
import { seriesFill } from '../ChartPatterns.jsx';
import { colorScale } from '../chartTheme.js';

/**
 * Spending by category, as area.
 *
 * The pie on the dashboard answers the same question and runs out of room at
 * about six slices — beyond that the labels collide and the small shares become
 * slivers with no readable angle. A treemap keeps every category on screen at a
 * size that is still comparable, which is the whole argument for trying it.
 *
 * Where it is weaker, and worth watching for while judging it: area is harder to
 * compare than angle when two rectangles have different aspect ratios, so "which
 * of these two is bigger" is a question this answers *less* well than the pie.
 */
export default function CategoryTreemap({ breakdown, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const rows = useMemo(
    () =>
      (breakdown || [])
        .filter((row) => row.expense > 0)
        .map((row) => ({ name: row.category, value: row.expense, count: row.count }))
        .sort((a, b) => b.value - a.value),
    [breakdown],
  );

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const colours = useMemo(() => colorScale(rows.map((r) => r.name), theme), [rows, theme]);

  return (
    <ChartCard
      title={t('experimental.treemap.title')}
      subtitle={t('experimental.treemap.subtitle')}
      loading={loading}
      empty={!rows.length}
      height={340}
      storageKey="x-treemap"
      table={{
        rows: rows.map((row) => ({ ...row, share: total ? (row.value / total) * 100 : 0 })),
        colorBy: 'name',
        colorOf: (row) => colours(row.name),
        columns: [
          { key: 'name', label: t('common.category') },
          { key: 'value', label: t('common.amount'), align: 'right', format: eur },
          {
            key: 'share',
            label: t('experimental.share'),
            align: 'right',
            format: (v) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`,
          },
          { key: 'count', label: t('common.count'), align: 'right' },
        ],
      }}
    >
      <Treemap
        data={rows}
        dataKey="value"
        nameKey="name"
        isAnimationActive={false}
        content={<TreemapCell theme={theme} colours={colours} total={total} />}
      >
        <Tooltip content={<ChartTooltip formatValue={eur} total={total} />} />
      </Treemap>
    </ChartCard>
  );
}

/**
 * One rectangle.
 *
 * Recharts' default cell has no separator and no label, so adjacent categories
 * of similar colour read as one shape. The surface-coloured stroke is the same
 * rule the pie slices follow, and the label is dropped rather than clipped when
 * the box is too small to hold it — a truncated word is worse than none, because
 * "Trans…" and "Transp…" are two different categories.
 */
function TreemapCell({ x, y, width, height, name, value, theme, colours, total }) {
  if (!(width > 0 && height > 0)) return null;
  // `colorScale` is a function with an `.indexOf`, not an object: subscripting
  // it gave undefined for every cell, and the whole treemap came out one blue.
  const colour = colours(name);
  const index = Math.max(0, colours.indexOf(name));
  const roomy = width > 74 && height > 34;
  const ink = inkOn(colour);
  const share = total ? Math.round((value / total) * 100) : 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={seriesFill(theme, index < 0 ? 0 : index, colour)}
        stroke={theme.surface1}
        strokeWidth={2}
      />
      {roomy && (
        <>
          {/* Ink computed against this cell's own fill. Using the surface colour
              was right by luck on a dark theme and unreadable on a light one —
              CSS cannot decide this, which is why contrastInk.js exists. */}
          <text x={x + 8} y={y + 18} fill={ink} fontSize={12} fontWeight={600}>
            {name}
          </text>
          <text x={x + 8} y={y + 33} fill={ink} fontSize={11} opacity={0.85}>
            {share}%
          </text>
        </>
      )}
    </g>
  );
}
