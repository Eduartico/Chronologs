import { useMemo } from 'react';
import { BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { SERIES, INK, axisMoney, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { eur, percent } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * The ten places the most money went.
 *
 * Ranked descending — a bar chart of merchants in any other order is a list, not
 * a ranking — and each bar states its share of *total* spending rather than only
 * its amount. "€1,240" says how much; "8.3%" says whether it matters, and that
 * is the number a bar length cannot carry.
 *
 * The share is against the period's whole spend, not against the top ten, so the
 * ten percentages deliberately do not add to a hundred. Reading "12%" as "twelve
 * percent of my top ten" would be a fact about the chart rather than about the
 * money.
 */
export default function TopMerchants({ card, view, data, loading }) {
  const { t } = useT();

  const totalSpend = useMemo(
    () => (data?.monthlyCashflow || []).reduce((sum, m) => sum + m.expense, 0),
    [data],
  );

  const rows = useMemo(
    () =>
      (data?.topMerchants || [])
        .slice()
        .sort((a, b) => b.total - a.total)
        .map((row) => ({ ...row, share: totalSpend ? (row.total / totalSpend) * 100 : 0 })),
    [data, totalSpend],
  );

  const xAxis = useMemo(() => fitAxis(rows.map((r) => r.total)), [rows]);
  // A 140px name column inside a quarter-width card leaves no chart behind it.
  const narrow = (card?.height ?? 280) < 220;

  return (
    <ChartCard
      {...card}
      title={t('widget.merchants.name')}
      subtitle={t('widget.merchants.desc')}
      loading={loading}
      empty={!rows.length}
      table={{
        rows,
        // `merchant`/`total`, not `name`/`value`: this spec once named the keys
        // of a different chart's rows, so the accessible fallback rendered a
        // column of blanks — the exact failure the table is here to prevent.
        columns: [
          { key: 'merchant', label: t('dashboard.merchant') },
          { key: 'total', label: t('common.amount'), align: 'right', format: eur },
          { key: 'share', label: t('widget.merchants.share'), align: 'right', format: percent },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 56, left: 0, bottom: 0 }}>
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
        <Tooltip
          content={<ChartTooltip formatValue={eur} />}
          cursor={{ fill: 'rgba(139,148,158,0.08)' }}
        />
        <Bar dataKey="total" name={t('dashboard.spent')} fill={SERIES[0]} radius={[0, 4, 4, 0]}>
          {!narrow && (
            <LabelList dataKey="share" position="right" formatter={percent} fill={INK.secondary} fontSize={11} />
          )}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
