import { useMemo } from 'react';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { SERIES, INK, axisMoney, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What changed, against the same span immediately before this one.
 *
 * The engine has computed this since long before the dashboard was a layout —
 * `computeCategoryShifts` ships on `/analytics` as `shifts` — and nothing drew
 * it. Every other card answers "how much"; this is the only one that answers
 * "compared to what", which is the question a number on its own cannot.
 *
 * Direction is geometry, not hue. The bars diverge from a zero line, so a
 * category that cost more sits to one side of it and one that cost less sits to
 * the other, and the figure at the end of each bar carries its own sign. Hue
 * would have been a judgement the data does not support — spending more on
 * health is not a worse month than spending less.
 */
export default function Movers({ card, data, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const rows = useMemo(() => (data?.shifts || []).slice().sort((a, b) => b.delta - a.delta), [data]);
  const xAxis = useMemo(() => fitAxis(rows.map((r) => r.delta), { pad: 0.12 }), [rows]);
  /* A category axis 110px wide inside a card 300px wide leaves the bars no room
     to be a chart. The card's own height is the only thing here that knows how
     narrow it is, and the two move together — the narrow widths are the short
     ones. */
  const narrow = (card?.height ?? 280) < 220;

  return (
    <ChartCard
      {...card}
      title={t('widget.movers.name')}
      subtitle={t('widget.movers.desc')}
      loading={loading}
      empty={!rows.length}
      table={{
        rows,
        columns: [
          { key: 'category', label: t('common.category') },
          { key: 'previous', label: t('widget.movers.before'), align: 'right', format: eur },
          { key: 'current', label: t('common.amount'), align: 'right', format: eur },
          {
            key: 'delta',
            label: t('widget.movers.change'),
            align: 'right',
            format: (v) => `${v > 0 ? '+' : ''}${eur(v)}`,
          },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 64, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
        <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
        <YAxis
          type="category"
          dataKey="category"
          width={narrow ? 80 : 110}
          {...cartesianDefaults.axis}
          tickFormatter={(v) => (narrow && v.length > 10 ? `${v.slice(0, 10)}…` : v)}
        />
        <Tooltip content={<ChartTooltip formatValue={eur} />} cursor={{ fill: theme.cursor }} />
        <ReferenceLine x={0} stroke={INK.axis} />
        <Bar dataKey="delta" name={t('widget.movers.change')} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((row) => (
            /* One hue for every bar. Which side of the line it lands on is the
               direction, and the stroke keeps two adjacent bars apart. */
            <Cell key={row.category} fill={SERIES[0]} stroke={theme.surface1} strokeWidth={1} />
          ))}
          {/* The figure at the end of the bar is the point of the card, but on a
              quarter-width one there is nowhere to put it that is not on top of
              the next bar. There it lives in the tooltip and the table. */}
          {!narrow && (
            <LabelList
              dataKey="delta"
              position="right"
              formatter={(v) => `${v > 0 ? '+' : ''}${eur(v)}`}
              fill={INK.secondary}
              fontSize={11}
            />
          )}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
