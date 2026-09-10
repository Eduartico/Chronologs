import { useMemo } from 'react';
import { AreaChart, Area, Customized, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import { colorScale, capSeries, axisMoney, axisMonth, cartesianDefaults } from '../../components/charts/chartTheme.js';
import { eur } from '../../lib/money.js';
import { nf } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';

/** A band thinner than this has no room for its own name, and a label that
    collides with its neighbour is worse than no label — the same rule the
    treemap already follows about clipped words. */
const LABEL_MIN_SHARE = 0.04;

/** Vertical room one label needs. Two labels closer than this are pushed apart
    rather than allowed to overprint each other. */
const LABEL_PITCH = 14;

/**
 * Where spending shifted, period by period.
 *
 * This card was the one complained about, and it was earning it. Four things
 * were wrong with it and all four are fixed here:
 *
 *  - **It was uncapped.** Every category in the ledger got a band, so twenty
 *    categories meant twenty bands, most of them a pixel thick, and past eight
 *    the colour ramp starts repeating so two of them shared a hue. Capped to the
 *    top eight plus "Other", the same way the breakdown pie already was.
 *  - **The bands were in the server's order.** Whichever category the reader is
 *    actually following should sit on the flat baseline rather than riding on
 *    top of five others that move underneath it, so they are ordered by total
 *    with the biggest at the bottom.
 *  - **There was no way to see proportion.** When the total rises, every band
 *    rises with it, and an absolute stack genuinely cannot answer "is groceries
 *    growing, or is everything growing". The `share` view is the same stack at a
 *    hundred percent.
 *  - **Names lived in a legend.** A band is read where it is drawn, so each one
 *    labels itself at the right edge — where there is room for it.
 *
 * The `stream` view is the third card that used to exist separately. It is the
 * same stack with a centred baseline: the shape of each band becomes far easier
 * to follow and the absolute total becomes unreadable, which is why it has no Y
 * axis at all. Drawing one would invite reading values off it that the offset
 * makes meaningless; the table carries the exact figures.
 */
export default function CategoryTrend({ card, view, data, loading, nodeId }) {
  const { t } = useT();
  const theme = useChartTheme();

  const trend = data?.categoryTrend || { categories: [], rows: [] };

  const { categories, rows, shareRows } = useMemo(() => {
    const all = trend.categories || [];
    const source = trend.rows || [];

    const totals = all.map((name) => ({
      name,
      value: source.reduce((sum, row) => sum + (row[name] || 0), 0),
    }));
    const kept = capSeries(totals, { key: 'name', value: 'value', max: 8 });
    const keptNames = kept.filter((k) => !k.isOther).map((k) => k.name);
    const hasOther = kept.some((k) => k.isOther);
    const otherName = t('chart.other');

    const folded = source.map((row) => {
      const next = { period: row.period };
      let other = 0;
      for (const name of all) {
        if (keptNames.includes(name)) next[name] = row[name] || 0;
        else other += row[name] || 0;
      }
      if (hasOther) next[otherName] = other;
      return next;
    });

    // `capSeries` already returns the kept names largest-first, and recharts
    // stacks in the order the <Area> elements are declared — first one on the
    // baseline. So declaring them in this order is what puts the biggest band on
    // the flat axis. "Other" goes last on purpose: it is the one band nobody is
    // tracking, so it belongs at the top where it can wobble harmlessly.
    const series = hasOther ? [...keptNames, otherName] : keptNames;

    // The hundred-percent variant. Computed once here rather than inside the
    // chart, because the table for the share view needs exactly the same
    // numbers and must not re-derive them slightly differently.
    const shares = folded.map((row) => {
      const total = series.reduce((sum, name) => sum + (row[name] || 0), 0);
      const next = { period: row.period, total };
      for (const name of series) next[name] = total ? ((row[name] || 0) / total) * 100 : 0;
      return next;
    });

    return { categories: series, rows: folded, shareRows: shares };
  }, [trend, t]);

  const colours = useMemo(() => colorScale(categories, theme), [categories, theme]);
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, categories);

  const share = view === 'share';
  const stream = view === 'stream';
  const plotted = share ? shareRows : rows;

  const percent = (v) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`;


  return (
    <ChartCard
      {...card}
      title={t('widget.trend.name')}
      subtitle={
        filter.hidden.size
          ? t('dashboard.hiddenSeries', { count: filter.hidden.size })
          : stream
            ? t('widget.trend.descStream')
            : share
              ? t('widget.trend.descShare')
              : t('widget.trend.desc')
      }
      loading={loading}
      empty={!plotted.length || !categories.length}
      footnote={stream ? t('widget.trend.footnoteStream') : undefined}
      /* One column per band, built from the same list the stack is drawn from —
         so a category added upstream cannot leave the table behind. */
      table={{
        rows: plotted,
        columns: [
          { key: 'period', label: t('common.date'), format: axisMonth },
          ...categories.map((cat) => ({
            key: cat,
            label: cat,
            align: 'right',
            format: share ? percent : eur,
          })),
        ],
      }}
    >
      <AreaChart
        data={plotted}
        stackOffset={stream ? 'silhouette' : 'none'}
        /* Right margin is where the direct labels live. The stream view keeps
           its legend instead — with a floating baseline the bands swap places
           vertically, so a label pinned to the right edge would point at a band
           that is somewhere else for most of the range. */
        margin={{ top: 8, right: stream ? 12 : 96, left: 0, bottom: 0 }}
      >
        {!stream && <CartesianGrid {...cartesianDefaults.grid} />}
        <XAxis dataKey="period" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
        {/* No Y axis on the stream: the silhouette offset makes any value read
            off it meaningless. */}
        {!stream && (
          <YAxis
            tickFormatter={share ? (v) => `${v}%` : axisMoney}
            domain={share ? [0, 100] : undefined}
            {...cartesianDefaults.axis}
            width={54}
          />
        )}
        <Tooltip
          content={<ChartTooltip formatLabel={axisMonth} formatValue={share ? percent : eur} total={!share} />}
          cursor={{ stroke: theme.cursor }}
        />
        {/* The legend is still the filter everywhere — direct labels name the
            bands, they do not hide them. It is only dropped where the labels
            replace it outright, which is nowhere: click still hides, double
            click still isolates. */}
        <Legend {...filter.legendProps} />
        {categories.map((cat, i) => (
          <Area
            key={cat}
            type="monotone"
            dataKey={cat}
            name={cat}
            stackId="spend"
            hide={filter.hidden.has(cat)}
            stroke={colours(cat)}
            /* A surface-coloured seam keeps adjacent bands legible when their
               hues are close — the same rule the pie slices follow. */
            strokeWidth={filter.widthOf(cat, 2)}
            strokeOpacity={filter.dimOf(cat)}
            fill={seriesFill(theme, i, colours(cat))}
            fillOpacity={filter.dimOf(cat) * 0.75}
            isAnimationActive={false}
          >
          </Area>
        ))}
        {/* One layer for every label rather than a LabelList per band. A
            LabelList only knows about its own series, so four thin bands at the
            top of the stack print four names on top of each other — which is
            what happened. This gets the chart's real scales and can therefore
            lay the whole column out at once. */}
        {!stream && (
          <Customized
            component={(chart) => (
              <EndLabels
                {...chart}
                series={categories.filter((cat) => !filter.hidden.has(cat))}
                row={plotted[plotted.length - 1]}
                shareRow={shareRows[shareRows.length - 1]}
                share={share}
                colours={colours}
              />
            )}
          />
        )}
      </AreaChart>
    </ChartCard>
  );
}

/**
 * Every band's name, printed at the end of the band, in the right-hand margin.
 *
 * Rendered through recharts' `Customized`, which hands over the chart's own
 * axis maps — so the stack is re-walked here with the real y scale and each
 * label lands at its band's true midpoint rather than at whatever edge a
 * per-series `LabelList` happened to expose.
 *
 * Knowing every position at once is the point. Bands at the top of a stack are
 * routinely two or three pixels apart, and four names printed at four such
 * midpoints is an unreadable smudge — which is exactly what the first version
 * drew. Labels are laid out bottom-up and each one is pushed above the last
 * until it clears it, so a crowded top spreads into the margin instead of
 * overprinting. A band under `LABEL_MIN_SHARE` is dropped outright: there is no
 * position at which its name is worth the ink.
 */
function EndLabels({ xAxisMap, yAxisMap, offset, series, row, shareRow, share, colours }) {
  const yScale = Object.values(yAxisMap ?? {})[0]?.scale;
  const xScale = Object.values(xAxisMap ?? {})[0]?.scale;
  if (!yScale || !xScale || !row || !shareRow) return null;

  const x = (xScale(row.period) ?? 0) + (xScale.bandwidth?.() ?? 0) + 8;
  const top = offset?.top ?? 0;
  const bottom = top + (offset?.height ?? 0);

  // Walk the stack in draw order, which is the order the <Area>s are declared:
  // first on the baseline, last on top.
  let running = 0;
  const placed = [];
  for (const name of series) {
    const value = row[name] || 0;
    const mid = running + value / 2;
    running += value;
    if ((shareRow[name] || 0) / 100 < LABEL_MIN_SHARE) continue;
    placed.push({ name, y: yScale(share ? (mid / (row.total || 1)) * 100 : mid) });
  }

  // Bottom-up, pushing each label clear of the one below it. Sorting first means
  // the pass works even if the scale is inverted or a band is zero-height.
  placed.sort((a, b) => b.y - a.y);
  let floor = bottom;
  for (const label of placed) {
    label.y = Math.min(label.y, floor - LABEL_PITCH / 2);
    floor = label.y - LABEL_PITCH / 2;
  }

  return (
    <g>
      {placed
        .filter((label) => label.y >= top)
        .map((label) => (
          <text
            key={label.name}
            x={x}
            y={label.y}
            fill={colours(label.name)}
            fontSize={11}
            fontWeight={600}
            dominantBaseline="middle"
          >
            {label.name}
          </text>
        ))}
    </g>
  );
}
