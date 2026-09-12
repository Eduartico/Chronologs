import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import {
  colorScale,
  capSeries,
  axisMoney,
  cartesianDefaults,
  fitAxis,
} from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * What each trip cost, and what it was spent on.
 *
 * This is the half of the travel refactor the reader actually asked for. The
 * dashboard folds a trip into one `travel` category so a fortnight abroad does
 * not read as a change in eating habits — and the price of that fold, before
 * this card existed, was that the trip itself became a single number. Two
 * thousand euros, and no way to learn that half of it was hotels.
 *
 * So the bars are stacked by *real* category, never by the overlay: it fetches
 * `/travels/spending`, which is the one endpoint that deliberately ignores the
 * setting. One bar per trip, the most expensive first, and the segments are the
 * answer to "on what".
 */
export default function Trips({ card, data, loading, range }) {
  const { t } = useT();
  const theme = useChartTheme();

  const [trips, setTrips] = useState(null);
  const [failed, setFailed] = useState(false);

  // Its own request, like the Money flow and Spending calendar cards: this is
  // not on `/analytics`, and a card nobody has placed makes no call.
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getTripSpending({ from: range?.from || undefined, to: range?.to || undefined })
      .then((result) => {
        if (!cancelled) setTrips(result?.trips || []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range?.from, range?.to]);

  /* One row per trip, one column per category. The categories are capped the way
     every other stack is — past eight the ramp repeats and two segments of the
     same bar share a colour, which on a stack is unreadable rather than merely
     ambiguous. */
  const { rows, categories } = useMemo(() => {
    const list = trips || [];
    const totals = new Map();
    for (const trip of list) {
      for (const entry of trip.categories) {
        totals.set(entry.category, (totals.get(entry.category) || 0) + entry.value);
      }
    }
    const ranked = [...totals.entries()].map(([name, value]) => ({ name, value }));
    const kept = capSeries(ranked, { key: 'name', value: 'value', max: 8, minShare: 2 });
    const keptNames = kept.filter((k) => !k.isOther).map((k) => k.name);
    const otherName = t('chart.other');
    const hasOther = kept.some((k) => k.isOther);

    const built = list.map((trip) => {
      const row = { name: trip.name, total: trip.total, days: trip.days, count: trip.count };
      let other = 0;
      for (const entry of trip.categories) {
        if (keptNames.includes(entry.category)) row[entry.category] = entry.value;
        else other += entry.value;
      }
      if (hasOther) row[otherName] = other;
      // What a trip cost per day is the only figure that compares a long trip
      // with a short one honestly.
      row.perDay = trip.days ? Math.round((trip.total / trip.days) * 100) / 100 : null;
      return row;
    });

    return { rows: built, categories: hasOther ? [...keptNames, otherName] : keptNames };
  }, [trips, t]);

  const colours = useMemo(() => colorScale(categories, theme), [categories, theme]);
  const xAxis = useMemo(() => fitAxis(rows.map((r) => r.total)), [rows]);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const narrow = (card?.height ?? 280) < 220;

  return (
    <ChartCard
      {...card}
      title={t('widget.trips.name')}
      subtitle={t('widget.trips.desc')}
      loading={loading || (trips === null && !failed)}
      empty={!rows.length}
      // A request that failed is not "no trip has claimed anything yet".
      emptyMessage={failed ? t('dashboard.loadFailed') : t('widget.trips.empty')}
      footnote={rows.length ? t('widget.trips.footnote', { count: rows.length, amount: eur(total) }) : undefined}
      table={{
        rows,
        columns: [
          { key: 'name', label: t('widget.trips.name') },
          { key: 'total', label: t('common.total'), align: 'right', format: eur },
          { key: 'days', label: t('widget.trips.days'), align: 'right' },
          // `eur(null)` prints €0.00, which would read as "this trip cost
          // nothing per day" when what it means is that its dates are unusable.
          { key: 'perDay', label: t('widget.trips.perDay'), align: 'right', format: (v) => (v == null ? '—' : eur(v)) },
          { key: 'count', label: t('common.count'), align: 'right' },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
        <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
        <YAxis
          type="category"
          dataKey="name"
          width={narrow ? 90 : 140}
          /* Every trip gets its tick. Recharts thins category labels by
             available height, which on eleven trips silently labelled every
             other bar — a ranked chart whose rows are half anonymous. */
          interval={0}
          {...cartesianDefaults.axis}
          tickFormatter={(v) => {
            const max = narrow ? 12 : 20;
            return v.length > max ? `${v.slice(0, max)}…` : v;
          }}
        />
        <Tooltip content={<ChartTooltip formatValue={eur} />} cursor={{ fill: theme.cursor }} />
        <Legend />
        {categories.map((category, i) => (
          <Bar
            key={category}
            dataKey={category}
            name={category}
            stackId="trip"
            /* The Cells carry the texture fill; this one is what the legend
               swatch reads, and without it the legend draws in black. */
            fill={colours(category)}
            isAnimationActive={false}
          >
            {rows.map((row) => (
              /* A stroke in the card's own surface between segments, so two
                 neighbouring categories read as two bands rather than one. */
              <Cell
                key={`${row.name}-${category}`}
                fill={seriesFill(theme, i, colours(category))}
                stroke={theme.surface1}
                strokeWidth={2}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ChartCard>
  );
}
