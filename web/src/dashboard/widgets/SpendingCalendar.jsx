import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { formatDate } from '../../lib/format.js';
import { weekdayNames, firstDayOfWeek, df } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';
import ChartCard from '../../components/charts/ChartCard.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';

/**
 * Every day of the range, shaded by what was spent on it.
 *
 * The one shape that shows rhythm: paydays, weekends, the fortnight after a
 * holiday. No aggregate on the dashboard can show that, because they all bucket
 * to a month first and rhythm is exactly what bucketing destroys.
 *
 * **This chart encodes its value in colour, and colour alone.** That is what a
 * heatmap is; there is no honest way around it. So the compliance is elsewhere
 * and is not optional: every cell carries a `<title>` naming the date, the
 * amount and the largest line of that day, the grid is reachable as a real table
 * through the card's own toggle, and the ramp is a *sequential* one derived from
 * `--accent` — six steps of one hue, each a fixed step lighter than the last, so
 * it survives greyscale as a lightness ramp even where hue is lost entirely. It
 * descends from a theme anchor rather than from the finance pair, so switching
 * to the colourblind-safe money colours correctly leaves it alone: a week's
 * groceries is not a loss.
 *
 * Hand-drawn SVG rather than Recharts, which has no heatmap and whose axis
 * machinery would be doing nothing useful for a grid of rectangles.
 */
export default function SpendingCalendar({ card, range }) {
  const from = range?.from;
  const to = range?.to;
  const { t } = useT();
  const theme = useChartTheme();
  const [days, setDays] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDailySpend({ from, to })
      .then((result) => !cancelled && setDays(result.days))
      .catch(() => !cancelled && setDays([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const rows = days || [];

  // Thresholds from the distribution rather than from the maximum: one 3000-euro
  // rent day would otherwise flatten a whole year into the palest step. Quintiles
  // of the days that had any spending at all.
  const steps = useMemo(() => {
    const sorted = rows.map((d) => d.total).sort((a, b) => a - b);
    if (!sorted.length) return [];
    return [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
  }, [rows]);

  const grid = useMemo(() => buildGrid(rows, from, to), [rows, from, to]);
  const byDate = useMemo(() => new Map(rows.map((d) => [d.date, d])), [rows]);

  const CELL = 12;
  const GAP = 3;
  const TOP = 18;
  const LEFT = 26;
  const width = LEFT + grid.weeks.length * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const weekdays = weekdayNames('narrow');

  return (
    <ChartCard
      {...card}
      title={t('widget.calendar.name')}
      subtitle={t('widget.calendar.desc')}
      loading={loading}
      empty={!rows.length}
      /* The grid decides this, not the card's size. A day is a fixed 12px
         square and seven rows of them are however tall they are; handing this
         card the size-2 height instead left a hundred and sixty pixels of empty
         ground under the squares. Extra room is not something a calendar can
         spend — a long range scrolls sideways rather than growing. */
      height={height + 34}
      footnote={t('widget.calendar.footnote')}
      table={{
        rows,
        columns: [
          { key: 'date', label: t('common.date'), format: formatDate },
          { key: 'total', label: t('common.amount'), align: 'right', format: eur },
          { key: 'count', label: t('common.count'), align: 'right' },
          { key: 'top', label: t('widget.calendar.biggest') },
        ],
      }}
    >
      <CalendarGrid
        grid={grid}
        byDate={byDate}
        steps={steps}
        theme={theme}
        t={t}
        weekdays={weekdays}
        cell={CELL}
        gap={GAP}
        top={TOP}
        left={LEFT}
        gridWidth={width}
        gridHeight={height}
      />
    </ChartCard>
  );
}

/**
 * Recharts' ResponsiveContainer clones its child with measured width and height,
 * so this takes them and ignores them: a calendar's cell is a fixed size and the
 * card scrolls sideways for a long range rather than shrinking a day to two
 * pixels. That is what `.chart-scroll` is for.
 */
function CalendarGrid({ grid, byDate, steps, theme, t, weekdays, cell, gap, top, left, gridWidth, gridHeight }) {
  // `width`/`height` are injected by ResponsiveContainer and deliberately not
  // destructured: a day is a fixed 12px square, and a two-year range scrolls
  // sideways rather than shrinking a day to two pixels nobody can hover.
  const width = gridWidth;
  const height = gridHeight;

  const colourFor = (total) => {
    if (!total) return theme.sequential[0];
    const step = steps.findIndex((threshold) => total <= threshold);
    return theme.sequential[step === -1 ? 5 : step + 1];
  };

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label={t('widget.calendar.name')}>
        {weekdays.map((name, row) =>
          row % 2 === 0 ? (
            <text
              key={name + row}
              x={0}
              y={top + row * (cell + gap) + cell - 2}
              fill={theme.textMuted}
              fontSize={9}
            >
              {name}
            </text>
          ) : null,
        )}
        {grid.months.map((month) => (
          <text key={month.label + month.week} x={left + month.week * (cell + gap)} y={10} fill={theme.textMuted} fontSize={10}>
            {month.label}
          </text>
        ))}
        {grid.weeks.map((week, w) =>
          week.map((iso, row) => {
            if (!iso) return null;
            const day = byDate.get(iso);
            const total = day?.total || 0;
            return (
              <rect
                key={iso}
                x={left + w * (cell + gap)}
                y={top + row * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                fill={colourFor(total)}
                stroke={theme.surface1}
                strokeWidth={1}
              >
                <title>
                  {day
                    ? t('widget.calendar.cell', {
                        date: formatDate(iso),
                        amount: eur(total),
                        count: day.count,
                        top: day.top || '—',
                      })
                    : t('widget.calendar.cellEmpty', { date: formatDate(iso) })}
                </title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/**
 * Columns of seven, from the first day of the locale's week.
 *
 * The range comes from the data when the caller has not fixed one, so an empty
 * tail of "days that have not happened yet" is never drawn.
 */
function buildGrid(rows, from, to) {
  if (!rows.length) return { weeks: [], months: [] };
  const start = new Date(`${from || rows[0].date}T00:00:00Z`);
  const end = new Date(`${to || rows[rows.length - 1].date}T00:00:00Z`);
  const first = firstDayOfWeek();
  const monthName = df({ month: 'short', timeZone: 'UTC' });

  // Back up to this locale's start-of-week so every column is a real week.
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() - first + 7) % 7));

  const weeks = [];
  const months = [];
  let seenMonth = null;

  while (cursor <= end) {
    const column = [];
    for (let row = 0; row < 7; row += 1) {
      const inRange = cursor >= start && cursor <= end;
      column.push(inRange ? cursor.toISOString().slice(0, 10) : null);
      if (inRange) {
        const month = cursor.getUTCMonth();
        if (month !== seenMonth) {
          seenMonth = month;
          months.push({ label: monthName.format(cursor).replace('.', ''), week: weeks.length });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(column);
  }

  return { weeks, months };
}
