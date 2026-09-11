import { useMemo } from 'react';
import { BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { SERIES, INK, axisMoney, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { formatDate } from '../../lib/format.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What is already spoken for before the month starts.
 *
 * `detectRecurringSubscriptions` finds charges that land on a regular interval
 * at a steady price, and its total — `committedMonthly` — is arguably the single
 * most useful figure the engine produces: it is the part of a month that is not
 * a decision. It has been on `/analytics` all along, shown only on the Insights
 * page, and never on the dashboard where the reader actually plans.
 *
 * Normalised to a month, so a yearly insurance premium and a monthly streaming
 * bill can be read against each other. The real cadence and the real amount are
 * both in the table; the chart is the comparison.
 */
export default function Committed({ card, data, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const all = data?.insights?.recurring || [];
  const rows = useMemo(() => all.slice(0, 10), [all]);
  const xAxis = useMemo(() => fitAxis(rows.map((r) => r.monthlyCost)), [rows]);
  const narrow = (card?.height ?? 280) < 220;

  return (
    <ChartCard
      {...card}
      title={t('widget.committed.name')}
      subtitle={t('widget.committed.desc')}
      loading={loading}
      empty={!rows.length}
      footnote={
        all.length
          ? t('widget.committed.footnote', { amount: eur(data?.insights?.committedMonthly ?? 0) })
          : undefined
      }
      table={{
        rows: all,
        columns: [
          { key: 'merchant', label: t('dashboard.merchant') },
          { key: 'monthlyCost', label: t('widget.committed.perMonth'), align: 'right', format: eur },
          { key: 'avgAmount', label: t('common.amount'), align: 'right', format: eur },
          { key: 'count', label: t('common.count'), align: 'right' },
          { key: 'lastDate', label: t('common.date'), align: 'right', format: formatDate },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 64, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
        <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
        <YAxis
          type="category"
          dataKey="merchant"
          width={narrow ? 90 : 140}
          {...cartesianDefaults.axis}
          tickFormatter={(v) => {
            const max = narrow ? 12 : 20;
            return v.length > max ? `${v.slice(0, max)}…` : v;
          }}
        />
        <Tooltip content={<ChartTooltip formatValue={eur} />} cursor={{ fill: theme.cursor }} />
        <Bar dataKey="monthlyCost" name={t('widget.committed.perMonth')} fill={SERIES[0]} radius={[0, 4, 4, 0]}>
          {!narrow && (
            <LabelList dataKey="monthlyCost" position="right" formatter={eur} fill={INK.secondary} fontSize={11} />
          )}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
