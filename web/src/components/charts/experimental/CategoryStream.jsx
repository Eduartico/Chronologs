import { useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, Legend } from 'recharts';
import { eur } from '../../../lib/money.js';
import { useT } from '../../../i18n/index.js';
import ChartCard from '../ChartCard.jsx';
import ChartTooltip from '../ChartTooltip.jsx';
import { useChartTheme } from '../ChartThemeProvider.jsx';
import { useSeriesToggle } from '../useSeriesToggle.jsx';
import { seriesFill } from '../ChartPatterns.jsx';
import { colorScale, capSeries, axisMonth, cartesianDefaults } from '../chartTheme.js';

/**
 * Category spending over time, stacked around a floating centre.
 *
 * The dashboard already stacks these on a zero baseline. A streamgraph is the
 * same numbers with the stack centred, which trades one thing for another and is
 * exactly why it is worth a fortnight rather than an argument: the shape of each
 * band — when a category swelled, when it vanished — becomes much easier to
 * follow, and the absolute total at any month becomes much harder to read,
 * because no band sits on a fixed axis any more.
 *
 * So there is no Y axis at all here. Drawing one would invite reading values off
 * it that the silhouette offset makes meaningless; the table carries the exact
 * figures instead.
 */
export default function CategoryStream({ trend, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const { categories, rows } = useMemo(() => {
    const all = trend?.categories || [];
    const source = trend?.rows || [];
    // Same cap as every other multi-series chart: past eight, the ramp starts
    // repeating itself and two different categories share a colour.
    const totals = all.map((name) => ({
      name,
      value: source.reduce((sum, row) => sum + (row[name] || 0), 0),
    }));
    const kept = capSeries(totals, { key: 'name', value: 'value', max: 8 });
    const keptNames = kept.filter((k) => !k.isOther).map((k) => k.name);
    const hasOther = kept.some((k) => k.isOther);
    const otherName = t('chart.other');

    const folded = source.map((row) => {
      const next = { period: row.period };
      let other = 0;
      for (const name of all) {
        if (keptNames.includes(name)) next[name] = row[name] || 0;
        else other += row[name] || 0;
      }
      if (hasOther) next[otherName] = other;
      return next;
    });

    return { categories: hasOther ? [...keptNames, otherName] : keptNames, rows: folded };
  }, [trend, t]);

  const colours = useMemo(() => colorScale(categories, theme), [categories, theme]);
  const toggle = useSeriesToggle('x-stream', categories);

  return (
    <ChartCard
      title={t('experimental.streamgraph.title')}
      subtitle={t('experimental.streamgraph.subtitle')}
      loading={loading}
      empty={!rows.length || !categories.length}
      height={320}
      storageKey="x-stream"
      footnote={t('experimental.streamgraph.footnote')}
      table={{
        rows,
        columns: [
          { key: 'period', label: t('common.period') },
          ...categories.map((name) => ({ key: name, label: name, align: 'right', format: eur })),
        ],
      }}
    >
      <AreaChart data={rows} stackOffset="silhouette" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis dataKey="period" tickFormatter={axisMonth} {...cartesianDefaults.axis} />
        <Tooltip content={<ChartTooltip formatValue={eur} />} cursor={{ stroke: theme.cursor }} />
        <Legend {...toggle.legendProps} />
        {categories.map((name, i) => (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            stackId="stream"
            hide={toggle.hidden.has(name)}
            stroke={colours(name)}
            strokeWidth={toggle.widthOf(name, 1)}
            fill={seriesFill(theme, i, colours(name))}
            fillOpacity={toggle.dimOf(name)}
            strokeOpacity={toggle.dimOf(name)}
            isAnimationActive={false}
            {...toggle.focusProps}
          />
        ))}
      </AreaChart>
    </ChartCard>
  );
}
