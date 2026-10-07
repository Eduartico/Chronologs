import { useMemo } from 'react';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import {
  SERIES,
  INK,
  axisMoney,
  axisMonth,
  tooltipMoney,
  dashOf,
  cartesianDefaults,
  fitAxis,
} from '../../components/charts/chartTheme.js';
import { eur, percent } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What went into investments, period by period, and how much in all.
 *
 * The other half of taking investing out of "spending". Once an ETF purchase
 * stopped counting as an expense it had to be visible somewhere, or the money
 * would simply vanish from the dashboard — so this card draws it as what it is:
 * money put to work, net of anything sold back, with the running total over the
 * range beside it.
 *
 * Bars are the net per period. A period that sold more than it bought is a bar
 * below zero — it is drawn hollow as well as below the line, so "took money out"
 * is not read off the axis alone. The line is the cumulative sum across the
 * range, the "how much have I put in since January" figure.
 */
export default function Investing({ card, view, data, loading, nodeId, periodWord }) {
  const { t } = useT();

  const rows = useMemo(() => {
    let running = 0;
    return (data?.monthlyCashflow || []).map((m) => {
      running += m.invested || 0;
      return {
        month: m.month,
        invested: Math.round((m.invested || 0) * 100) / 100,
        cumulative: Math.round(running * 100) / 100,
        // Share of what came in that period that went into investments.
        share: m.income > 0 ? ((m.invested || 0) / m.income) * 100 : null,
      };
    });
  }, [data]);

  const names = useMemo(
    () => ({ invested: t('widget.investing.perPeriod', { period: periodWord }), cumulative: t('widget.investing.cumulative') }),
    [t, periodWord],
  );
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, [names.invested, names.cumulative]);

  const yAxis = useMemo(() => {
    const visible = [];
    for (const row of rows) {
      if (!filter.hidden.has(names.invested)) visible.push(row.invested);
      if (!filter.hidden.has(names.cumulative)) visible.push(row.cumulative);
    }
    return fitAxis(visible);
  }, [rows, filter.hidden, names]);

  const total = rows.length ? rows[rows.length - 1].cumulative : 0;
  const income = (data?.monthlyCashflow || []).reduce((s, m) => s + m.income, 0);
  const any = rows.some((r) => r.invested);

  return (
    <ChartCard
      {...card}
      title={t('widget.investing.name')}
      subtitle={t('widget.investing.desc')}
      loading={loading}
      empty={!any}
      emptyMessage={t('widget.investing.empty')}
      footnote={
        any
          ? [
              t('widget.investing.footnote', { amount: eur(total) }),
              income > 0 && total > 0 ? t('dashboard.investedHint', { rate: percent((total / income) * 100) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      table={{
        rows,
        columns: [
          { key: 'month', label: t('common.date'), format: axisMonth },
          { key: 'invested', label: names.invested, align: 'right', format: eur },
          { key: 'cumulative', label: names.cumulative, align: 'right', format: eur },
          { key: 'share', label: t('widget.investing.share'), align: 'right', format: (v) => (v == null ? '—' : percent(v)) },
        ],
      }}
    >
      <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
        <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
        <Legend {...filter.legendProps} />
        <ReferenceLine y={0} stroke={INK.axis} />
        <Bar
          dataKey="invested"
          name={names.invested}
          hide={filter.hidden.has(names.invested)}
          fill={SERIES[3]}
          fillOpacity={filter.dimOf(names.invested)}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          {rows.map((row) => (
            <Cell
              key={row.month}
              fill={row.invested < 0 ? 'transparent' : SERIES[3]}
              stroke={SERIES[3]}
              strokeWidth={row.invested < 0 ? 2 : 0}
            />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulative"
          name={names.cumulative}
          hide={filter.hidden.has(names.cumulative)}
          stroke={SERIES[0]}
          strokeOpacity={filter.dimOf(names.cumulative)}
          strokeWidth={filter.widthOf(names.cumulative)}
          strokeDasharray={dashOf(1)}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartCard>
  );
}
