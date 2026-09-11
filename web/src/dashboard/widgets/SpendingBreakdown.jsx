import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  LabelList,
  PieChart,
  Pie,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import {
  colorScale,
  capSeries,
  axisMoney,
  cartesianDefaults,
  fitAxis,
  INK,
} from '../../components/charts/chartTheme.js';
import { inkOn } from '../../lib/contrastInk.js';
import { api } from '../../lib/api.js';
import { eur, percent } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';

/**
 * How spending divides up by category — as slices, as ranked bars, as area, or
 * as two rings.
 *
 * This is four cards collapsed into one. "Where the spending goes", "Spending by
 * area" and "Categories and their groups" all answered the same question and sat
 * in three different places on the same page, each one built as an experiment
 * beside the last. They are not three questions; they are three marks for one.
 *
 * What each mark is actually good at, since that is the whole reason to keep all
 * of them:
 *
 *  - **pie** — angle is the easiest channel to compare two shares with, and it
 *    runs out of room at about six slices.
 *  - **bar** — ranked, and the only one that reads honestly past eight
 *    categories. Sorted largest-first, which it previously was not: a ranked
 *    chart drawn in the server's order is a ranking of nothing.
 *  - **treemap** — every category on screen at a comparable size. Area is harder
 *    to compare than angle when two rectangles have different aspect ratios, so
 *    "which of these two is bigger" is a question this answers *less* well.
 *  - **sunburst** — the only one that shows the hierarchy. The others flatten a
 *    category and its subcategory into two unrelated shares of the same total,
 *    so "how much went on transport altogether" becomes a sum done by eye.
 *
 * Every view carries the share of total, not only the amount. A slice whose
 * angle is 8% should say 8%.
 */
