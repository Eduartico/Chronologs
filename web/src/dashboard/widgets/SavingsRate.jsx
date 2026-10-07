import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import {
  SERIES,
  STATUS,
  INK,
  axisMonth,
  cartesianDefaults,
  dashOf,
  fitAxis,
} from '../../components/charts/chartTheme.js';
import { percent } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What share of each period's income was still there at the end of it.
 *
 * Two things make this readable, and both are about the same problem: a savings
 * rate is a ratio, so one small-income month sends it somewhere no other month
 * goes and the shape of the rest is lost.
 *
 * The first is the clamp. One student month at −733% used to squash every other
 * month into a flat line along the top of the chart, so the *line* is limited
 * and the *number* never is: a month drawn at the limit gets a hollow dot and
 * its true figure in the tooltip and the table.
 *
 * The second is the trend. Even inside the limit the series sawtooths — a rent
 * period against a bonus period — and a reader asking "am I saving more than I
 * was" cannot answer it from the spikes. The dashed line is the average of the
 * last few periods, which is the question the card is actually asked. The raw
 * series stays; it is the trend that is derived, not the other way round.
 */
const TREND_WINDOW = 3;

export default function SavingsRate({ card, data, loading }) {
  const { t } = useT();
  // Over days or weeks the server sends the rate *so far* rather than a rate
  // per bucket (most days have no income to divide by), and a running figure
  // has already done the calming a trailing average would do.
  const running = data?.range?.granularity === 'day' || data?.range?.granularity === 'week';

  const rows = useMemo(() => {
    const source = data?.savingsRate || [];
    if (running) return source.map((row) => ({ ...row, trend: null }));
    const window = [];
    return source.map((row) => {
      if (row.rate != null) {
        window.push(row.rate);
        if (window.length > TREND_WINDOW) window.shift();
      }
      return {
        ...row,
        // Trailing, not centred: a centred average would need periods that have
        // not happened yet to draw the most recent point.
        trend: window.length ? window.reduce((a, b) => a + b, 0) / window.length : null,
      };
    });
  }, [data, running]);

  const clampedMonths = rows.filter((r) => r.clamped).length;

  /* Fitted to what is drawn, then held inside the clamp. A year that never
     leaves −20%..60% was being drawn on a ±100% axis, so the interesting band
     occupied two fifths of the card and the rest was empty gridlines. */
  const yAxis = useMemo(() => {
    const fit = fitAxis(
      rows.flatMap((r) => [r.rate, r.trend]).filter((v) => v != null),
      { maxTicks: 6 },
    );
    if (!fit.domain) return {};
    return {
      domain: [Math.max(-100, fit.domain[0]), Math.min(100, fit.domain[1])],
      ticks: fit.ticks.filter((v) => v >= -100 && v <= 100),
    };
  }, [rows]);

  return (
    <ChartCard
      {...card}
      title={t('widget.savings.name')}
      subtitle={
        clampedMonths
          ? t('dashboard.savingsRateClamped', { count: clampedMonths })
          : running
            ? t('widget.savings.descRunning')
            : t('widget.savings.desc')
      }
      loading={loading}
      empty={!rows.some((r) => r.rate != null)}
      emptyMessage={t('dashboard.savingsRateEmpty')}
      table={{
        rows,
        columns: [
          { key: 'month', label: t('common.date'), format: axisMonth },
          {
            key: 'rate',
            label: t('dashboard.rate'),
            align: 'right',
            // The clamped months report what actually happened, not what was
            // drawn — the chart is what is limited, the data never is.
            format: (v, row) => percent(row?.clamped ? row.trueRate : v),
          },
          {
            key: 'trend',
            label: t('widget.savings.trend', { count: TREND_WINDOW }),
            align: 'right',
            format: (v) => percent(v),
          },
        ],
      }}
    >
      <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
        <YAxis
          {...yAxis}
          tickFormatter={(v) => percent(v, { digits: 0 })}
          {...cartesianDefaults.axis}
          width={44}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatLabel={axisMonth}
              formatValue={(v, entry) =>
                percent(entry?.payload?.clamped && entry?.dataKey === 'rate' ? entry.payload.trueRate : v)
              }
            />
          }
        />
        <ReferenceLine y={0} stroke={INK.axis} />
        <Line
          type="monotone"
          dataKey="rate"
          name={t('widget.savings.name')}
          stroke={SERIES[2]}
          strokeWidth={2}
          // A hollow dot marks a month drawn at the limit rather than at its real
          // value, so a clipped point never reads as an ordinary one.
          dot={(props) =>
            running && !props.payload?.clamped ? (
              <g key={props.payload.month} />
            ) : props.payload?.clamped ? (
              <circle
                key={props.payload.month}
                cx={props.cx}
                cy={props.cy}
                r={4}
                fill={STATUS.critical}
                stroke={SERIES[2]}
                strokeWidth={2}
              />
            ) : (
              <circle key={props.payload.month} cx={props.cx} cy={props.cy} r={3} fill={SERIES[2]} />
            )
          }
          activeDot={{ r: 5 }}
          connectNulls
        />
        {/* Dashed and thinner, so the derived line never reads as a second
            measurement — it is the same numbers, calmed down. */}
        {!running && <Line
          type="monotone"
          dataKey="trend"
          name={t('widget.savings.trend', { count: TREND_WINDOW })}
          stroke={SERIES[0]}
          strokeWidth={1.5}
          strokeDasharray={dashOf(1)}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
        />}
      </LineChart>
    </ChartCard>
  );
}
