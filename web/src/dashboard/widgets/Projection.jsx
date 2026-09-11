import { useMemo } from 'react';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { SERIES, INK, axisMoney, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * Where this month lands if the rest of it looks like the part that has
 * happened.
 *
 * Three bars, because a projection on its own is a number with nothing to
 * disagree with. Spent so far is fact; projected is that figure scaled by the
 * days remaining; typical is what a month of this year has usually cost. The
 * third bar is the one that makes the second one mean anything.
 *
 * The engine returns nothing at all once the month is over, which is correct —
 * there is nothing left to project — so the card says so rather than drawing a
 * projection that is just the month's total wearing a different label.
 */
export default function Projection({ card, data, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const projection = data?.projection || null;
  const typical = data?.insights?.averageMonth ?? 0;

  const rows = useMemo(() => {
    if (!projection) return [];
    return [
      { key: 'soFar', name: t('widget.projection.soFar'), value: projection.expenseSoFar, actual: true },
      { key: 'projected', name: t('widget.projection.projected'), value: projection.projectedExpense },
      { key: 'typical', name: t('widget.projection.typical'), value: typical },
    ];
  }, [projection, typical, t]);

  const yAxis = useMemo(() => fitAxis(rows.map((r) => r.value)), [rows]);

  return (
    <ChartCard
      {...card}
      title={t('widget.projection.name')}
      subtitle={
        projection
          ? t('widget.projection.desc', { day: projection.dayOfMonth, days: projection.daysInMonth })
          : undefined
      }
      loading={loading}
      empty={!rows.length}
      emptyMessage={t('widget.projection.empty')}
      table={{
        rows,
        columns: [
          { key: 'name', label: t('common.description') },
          { key: 'value', label: t('common.amount'), align: 'right', format: eur },
        ],
      }}
    >
      <BarChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="name" {...cartesianDefaults.axis} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
        <Tooltip content={<ChartTooltip formatValue={eur} />} cursor={{ fill: theme.cursor }} />
        <Bar dataKey="value" name={t('common.amount')} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {rows.map((row) => (
            /* What has happened is drawn solid; what is inferred is drawn
               hollow. A projection that looks exactly like a measurement is a
               projection the reader will quote back as one. */
            <Cell
              key={row.key}
              fill={row.actual ? SERIES[0] : 'transparent'}
              stroke={SERIES[0]}
              strokeWidth={2}
              strokeDasharray={row.actual ? '0' : '4 3'}
            />
          ))}
          <LabelList dataKey="value" position="top" formatter={eur} fill={INK.secondary} fontSize={11} />
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
