import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { api } from '../../../lib/api.js';
import { eur } from '../../../lib/money.js';
import { useT } from '../../../i18n/index.js';
import ChartCard from '../ChartCard.jsx';
import ChartTooltip from '../ChartTooltip.jsx';
import { useChartTheme } from '../ChartThemeProvider.jsx';
import { seriesFill } from '../ChartPatterns.jsx';
import { colorScale } from '../chartTheme.js';

/**
 * Spending as two rings: parent categories inside, their children outside.
 *
 * The dashboard's pie flattens the hierarchy — a category and its subcategory
 * are two unrelated slices of the same circle, so "how much went on transport
 * altogether" is a sum the reader has to do by eye. The inner ring is that sum.
 *
 * The parent relationship lives on the category registry rather than on a
 * transaction (`parent` in server/engines/categorization.js), so this is the one
 * experimental chart that needs a second request. A category with no parent is
 * its own parent, which is what makes a flat registry render as a plain
 * doughnut rather than as an error.
 */
export default function CategorySunburst({ breakdown, loading }) {
  const { t } = useT();
  const theme = useChartTheme();
  const [parents, setParents] = useState({});

  useEffect(() => {
    let cancelled = false;
    api
      .getCategories()
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result) ? result : result?.categories || [];
        setParents(Object.fromEntries(list.filter((c) => c.parent).map((c) => [c.name || c.id, c.parent])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { inner, outer, total } = useMemo(() => {
    const leaves = (breakdown || [])
      .filter((row) => row.expense > 0)
      .map((row) => ({ name: row.category, parent: parents[row.category] || row.category, value: row.expense }))
      .sort((a, b) => b.value - a.value);

    const grouped = new Map();
    for (const leaf of leaves) grouped.set(leaf.parent, (grouped.get(leaf.parent) || 0) + leaf.value);

    return {
      // Children sorted under their parent, so the two rings line up instead of
      // an outer slice sitting opposite the inner one it belongs to.
      outer: [...grouped.keys()].flatMap((parent) => leaves.filter((l) => l.parent === parent)),
      inner: [...grouped.entries()].map(([name, value]) => ({ name, value })),
      total: leaves.reduce((sum, l) => sum + l.value, 0),
    };
  }, [breakdown, parents]);

  const colours = useMemo(() => colorScale(inner.map((r) => r.name), theme), [inner, theme]);
  // `colorScale` returns a *function* with an `.indexOf`, not a lookup object.
  // Subscripting it silently yields undefined, which every fill below then
  // resolves to the first series colour — a chart painted entirely one hue.
  const colourOf = (row) => colours(row.parent || row.name);

  return (
    <ChartCard
      title={t('experimental.sunburst.title')}
      subtitle={t('experimental.sunburst.subtitle')}
      loading={loading}
      empty={!outer.length}
      height={360}
      storageKey="x-sunburst"
      table={{
        rows: outer,
        colorBy: 'name',
        colorOf: colourOf,
        columns: [
          { key: 'parent', label: t('experimental.sunburst.group') },
          { key: 'name', label: t('common.category') },
          { key: 'value', label: t('common.amount'), align: 'right', format: eur },
        ],
      }}
    >
      <PieChart>
        <Pie data={inner} dataKey="value" nameKey="name" outerRadius="55%" isAnimationActive={false}>
          {inner.map((row, i) => (
            <Cell
              key={row.name}
              fill={seriesFill(theme, i, colours(row.name))}
              stroke={theme.surface1}
              strokeWidth={2}
            />
          ))}
        </Pie>
        {/* The child ring is the same hue as its parent, one shade lighter, so
            the grouping reads without a legend and without twelve new colours. */}
        <Pie data={outer} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="80%" isAnimationActive={false}>
          {/* The pattern index has to be the *parent's*, not this slice's:
              `seriesFill` picks a hatch keyed to a series colour, so pairing a
              parent's hue with a child's index paints the two rings in
              different colours and destroys the grouping the chart exists for. */}
          {outer.map((row) => (
            <Cell
              key={`${row.parent}-${row.name}`}
              fill={seriesFill(theme, Math.max(0, colours.indexOf(row.parent || row.name)), colourOf(row))}
              fillOpacity={row.parent === row.name ? 1 : 0.62}
              stroke={theme.surface1}
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip formatValue={eur} total={total} />} />
      </PieChart>
    </ChartCard>
  );
}
