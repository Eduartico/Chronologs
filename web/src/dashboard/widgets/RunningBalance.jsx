import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import {
  SERIES,
  INK,
  axisMoney,
  tooltipMoney,
  axisMonth,
  cartesianDefaults,
  fitAxis,
} from '../../components/charts/chartTheme.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * The balance, added up period by period — as a level, or as the steps that got
 * it there.
 *
 * The waterfall used to be its own card, "How the balance got here", sitting a
 * few hundred pixels below this one and drawing the same series. It is not a
 * different question: a waterfall *is* the running balance decomposed into its
 * per-period increments. Same numbers, different mark, so it is a view.
 *
 * The waterfall is built from an ordinary stacked bar with a transparent base —
 * recharts has no waterfall and does not need one. The invisible bar carries the
 * offset; the visible one carries the step. Direction is not colour alone: an up
 * period sits above the running line and a down one hangs below it, and each bar
 * states its signed value in the tooltip and the table.
 */
export default function RunningBalance({ card, view, data, loading, nodeId, periodWord }) {
  const { t } = useT();
  const theme = useChartTheme();

  const cumulative = data?.cumulative || [];
  const cashflow = data?.monthlyCashflow || [];

  /** The steps, and the running total each one lands on. Derived from the
      cashflow rather than from `cumulative`, because a step needs the period's
      own net and the level series has already thrown that away. */
  const steps = useMemo(() => {
    const out = [];
    let running = 0;
    for (const month of cashflow) {
      // The engine already rounds this; recomputing it here would drift from
      // every other total on the page by a cent per period.
      const step = month.net ?? month.income - month.expense;
      out.push({
        month: month.month,
        step,
        // For a fall the bar starts at the *new* total, so it hangs down from
        // the old one rather than standing on it.
        base: step >= 0 ? running : running + step,
        magnitude: Math.abs(step),
        to: running + step,
      });
      running += step;
    }
    return out;
  }, [cashflow]);

  const waterfall = view === 'waterfall';
  const rows = waterfall ? steps : cumulative;
  const closing = steps.length ? steps[steps.length - 1].to : 0;

  /* Sized on the levels the line actually reaches, not on a step rounded up from
     zero — a balance topping out at 6K was being drawn on an axis reaching 8K.
     The waterfall measures the same thing from both ends of each bar, since a
     step that falls is drawn hanging from the level above it. */
  const yAxis = useMemo(
    () =>
      fitAxis(
        waterfall
          ? steps.flatMap((row) => [row.base, row.base + row.magnitude])
          : cumulative.map((row) => row.cumulative),
      ),
    [waterfall, steps, cumulative],
  );

  return (
    <ChartCard
      {...card}
      title={t('widget.balance.name')}
      subtitle={waterfall ? t('widget.balance.descSteps', { period: periodWord }) : t('widget.balance.desc')}
      loading={loading}
      empty={!rows.length}
      footnote={waterfall ? t('widget.balance.footnote', { closing: eur(closing) }) : undefined}
      table={
        waterfall
          ? {
              rows: steps,
              columns: [
                { key: 'month', label: t('common.date'), format: axisMonth },
                { key: 'step', label: t('widget.balance.change'), align: 'right', format: eur },
                { key: 'to', label: t('widget.balance.runningTotal'), align: 'right', format: eur },
              ],
            }
          : {
              rows: cumulative,
              columns: [
                { key: 'month', label: t('common.date'), format: axisMonth },
                { key: 'cumulative', label: t('common.total'), align: 'right', format: eur },
              ],
            }
      }
    >
      {waterfall ? (
        <BarChart data={steps} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
          <ReferenceLine y={0} stroke={theme.axis} />
          <Tooltip
            cursor={{ fill: theme.cursor }}
            content={
              <ChartTooltip
                formatValue={eur}
                // The stacked base is scaffolding, not data — showing it would
                // put a number on screen that means nothing.
                filter={(entry) => entry.dataKey !== 'base'}
              />
            }
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="magnitude" stackId="w" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {/*
              Solid fills, deliberately not `seriesFill`. The hatch patterns are
              keyed to the eight *series* colours, so texturing these bars would
              paint them series-1 and series-2 and throw away the one thing their
              colour is for — direction, which follows --pnl-up/--pnl-down so the
              colourblind-safe finance setting still swaps it.
            */}
            {steps.map((row) => (
              <Cell
                key={row.month}
                fill={row.step >= 0 ? theme.pnlUp : theme.pnlDown}
                stroke={theme.surface1}
                strokeWidth={2}
              />
            ))}
          </Bar>
        </BarChart>
      ) : view === 'line' ? (
        <LineChart data={cumulative} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
          <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
          <ReferenceLine y={0} stroke={INK.axis} />
          <Line
            type="monotone"
            dataKey="cumulative"
            name={t('widget.balance.name')}
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      ) : (
        <AreaChart data={cumulative} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {/* SVG ids are document-global. Two running-balance cards on one
                dashboard sharing an id means the second one paints with the
                first one's gradient, so the node's own handle goes in it. */}
            <linearGradient id={`gCum-${nodeId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
          <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
          <ReferenceLine y={0} stroke={INK.axis} />
          <Area
            type="monotone"
            dataKey="cumulative"
            name={t('widget.balance.name')}
            stroke={SERIES[0]}
            strokeWidth={2}
            fill={`url(#gCum-${nodeId})`}
          />
        </AreaChart>
      )}
    </ChartCard>
  );
}
