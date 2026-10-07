import { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { SERIES, INK, axisMoney, axisMonth, dashOf, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { formatDate } from '../../lib/format.js';
import { usePersistentState } from '../../lib/usePersistentState.js';
import { useT } from '../../i18n/index.js';

/**
 * Where the accounts are heading.
 *
 * The last thirty days as they were, solid, and the weeks ahead as they are
 * likely to go, dashed: today's balance, the bills and salary the recurring
 * engine expects on their own days, and everyday spending spread evenly at the
 * rate it has recently run at (see server/engines/forecast.js). The point of the
 * card is the lowest point — "will I be short before payday" — so it is named in
 * words above the chart, not left to be found on it.
 *
 * The horizon is a per-node choice, like a hidden series: thirty days is
 * "before payday", ninety is "this quarter".
 */
const HORIZONS = [30, 60, 90];

export default function Forecast({ card, nodeId }) {
  const { t } = useT();
  const theme = useChartTheme();
  const [days, setDays] = usePersistentState(`dashboard.${nodeId}.horizon`, 60);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getForecast({ days })
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const names = useMemo(
    () => ({ actual: t('widget.forecast.actual'), projected: t('widget.forecast.projected') }),
    [t],
  );
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, [names.actual, names.projected]);

  const rows = useMemo(
    () =>
      (data?.rows || []).map((row) => ({
        ...row,
        // One line for the tooltip and the table: what happens that day.
        note: (row.events || []).map((e) => `${e.name} ${eur(e.amount)}`).join(' · '),
      })),
    [data],
  );

  const yAxis = useMemo(() => {
    const values = [];
    for (const row of rows) {
      if (row.actual != null && !filter.hidden.has(names.actual)) values.push(row.actual);
      if (row.projected != null && !filter.hidden.has(names.projected)) values.push(row.projected);
    }
    values.push(0);
    return fitAxis(values);
  }, [rows, filter.hidden, names]);

  const subtitle = data
    ? [
        t(data.relative ? 'widget.forecast.nowRelative' : 'widget.forecast.now', { amount: eur(data.start) }),
        t('widget.forecast.end', { amount: eur(data.end), days }),
        data.low.date !== data.today
          ? t('widget.forecast.low', { amount: eur(data.low.balance), date: formatDate(data.low.date) })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('widget.forecast.desc');

  const stale = data?.balance && data.balance.oldest && data.balance.oldest < shiftIso(data.today, -21);

  const footnote = data
    ? [
        t('widget.forecast.footnote', {
          everyday: eur(data.everydayPerDay),
          in: eur(data.scheduledIn),
          out: eur(data.scheduledOut),
        }),
        stale ? t('widget.forecast.stale', { date: formatDate(data.balance.oldest) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const horizon = (
    <select
      className="chart-select"
      value={days}
      onChange={(e) => setDays(Number(e.target.value))}
      aria-label={t('widget.forecast.horizon')}
    >
      {HORIZONS.map((d) => (
        <option key={d} value={d}>
          {t('format.days', { count: d })}
        </option>
      ))}
    </select>
  );

  return (
    <ChartCard
      {...card}
      title={t('widget.forecast.name')}
      subtitle={subtitle}
      controls={horizon}
      loading={!data && !failed}
      empty={!rows.length}
      emptyMessage={failed ? t('dashboard.loadFailed') : undefined}
      footnote={footnote}
      table={{
        rows,
        columns: [
          { key: 'date', label: t('common.date'), format: formatDate },
          { key: 'actual', label: names.actual, align: 'right', format: (v) => (v == null ? '—' : eur(v)) },
          { key: 'projected', label: names.projected, align: 'right', format: (v) => (v == null ? '—' : eur(v)) },
          { key: 'note', label: t('widget.forecast.events') },
        ],
      }}
    >
      <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="date" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={24} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={58} />
        <Tooltip
          content={
            <ChartTooltip
              formatLabel={(date, payload) => {
                const note = payload?.[0]?.payload?.note;
                return note ? `${formatDate(date)} · ${note}` : formatDate(date);
              }}
              formatValue={eur}
            />
          }
        />
        <Legend {...filter.legendProps} />
        {/* Zero is the line that matters on a balance. */}
        <ReferenceLine y={0} stroke={INK.axis} />
        {data && <ReferenceLine x={data.today} stroke={INK.axis} strokeDasharray="2 3" />}
        <Area
          type="stepAfter"
          dataKey="actual"
          name={names.actual}
          hide={filter.hidden.has(names.actual)}
          stroke={SERIES[0]}
          strokeOpacity={filter.dimOf(names.actual)}
          strokeWidth={filter.widthOf(names.actual)}
          fill={SERIES[0]}
          fillOpacity={0.12 * filter.dimOf(names.actual)}
          connectNulls={false}
          isAnimationActive={false}
        />
        {/* Stepped, not curved: money moves on a day, it does not glide into it,
            and a smoothed line would draw the rent as a slope across a week. */}
        <Line
          type="stepAfter"
          dataKey="projected"
          name={names.projected}
          hide={filter.hidden.has(names.projected)}
          stroke={theme.textSecondary}
          strokeOpacity={filter.dimOf(names.projected)}
          strokeWidth={filter.widthOf(names.projected)}
          strokeDasharray={dashOf(1)}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartCard>
  );
}

function shiftIso(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
