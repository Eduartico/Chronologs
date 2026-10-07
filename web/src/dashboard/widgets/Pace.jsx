import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import { SERIES, INK, axisMoney, dashOf, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur, percent } from '../../lib/money.js';
import { formatMonth } from '../../lib/format.js';
import { useT } from '../../i18n/index.js';

/**
 * A month's spending as it built up, day by day, against last month and a
 * typical month.
 *
 * The question this answers is the one people open a finance app with on the
 * 18th: "am I spending more than usual?" A month-to-date total cannot say —
 * €900 by the 18th is a lot or nothing depending on how other months got
 * there — and the projection card says where the month will *end*, not how it
 * is going. Three cumulative lines read at the same day can.
 *
 * Which month: the one the dashboard's range ends in, so "last month" shows
 * September against August, and "this month" the month so far. The category
 * filter applies, which makes this "is my eating out on track" as readily as
 * "is my spending on track".
 */
export default function Pace({ card, view, nodeId, range, categories }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const month = useMemo(() => {
    const end = range?.to || '';
    if (/^\d{4}-\d{2}/.test(end)) return end.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [range?.to]);

  const categoryParam = categories?.length ? categories.join(',') : undefined;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getPace({ month, categories: categoryParam })
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [month, categoryParam]);

  const names = useMemo(
    () => ({
      current: data ? formatMonth(data.month) : t('widget.pace.current'),
      previous: data ? formatMonth(data.previousMonth) : t('widget.pace.previous'),
      typical: t('widget.pace.typical'),
    }),
    [data, t],
  );

  const rows = data?.rows || [];
  const hasTypical = rows.some((r) => r.typical != null);
  const keys = hasTypical ? ['current', 'previous', 'typical'] : ['current', 'previous'];
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, keys.map((k) => names[k]));

  const yAxis = useMemo(() => {
    const visible = [];
    for (const row of rows) {
      for (const key of keys) if (!filter.hidden.has(names[key]) && row[key] != null) visible.push(row[key]);
    }
    return fitAxis(visible);
  }, [rows, keys, filter.hidden, names]);

  const at = data?.atDay;
  // Said in words as well as drawn: "€410 by day 7 — €60 more than September,
  // 12% under a typical month". Ahead or behind is never only a line's height.
  const subtitle = at
    ? [
        t('widget.pace.byDay', { amount: eur(at.current), day: at.day }),
        // Two sentences rather than one with a "more"/"less" slotted in: the
        // word order around a comparative differs in almost every language.
        t(at.current >= at.previous ? 'widget.pace.morePrevious' : 'widget.pace.lessPrevious', {
          change: eur(Math.abs(at.current - at.previous)),
          month: names.previous,
        }),
        at.typical
          ? t('widget.pace.vsTypical', {
              change: percent(((at.current - at.typical) / at.typical) * 100, { signed: true }),
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('widget.pace.desc');

  const series = [
    ['current', SERIES[1], 3],
    ['previous', SERIES[0], 1.5],
    ['typical', INK.secondary, 1.5],
  ].filter(([key]) => keys.includes(key));

  return (
    <ChartCard
      {...card}
      title={t('widget.pace.name')}
      subtitle={subtitle}
      loading={!data && !failed}
      empty={!rows.length}
      emptyMessage={failed ? t('dashboard.loadFailed') : undefined}
      footnote={
        data?.monthsInTypical ? t('widget.pace.footnote', { count: data.monthsInTypical }) : undefined
      }
      table={{
        rows,
        columns: [
          { key: 'day', label: t('widget.pace.day') },
          { key: 'current', label: names.current, align: 'right', format: (v) => (v == null ? '—' : eur(v)) },
          { key: 'previous', label: names.previous, align: 'right', format: eur },
          ...(hasTypical
            ? [{ key: 'typical', label: names.typical, align: 'right', format: (v) => (v == null ? '—' : eur(v)) }]
            : []),
        ],
      }}
    >
      <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="day" {...cartesianDefaults.axis} minTickGap={12} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={54} />
        <Tooltip
          content={
            <ChartTooltip formatLabel={(day) => t('widget.pace.dayLabel', { day })} formatValue={eur} />
          }
        />
        <Legend {...filter.legendProps} />
        {data?.day && <ReferenceLine x={data.day} stroke={INK.axis} strokeDasharray="2 3" />}
        {series.map(([key, colour, width], i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={names[key]}
            hide={filter.hidden.has(names[key])}
            stroke={colour}
            strokeOpacity={filter.dimOf(names[key])}
            /* This month is the heavy line; the two it is measured against are
               thinner and dashed, so they read as the reference and not as
               two more measurements. */
            strokeWidth={filter.widthOf(names[key], width)}
            strokeDasharray={dashOf(i)}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartCard>
  );
}
