import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, Cell, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import {
  SERIES,
  INK,
  colorScale,
  capSeries,
  axisMoney,
  axisMonth,
  cartesianDefaults,
  fitAxis,
} from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur, percent } from '../../lib/money.js';
import { formatDate, formatRange } from '../../lib/format.js';
import { usePersistentState } from '../../lib/usePersistentState.js';
import { useT } from '../../i18n/index.js';

/**
 * One trip, picked from a list on the card itself.
 *
 * The Trips card compares every trip at once; this one answers "how did *that*
 * trip go" — what each day cost, what the money bought, and how the trip stands
 * against the others per day. It ignores the dashboard's range on purpose: a
 * trip is its own period, and a card about Dublin going blank because the filter
 * bar says "this month" would be a card nobody keeps.
 *
 * Which trip is remembered per node, like a hidden series is, so two of these
 * side by side can hold two trips to compare.
 *
 * Days before and after the trip are drawn too, hollow and in their own colour:
 * the flight booked in June and the hotel bill that posted three days after
 * coming home are part of what the trip cost, and drawing them like a day on
 * the ground would say the reader was somewhere they were not.
 */
const PHASE_SERIES = { before: 4, during: 0, after: 5 };

export default function TripDetail({ card, view, nodeId }) {
  const { t } = useT();
  const theme = useChartTheme();

  const [trips, setTrips] = useState(null);
  const [chosen, setChosen] = usePersistentState(`dashboard.${nodeId}.trip`, '');
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getTravels()
      .then((list) => {
        if (cancelled) return;
        setTrips(
          (list || [])
            .filter((tr) => tr.status !== 'rejected')
            .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))),
        );
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The most recent trip that has claimed anything, unless one was picked.
  const tripId = useMemo(() => {
    if (!trips?.length) return null;
    if (chosen && trips.some((tr) => tr.id === chosen)) return chosen;
    return (trips.find((tr) => tr.transactionCount > 0) || trips[0]).id;
  }, [trips, chosen]);

  useEffect(() => {
    if (!tripId) return undefined;
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    api
      .getTripSummary(tripId)
      .then((result) => !cancelled && setDetail(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const phaseName = useMemo(
    () => ({
      before: t('widget.trip.phase.before'),
      during: t('widget.trip.phase.during'),
      after: t('widget.trip.phase.after'),
    }),
    [t],
  );

  const daily = useMemo(
    () => (detail?.daily || []).map((d) => ({ ...d, phaseName: phaseName[d.phase] })),
    [detail, phaseName],
  );

  const categories = useMemo(() => {
    const list = detail?.categories || [];
    const total = list.reduce((s, c) => s + c.value, 0);
    const kept = capSeries(
      list.map((c) => ({ name: c.category, value: c.value, count: c.count })),
      { key: 'name', value: 'value', max: 8, minShare: 2 },
    );
    return kept.map((c) => ({
      ...c,
      name: c.isOther ? t('chart.other') : c.name,
      share: total ? (c.value / total) * 100 : 0,
    }));
  }, [detail, t]);

  const colours = useMemo(() => colorScale(categories.map((c) => c.name), theme), [categories, theme]);
  const yAxis = useMemo(() => fitAxis(daily.map((d) => d.total)), [daily]);
  const narrow = (card?.height ?? 280) < 220;
  // Phases actually present, so the legend never lists one with no bars.
  const phases = useMemo(() => [...new Set(daily.map((d) => d.phase))], [daily]);

  const picker = trips?.length ? (
    <select
      className="chart-select"
      value={tripId || ''}
      onChange={(e) => setChosen(e.target.value)}
      aria-label={t('widget.trip.pick')}
    >
      {trips.map((tr) => (
        <option key={tr.id} value={tr.id}>
          {tr.name}
        </option>
      ))}
    </select>
  ) : null;

  const subtitle = detail
    ? [
        formatRange(detail.startDate, detail.endDate),
        detail.perDay != null ? t('widget.trip.perDay', { amount: eur(detail.perDay) }) : null,
        detail.perDayOnTrip != null && detail.phases.before + detail.phases.after > 0
          ? t('widget.trip.perDayOnTrip', { amount: eur(detail.perDayOnTrip) })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('widget.trip.desc');

  // Measured against the other trips per day, in words, so the comparison does
  // not depend on reading a colour.
  const footnote = detail
    ? [
        t('widget.trip.footnote', { amount: eur(detail.total), count: detail.count }),
        detail.otherTripsPerDay != null && detail.perDay != null
          ? t('widget.trip.versusOthers', {
              amount: eur(detail.otherTripsPerDay),
              change: percent(((detail.perDay - detail.otherTripsPerDay) / detail.otherTripsPerDay) * 100, {
                signed: true,
              }),
            })
          : null,
        detail.largest?.[0]
          ? t('widget.trip.largest', {
              description: detail.largest[0].description,
              amount: eur(Math.abs(detail.largest[0].amount)),
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const table =
    view === 'bar'
      ? {
          rows: daily,
          columns: [
            { key: 'date', label: t('common.date'), format: formatDate },
            { key: 'phaseName', label: t('widget.trip.phase.name') },
            { key: 'total', label: t('common.amount'), align: 'right', format: eur },
            { key: 'count', label: t('common.count'), align: 'right' },
          ],
        }
      : {
          rows: categories,
          columns: [
            { key: 'name', label: t('common.category') },
            { key: 'value', label: t('common.amount'), align: 'right', format: eur },
            { key: 'share', label: t('common.share'), align: 'right', format: (v) => percent(v) },
            { key: 'count', label: t('common.count'), align: 'right' },
          ],
        };

  return (
    <ChartCard
      {...card}
      title={detail ? t('widget.trip.titled', { name: detail.name }) : t('widget.trip.name')}
      subtitle={subtitle}
      controls={picker}
      loading={trips === null || (tripId && !detail && !failed)}
      empty={!tripId || !detail?.count}
      emptyMessage={failed ? t('dashboard.loadFailed') : trips?.length ? t('widget.trip.empty') : t('widget.trip.none')}
      footnote={footnote}
      table={table}
    >
      {view === 'pie' ? (
        <PieChart>
          <Pie
            data={categories}
            dataKey="value"
            nameKey="name"
            innerRadius={narrow ? '34%' : '42%'}
            outerRadius={narrow ? '58%' : '72%'}
            paddingAngle={2}
            stroke={INK.surface}
            strokeWidth={2}
            isAnimationActive={false}
            label={({ share, name }) =>
              share >= (narrow ? 8 : 4) ? (narrow ? percent(share) : `${name} ${percent(share)}`) : null
            }
            labelLine={false}
          >
            {categories.map((c, i) => (
              <Cell key={c.name} fill={seriesFill(theme, i, colours(c.name))} stroke={INK.surface} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatValue={eur} />} />
          <Legend />
        </PieChart>
      ) : (
        <BarChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="date" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={16} />
          <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
          <Tooltip
            content={
              <ChartTooltip
                formatLabel={(date, payload) =>
                  `${formatDate(date)} · ${payload?.[0]?.payload?.phaseName ?? ''}`
                }
                formatValue={eur}
              />
            }
            cursor={{ fill: theme.cursor }}
          />
          {/* The legend names the phases, since colour and outline are what tell
              them apart on the bars themselves. */}
          <Legend
            payload={phases.map((phase) => ({
              value: phaseName[phase],
              type: 'square',
              color: SERIES[PHASE_SERIES[phase]],
            }))}
          />
          <Bar dataKey="total" name={t('common.amount')} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {daily.map((d) => {
              const colour = SERIES[PHASE_SERIES[d.phase]];
              const onTrip = d.phase === 'during';
              return (
                /* Solid on the trip's own days; hollow and dashed either side of
                   it, so "booked ahead" and "posted after" never read as a day
                   spent there even without the colour. */
                <Cell
                  key={d.date}
                  fill={onTrip ? colour : 'transparent'}
                  stroke={colour}
                  strokeWidth={onTrip ? 0 : 2}
                  strokeDasharray={onTrip ? '0' : '4 3'}
                />
              );
            })}
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}
