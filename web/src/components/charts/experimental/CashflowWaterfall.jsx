import { useMemo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { eur } from '../../../lib/money.js';
import { useT } from '../../../i18n/index.js';
import ChartCard from '../ChartCard.jsx';
import ChartTooltip from '../ChartTooltip.jsx';
import { useChartTheme } from '../ChartThemeProvider.jsx';
import { axisMoney, axisMonth, cartesianDefaults } from '../chartTheme.js';

/**
 * How the balance got from where it started to where it ended.
 *
 * The cashflow chart shows income and spending side by side each month, which
 * says what happened but not what it accumulated to. A waterfall says both: each
 * month is a step up or down from the running total, and the two ends are the
 * balance at the start and at the end of the range.
 *
 * Built from an ordinary stacked bar with a transparent base — Recharts has no
 * waterfall, and it does not need one. The invisible bar carries the offset; the
 * visible one carries the step.
 *
 * Direction is not carried by colour alone: an up month and a down month differ
 * in which side of the running line they sit, and each bar states its own signed
 * value in the tooltip and the table.
 */
export default function CashflowWaterfall({ cashflow, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const rows = useMemo(() => {
    const months = cashflow || [];
    const out = [];
    let running = 0;
    for (const month of months) {
      const step = month.net;
      // `base` is the invisible part: the height the visible bar starts at. For a
      // fall it starts at the *new* total, so the bar hangs down from the old one.
      out.push({
        month: month.month,
        step,
        base: step >= 0 ? running : running + step,
        magnitude: Math.abs(step),
        from: running,
        to: running + step,
      });
      running += step;
    }
    return out;
  }, [cashflow]);

  const closing = rows.length ? rows[rows.length - 1].to : 0;

  return (
    <ChartCard
      title={t('experimental.waterfall.title')}
      subtitle={t('experimental.waterfall.subtitle')}
      loading={loading}
      empty={!rows.length}
      height={320}
      storageKey="x-waterfall"
      footnote={t('experimental.waterfall.footnote', { closing: eur(closing) })}
      table={{
        rows,
        columns: [
          { key: 'month', label: t('common.period') },
          { key: 'step', label: t('experimental.waterfall.change'), align: 'right', format: eur },
          { key: 'to', label: t('experimental.waterfall.runningTotal'), align: 'right', format: eur },
        ],
      }}
    >
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} />
        <ReferenceLine y={0} stroke={theme.axis} />
        <Tooltip
          cursor={{ fill: theme.cursor }}
          content={
            <ChartTooltip
              formatValue={eur}
              // The stacked base is scaffolding, not data — showing it in the
              // tooltip would put a number on screen that means nothing.
              filter={(entry) => entry.dataKey !== 'base'}
            />
          }
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="magnitude" stackId="w" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {/*
            Solid fills, deliberately not `seriesFill`. The hatch patterns are
            keyed to the eight *series* colours, so texturing these bars would
            paint them series-1 and series-2 and quietly throw away the one thing
            their colour is for — direction, which has to follow --pnl-up and
            --pnl-down so the colourblind-safe finance setting still swaps it.
            The non-colour channel is already here and stronger: an up month sits
            above the running line and a down month hangs below it, and the
            signed figure is in the tooltip and the table.
          */}
          {rows.map((row) => (
            <Cell
              key={row.month}
              fill={row.step >= 0 ? theme.pnlUp : theme.pnlDown}
              stroke={theme.surface1}
              strokeWidth={2}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
