import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import {
  SERIES,
  INK,
  axisMoney,
  tooltipMoney,
  axisMonth,
  dashOf,
  cartesianDefaults,
} from '../../components/charts/chartTheme.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * Income against spending, and — the part that used to be missing — the
 * difference between them.
 *
 * The card showed two absolute numbers and left "did I make money this month"
 * as arithmetic for the reader, which is the one question a cashflow chart is
 * actually asked. The net is now its own series, drawn dashed against a zero
 * line so a month below the axis is visible as a shape rather than as a
 * comparison of two bar heights.
 *
 * Income against expense reads better as two lines than as pairs of bars — the
 * year has a shape, and bars chop it into twelve separate comparisons — so that
 * is what it opens as. Bars are still there for anyone comparing one period.
 */
export default function Cashflow({ card, view, data, loading, nodeId, periodWord }) {
  const { t } = useT();
  const cashflow = data?.monthlyCashflow || [];

  const names = useMemo(
    () => ({ income: t('dashboard.income'), expense: t('dashboard.expenses'), net: t('dashboard.net') }),
    [t],
  );

  const rows = useMemo(
    // The engine already carries the net, rounded the way every other total
    // on the page is. Recomputing it here would drift by a cent per period.
    () => cashflow.map((m) => ({ ...m, net: m.net ?? m.income - m.expense })),
    [cashflow],
  );

  const totals = useMemo(() => {
    const income = rows.reduce((s, m) => s + m.income, 0);
    const expense = rows.reduce((s, m) => s + m.expense, 0);
    return { income, expense, net: income - expense };
  }, [rows]);

  // Keyed by node, not by widget: two cashflow cards on one dashboard are two
  // cards, and hiding a series on one must not hide it on the other.
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, [names.income, names.expense, names.net]);

  /* Hover isolation is information, not decoration: dimming everything but the
     series under the pointer answers "which one is this" where the eye already
     is. `dimOf`/`widthOf` are the two non-colour channels that carry it. */
  const seriesProps = (key, colour) => ({
    dataKey: key,
    name: names[key],
    hide: filter.hidden.has(names[key]),
    fill: colour,
    stroke: colour,
    strokeOpacity: filter.dimOf(names[key]),
    fillOpacity: filter.dimOf(names[key]),
  });

  return (
    <ChartCard
      {...card}
      title={t('widget.cashflow.name')}
      subtitle={t('widget.cashflow.desc', { period: periodWord })}
      loading={loading}
      empty={!rows.length}
      /* Every chart passes its own data as a table. ChartCard receives a built
         recharts element and cannot see behind it, so the spec has to come from
         here — where the array already is. */
      table={{
        rows,
        columns: [
          { key: 'month', label: t('common.date'), format: axisMonth },
          { key: 'income', label: names.income, align: 'right', format: eur },
          { key: 'expense', label: names.expense, align: 'right', format: eur },
          { key: 'net', label: names.net, align: 'right', format: eur },
        ],
      }}
      footnote={
        rows.length
          ? t('widget.cashflow.footnote', {
              income: eur(totals.income),
              expense: eur(totals.expense),
              net: eur(totals.net),
            })
          : undefined
      }
    >
      {view === 'bar' ? (
        /* Composed rather than a plain BarChart: recharts will not draw a Line
           inside a BarChart, and the net has to be a line — it is a consequence
           of the other two series, not a third thing measured. */
        <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
          <Tooltip
            content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />}
            cursor={{ fill: 'rgba(139,148,158,0.08)' }}
          />
          <Legend {...filter.legendProps} />
          <ReferenceLine y={0} stroke={INK.axis} />
          <Bar {...seriesProps('income', SERIES[2])} radius={[4, 4, 0, 0]} />
          <Bar {...seriesProps('expense', SERIES[1])} radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            {...seriesProps('net', SERIES[0])}
            strokeWidth={filter.widthOf(names.net)}
            strokeDasharray={dashOf(2)}
            dot={false}
            legendType="line"
          />
        </ComposedChart>
      ) : (
        <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
          <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
          <Legend {...filter.legendProps} />
          <ReferenceLine y={0} stroke={INK.axis} />
          {[
            ['income', SERIES[2]],
            ['expense', SERIES[1]],
            ['net', SERIES[0]],
          ].map(([key, colour], i) => (
            <Line
              key={key}
              type="monotone"
              {...seriesProps(key, colour)}
              /* Dash pattern and marker shape, so the three series stay apart
                 for a reader who cannot separate the hues. */
              strokeDasharray={dashOf(i)}
              strokeWidth={filter.widthOf(names[key])}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      )}
    </ChartCard>
  );
}
