import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import { colorScale, axisMoney, cartesianDefaults, fitAxis, INK } from '../../components/charts/chartTheme.js';
import { componentLabel, readNetWorth } from '../../lib/netWorth.js';
import { api } from '../../lib/api.js';
import { money, baseCurrency } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What there is, rather than what moved.
 *
 * The three headline tiles above this are all *flow* — income, spending and the
 * difference between them over the chosen period. None of them answers "how much
 * do I have", and the app could not answer it anywhere: bank balances lived on
 * the Accounts tab, an ETF total and a CS2 total sat side by side on the
 * Investments page and were never summed, so the honest answer was spread across
 * two screens and one act of mental arithmetic.
 *
 * Excluded components are still drawn, hollow, with their value in the table.
 * A class the reader has decided not to count is a decision they made, and
 * hiding it entirely would make the decision invisible and the total
 * unexplainable.
 */
export default function NetWorth({ card, data, loading }) {
  const { t } = useT();
  const theme = useChartTheme();

  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getNetWorth()
      .then((result) => {
        if (!cancelled) setPayload(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { rows, total } = useMemo(() => {
    const read = readNetWorth(payload);
    return {
      total: read.total,
      rows: read.components
        .map((component) => ({
          id: component.id,
          name: componentLabel(component.id, t),
          value: component.converted,
          native: component.value,
          currency: component.currency,
          count: component.count,
          included: component.included,
        }))
        .sort((a, b) => b.value - a.value),
    };
  }, [payload, t]);

  const colours = useMemo(() => colorScale(rows.map((r) => r.id), theme), [rows, theme]);
  const xAxis = useMemo(() => fitAxis(rows.map((r) => r.value), { pad: 0.12 }), [rows]);
  const narrow = (card?.height ?? 280) < 220;

  return (
    <ChartCard
      {...card}
      title={t('widget.networth.name')}
      subtitle={t('widget.networth.desc')}
      loading={loading || (payload === null && !failed)}
      empty={!rows.length}
      footnote={rows.length ? t('widget.networth.footnote', { amount: money(total, { from: baseCurrency() }) }) : undefined}
      table={{
        rows,
        colorBy: 'id',
        colorOf: (id) => colours(id),
        columns: [
          { key: 'name', label: t('common.category') },
          { key: 'value', label: t('common.amount'), align: 'right', format: (v) => money(v, { from: baseCurrency() }) },
          { key: 'count', label: t('common.count'), align: 'right' },
          {
            key: 'included',
            label: t('networth.counted'),
            format: (v) => (v ? t('common.enabled') : t('common.disabled')),
          },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 64, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
        <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
        <YAxis type="category" dataKey="name" width={narrow ? 90 : 130} interval={0} {...cartesianDefaults.axis} />
        <Tooltip
          content={<ChartTooltip formatValue={(v) => money(v, { from: baseCurrency() })} />}
          cursor={{ fill: theme.cursor }}
        />
        <Bar dataKey="value" name={t('common.amount')} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((row, i) => (
            /* Hollow for a class the reader has chosen not to count: it is still
               money they have, and still on screen, but it is visibly not part
               of the figure underneath. */
            <Cell
              key={row.id}
              fill={row.included ? seriesFill(theme, i, colours(row.id)) : 'transparent'}
              stroke={colours(row.id)}
              strokeWidth={row.included ? 1 : 2}
              strokeDasharray={row.included ? '0' : '4 3'}
            />
          ))}
          {!narrow && (
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v) => money(v, { from: baseCurrency() })}
              fill={INK.secondary}
              fontSize={11}
            />
          )}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