export default function SpendingBreakdown({ card, view, data, loading, nodeId }) {
  const { t } = useT();
  const theme = useChartTheme();

  const breakdown = data?.categoryBreakdown || [];

  // Ranked here, once, for every view: sorting inside one branch is how a chart
  // ends up ranked in one shape and unranked in another.
  const ranked = useMemo(
    () =>
      breakdown
        .filter((c) => c.expense > 0)
        .map((c) => ({ name: c.category, value: c.expense, count: c.count }))
        .sort((a, b) => b.value - a.value),
    [breakdown],
  );

  /* Only the pie folds hard.
   *
   * It used to be the pie *and* the bar, both at rank eight, and the result was a
   * grey "Other" wedge holding 22% of a year — a quarter of the spending the card
   * exists to explain, unreachable in the only two views most readers open.
   * Investments at 8% and subscriptions at 3% were in there.
   *
   * A pie genuinely cannot take more than about eight slices, so it keeps a cap —
   * but a share floor now decides what goes in the fold, not rank alone. The bar
   * is ranked and labelled down its own axis, so a repeated hue is not an
   * ambiguity there; it only needs a ceiling loose enough to stop the rows
   * becoming hairlines. The treemap and the sunburst show everything, which is
   * the entire argument for having them.
   */
  const all = useMemo(() => {
    if (view === 'pie') return capSeries(ranked, { max: 8, minShare: 2 });
    if (view === 'bar') return capSeries(ranked, { max: 16, minShare: 1 });
    return ranked;
  }, [ranked, view]);

  const colours = useMemo(() => colorScale(all.map((b) => b.name), theme), [all, theme]);
  // A pie has no per-series `hide` prop — the slice has to be gone from the data
  // itself, so the toggle filters here rather than in the chart markup.
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, all.map((b) => b.name));
  const shown = useMemo(() => all.filter((b) => !filter.hidden.has(b.name)), [all, filter.hidden]);

  const total = shown.reduce((sum, row) => sum + row.value, 0);
  const withShare = useMemo(
    () => shown.map((row) => ({ ...row, share: total ? (row.value / total) * 100 : 0 })),
    [shown, total],
  );

  /* The table is the one view that is never folded. A reader who wants to know
     what is inside "Other" should not have to change the chart type to find out,
     and the accessible fallback has no reason to be a worse answer than the
     picture it stands in for. Hiding the fold hides its members with it —
     the total the shares are taken against has to keep matching the chart. */
  const tableRows = useMemo(() => {
    const folded = new Set(all.flatMap((row) => (filter.hidden.has(row.name) ? row.members || [row.name] : [])));
    return ranked
      .filter((row) => !folded.has(row.name))
      .map((row) => ({ ...row, share: total ? (row.value / total) * 100 : 0 }));
  }, [ranked, all, filter.hidden, total]);


  const xAxis = useMemo(() => fitAxis(withShare.map((row) => row.value)), [withShare]);
  const narrow = (card?.height ?? 280) < 220;

  const parents = useCategoryParents(view === 'sunburst');
  const rings = useMemo(() => buildRings(shown, parents), [shown, parents]);

  const table =
    view === 'sunburst'
      ? {
          rows: rings.outer.map((row) => ({ ...row, share: total ? (row.value / total) * 100 : 0 })),
          // Keyed on the *parent*: the outer ring takes its hue from the group
          // it belongs to, so a swatch keyed on the child name would colour the
          // table differently from the chart it stands in for.
          colorBy: 'parent',
          colorOf: (parent) => colours(parent),
          columns: [
            { key: 'parent', label: t('widget.breakdown.group') },
            { key: 'name', label: t('common.category') },
            { key: 'value', label: t('common.amount'), align: 'right', format: eur },
            { key: 'share', label: t('widget.breakdown.share'), align: 'right', format: percent },
          ],
        }
      : {
          rows: tableRows,
          colorBy: 'name',
          colorOf: (name) => colours(name),
          columns: [
            { key: 'name', label: t('common.category') },
            { key: 'value', label: t('common.amount'), align: 'right', format: eur },
            { key: 'share', label: t('widget.breakdown.share'), align: 'right', format: percent },
            { key: 'count', label: t('common.count'), align: 'right' },
          ],
        };

  return (
    <ChartCard
      {...card}
      title={t('widget.breakdown.name')}
      subtitle={
        filter.hidden.size
          ? t('dashboard.hiddenSeries', { count: filter.hidden.size })
          : view === 'sunburst'
            ? t('widget.breakdown.descRings')
            : t('widget.breakdown.desc')
      }
      loading={loading}
      empty={!shown.length}
      table={table}
    >
      {view === 'bar' ? (
        /* Shares are easier to rank as bars and easier to judge as a circle, so
           the reader picks. Largest at the top, which is what "ranked" means. */
        <BarChart data={withShare} layout="vertical" margin={{ top: 4, right: narrow ? 8 : 64, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
          <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} {...xAxis} />
          <YAxis type="category" dataKey="name" width={narrow ? 80 : 110} {...cartesianDefaults.axis} />
          <Tooltip
            content={<ChartTooltip formatValue={eur} total={total} />}
            cursor={{ fill: 'rgba(139,148,158,0.08)' }}
          />
          <Bar dataKey="value" name={t('dashboard.expenses')} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {withShare.map((b, i) => (
              <Cell key={b.name} fill={seriesFill(theme, i, colours(b.name))} stroke={colours(b.name)} />
            ))}
            {/* The share, printed at the end of the bar. Length already carries
                the amount; the number nobody can read off an axis is the
                percentage. */}
            {!narrow && (
              <LabelList
                dataKey="share"
                position="right"
                formatter={percent}
                fill={INK.secondary}
                fontSize={11}
              />
            )}
          </Bar>
        </BarChart>
      ) : view === 'treemap' ? (
        <Treemap
          data={withShare}
          dataKey="value"
          nameKey="name"
          isAnimationActive={false}
          content={<TreemapCell theme={theme} colours={colours} total={total} />}
        >
          <Tooltip content={<ChartTooltip formatValue={eur} total={total} />} />
        </Treemap>
      ) : view === 'sunburst' ? (
        <PieChart>
          <Pie data={rings.inner} dataKey="value" nameKey="name" outerRadius="55%" isAnimationActive={false}>
            {rings.inner.map((row, i) => (
              <Cell
                key={row.name}
                fill={seriesFill(theme, i, colours(row.name))}
                stroke={theme.surface1}
                strokeWidth={2}
              />
            ))}
          </Pie>
          {/* The child ring is the same hue as its parent, one shade lighter, so
              the grouping reads without a legend and without twelve new colours. */}
          <Pie data={rings.outer} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="80%" isAnimationActive={false}>
            {/* The pattern index has to be the *parent's*, not this slice's:
                `seriesFill` picks a hatch keyed to a series colour, so pairing a
                parent's hue with a child's index paints the two rings in
                different colours and destroys the grouping the chart exists for. */}
            {rings.outer.map((row) => (
              <Cell
                key={`${row.parent}-${row.name}`}
                fill={seriesFill(
                  theme,
                  Math.max(0, colours.indexOf(row.parent || row.name)),
                  colours(row.parent || row.name),
                )}
                fillOpacity={row.parent === row.name ? 1 : 0.62}
                stroke={theme.surface1}
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatValue={eur} total={total} />} />
        </PieChart>
      ) : (
        <PieChart>
          <Pie
            data={withShare}
            cx="50%"
            cy="50%"
            innerRadius={narrow ? '34%' : '42%'}
            outerRadius={narrow ? '58%' : '72%'}
            dataKey="value"
            paddingAngle={2}
            stroke={INK.surface}
            strokeWidth={2}
            isAnimationActive={false}
            /* The slice says its own share. An angle is comparable but not
               readable, and the reader wanting "8%" should not have to open a
               tooltip or switch to the table for it.
               A narrow card has nowhere to put the name — the label runs off the
               top of the chart area and gets clipped — so there it is the share
               alone and the legend carries the names. */
            label={({ share, name }) =>
              share >= (narrow ? 8 : 4) ? (narrow ? percent(share) : `${name} ${percent(share)}`) : null
            }
            labelLine={false}
          >
            {withShare.map((b, i) => (
              <Cell key={b.name} fill={seriesFill(theme, i, colours(b.name))} stroke={INK.surface} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatValue={eur} total={total} />} />
          {/* The legend lists everything, including what is currently hidden —
              it is the way back. */}
          <Legend
            payload={all.map((b) => ({ value: b.name, type: 'circle', color: colours(b.name) }))}
            {...filter.legendProps}
          />
        </PieChart>
      )}
    </ChartCard>
  );
}

/**
 * The parent of each category, fetched only when a view needs it.
 *
 * The relationship lives on the category registry rather than on a transaction
 * (`parent` in server/engines/categorization.js), so the sunburst is the one
 * view here that needs a second request. A card not showing it makes none.
 */
function useCategoryParents(enabled) {
  const [parents, setParents] = useState({});
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api
      .getCategories()
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result) ? result : result?.categories || [];
        setParents(Object.fromEntries(list.filter((c) => c.parent).map((c) => [c.name || c.id, c.parent])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return parents;
}

/** Two rings' worth of rows. A category with no parent is its own parent, which
    is what makes a flat registry render as a plain doughnut rather than as an
    error. */
function buildRings(rows, parents) {
  const leaves = rows.map((row) => ({ ...row, parent: parents[row.name] || row.name }));
  const grouped = new Map();
  for (const leaf of leaves) grouped.set(leaf.parent, (grouped.get(leaf.parent) || 0) + leaf.value);
  return {
    // Children sorted under their parent, so the two rings line up instead of an
    // outer slice sitting opposite the inner one it belongs to.
    outer: [...grouped.keys()].flatMap((parent) => leaves.filter((l) => l.parent === parent)),
    inner: [...grouped.entries()].map(([name, value]) => ({ name, value })),
  };
}

/**
 * One treemap rectangle.
 *
 * Recharts' default cell has no separator and no label, so adjacent categories
 * of similar colour read as one shape. The surface-coloured stroke is the same
 * rule the pie slices follow, and the label is dropped rather than clipped when
 * the box is too small to hold it — a truncated word is worse than none, because
 * "Trans…" and "Transp…" are two different categories.
 */
function TreemapCell({ x, y, width, height, name, value, theme, colours, total }) {
  if (!(width > 0 && height > 0)) return null;
  // `colorScale` is a function with an `.indexOf`, not an object: subscripting
  // it gave undefined for every cell, and the whole treemap came out one blue.
  const colour = colours(name);
  const index = Math.max(0, colours.indexOf(name));
  const roomy = width > 74 && height > 34;
  const ink = inkOn(colour);
  const share = total ? Math.round((value / total) * 100) : 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={seriesFill(theme, index, colour)}
        stroke={theme.surface1}
        strokeWidth={2}
      />
      {roomy && (
        <>
          {/* Ink computed against this cell's own fill. Using the surface colour
              was right by luck on a dark theme and unreadable on a light one —
              CSS cannot decide this, which is why contrastInk.js exists. */}
          <text x={x + 8} y={y + 18} fill={ink} fontSize={12} fontWeight={600}>
            {name}
          </text>
          <text x={x + 8} y={y + 33} fill={ink} fontSize={11} opacity={0.85}>
            {share}%
          </text>
        </>
      )}
    </g>
  );
}
