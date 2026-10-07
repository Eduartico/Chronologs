import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import { SERIES, STATUS, INK, axisMoney, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { formatMonth } from '../../lib/format.js';
import { useT } from '../../i18n/index.js';

/**
 * This month against the goals the reader set per category.
 *
 * One bar per goal, in three parts so the answer reads off the shape before any
 * number: what was spent inside the goal (solid), what is left of it (outlined,
 * dashed), and anything past it (solid, in the status colour, hatched when
 * textures are on). The words at the end of each bar say the same thing —
 * "€320 of €400 · on track", "over by €40" — so the colour is never the only
 * thing carrying it.
 *
 * "On track" is measured against the *pace*, not the total: €300 of €400 on the
 * 10th is at risk, on the 28th it is fine. Goals are set on the Categories page;
 * the month is the one the dashboard's range ends in, like the pace card.
 */
export default function Goals({ card, range }) {
  const { t } = useT();
  const theme = useChartTheme();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const month = useMemo(() => {
    const end = range?.to || '';
    if (/^\d{4}-\d{2}/.test(end)) return end.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [range?.to]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getBudgets({ month })
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const statusWord = useMemo(
    () => ({ ok: t('widget.goals.status.ok'), atRisk: t('widget.goals.status.atRisk'), over: t('widget.goals.status.over') }),
    [t],
  );

  const rows = useMemo(
    () =>
      (data?.rows || []).map((r) => ({
        ...r,
        within: Math.min(r.spent, r.goal),
        left: Math.max(r.goal - r.spent, 0),
        past: Math.max(r.spent - r.goal, 0),
        // Zero-length, last in the stack: it exists to carry the end label.
        end: 0,
        statusName: statusWord[r.status],
        label:
          r.status === 'over'
            ? t('widget.goals.overBy', { amount: eur(r.spent - r.goal) })
            : `${t('widget.goals.of', { spent: eur(r.spent), goal: eur(r.goal) })} · ${statusWord[r.status]}`,
        hitRate: r.history.length ? `${r.hits}/${r.history.length}` : '—',
      })),
    [data, statusWord, t],
  );

  const xAxis = useMemo(() => fitAxis(rows.map((r) => Math.max(r.spent, r.goal))), [rows]);
  const narrow = (card?.height ?? 280) < 220;

  const subtitle = data
    ? data.current
      ? t('widget.goals.descCurrent', { month: formatMonth(data.month), day: data.day, days: data.daysInMonth })
      : t('widget.goals.descPast', { month: formatMonth(data.month) })
    : t('widget.goals.desc');

  const offTrack = rows.filter((r) => r.status !== 'ok').length;
  const footnote = rows.length
    ? [
        t('widget.goals.footnote', { spent: eur(data.totals.spent), goal: eur(data.totals.goal) }),
        offTrack ? t('widget.goals.offTrack', { count: offTrack }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <ChartCard
      {...card}
      title={t('widget.goals.name')}
      subtitle={subtitle}
      loading={!data && !failed}
      empty={!rows.length}
      emptyMessage={failed ? t('dashboard.loadFailed') : t('widget.goals.empty')}
      footnote={footnote}
      table={{
        rows,
        columns: [
          { key: 'category', label: t('common.category') },
          { key: 'spent', label: t('widget.goals.spent'), align: 'right', format: eur },
          { key: 'goal', label: t('widget.goals.goal'), align: 'right', format: eur },
          { key: 'expected', label: t('widget.goals.expected'), align: 'right', format: eur },
          { key: 'projected', label: t('widget.goals.projected'), align: 'right', format: eur },
          { key: 'statusName', label: t('widget.goals.statusLabel') },
          { key: 'hitRate', label: t('widget.goals.hits'), align: 'right' },
        ],
      }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 150, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
        <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
        <YAxis type="category" dataKey="category" width={narrow ? 80 : 110} interval={0} {...cartesianDefaults.axis} />
        <Tooltip
          cursor={{ fill: theme.cursor }}
          content={
            <ChartTooltip
              formatValue={eur}
              formatLabel={(name, payload) => {
                const row = payload?.[0]?.payload;
                return row ? `${name} · ${row.label}` : name;
              }}
            />
          }
        />
        <Bar dataKey="within" name={t('widget.goals.spent')} stackId="g" fill={SERIES[0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={`w-${r.id}`} fill={SERIES[0]} stroke={theme.surface1} strokeWidth={1} />
          ))}
        </Bar>
        <Bar dataKey="left" name={t('widget.goals.left')} stackId="g" fill="transparent" isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={`l-${r.id}`} fill="transparent" stroke={SERIES[0]} strokeWidth={1.5} strokeDasharray="4 3" />
          ))}
        </Bar>
        <Bar dataKey="past" name={t('widget.goals.past')} stackId="g" fill={STATUS.critical} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={`p-${r.id}`} fill={seriesFill(theme, 1, STATUS.critical)} stroke={theme.surface1} strokeWidth={1} />
          ))}
        </Bar>
        <Bar dataKey="end" stackId="g" fill="transparent" isAnimationActive={false} legendType="none">
          {!narrow && <LabelList dataKey="label" position="right" fill={INK.secondary} fontSize={11} />}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
