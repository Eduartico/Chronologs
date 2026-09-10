import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { SERIES, STATUS, INK, axisMonth, cartesianDefaults } from '../../components/charts/chartTheme.js';
import { nf } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';

/**
 * What share of each period's income was still there at the end of it.
 *
 * The axis is fixed to ±100%. One student month at −733% used to squash every
 * other month into a flat line along the top of the chart, so the line is
 * clamped and the number never is: a month drawn at the limit gets a hollow dot
 * and its true figure in the tooltip and the table.
 */
export default function SavingsRate({ card, data, loading }) {
  const { t } = useT();

  const rows = data?.savingsRate || [];
  const clampedMonths = rows.filter((r) => r.clamped).length;
  const percent = (v) => (v == null ? '—' : `${nf({ maximumFractionDigits: 1 }).format(v)}%`);

  return (
    <ChartCard
      {...card}
      title={t('widget.savings.name')}
      subtitle={
        clampedMonths
          ? t('dashboard.savingsRateClamped', { count: clampedMonths })
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
        ],
      }}
    >
      <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
        <YAxis
          domain={[-100, 100]}
          ticks={[-100, -50, 0, 50, 100]}
          tickFormatter={(v) => `${v}%`}
          {...cartesianDefaults.axis}
          width={44}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatLabel={axisMonth}
              formatValue={(v, entry) => (entry?.payload?.clamped ? `${entry.payload.trueRate}%` : `${v}%`)}
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
            props.payload?.clamped ? (
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
      </LineChart>
    </ChartCard>
  );
}
