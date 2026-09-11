import { useEffect, useMemo, useState } from 'react';
import { Sankey, Tooltip, Layer, Rectangle } from 'recharts';
import { api } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { useT } from '../../i18n/index.js';
import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { seriesFill } from '../../components/charts/ChartPatterns.jsx';
import { colorScale } from '../../components/charts/chartTheme.js';

/**
 * Where the money came from, which account held it, and where it went.
 *
 * The one thing a Sankey can say that a pie and a bar chart together cannot:
 * that this salary paid that rent, through this account. Everything else on the
 * dashboard collapses one of those three dimensions.
 *
 * Two decisions worth stating, because they are what makes it honest rather than
 * decorative:
 *
 *  - **The residual is drawn.** Income and spending never balance over a real
 *    period, and a diagram whose bands do not add up is a claim about money that
 *    is false. What is left over ends in a "saved" node; what was overspent
 *    starts in a "drawn" one. See `computeFlow` in server/engines/analytics.js.
 *  - **Unlabelled accounts are shown, not dropped.** A row with no account is
 *    ordinary in this ledger. Hiding those would make this chart quietly
 *    disagree with every other total on the page.
 */
export default function MoneyFlow({ card, range }) {
  const from = range?.from;
  const to = range?.to;
  const { t } = useT();
  const theme = useChartTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getFlow({ from, to })
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const label = useMemo(
    () => ({
      source: t('widget.flow.kind.source'),
      account: t('widget.flow.kind.account'),
      category: t('widget.flow.kind.category'),
      residual: t('widget.flow.kind.residual'),
    }),
    [t],
  );

  const nodes = data?.nodes ?? [];
  const links = data?.links ?? [];

  // Colour follows the *column*, not the position, so the eye reads left-to-right
  // as three kinds of thing rather than as eight unrelated series.
  const colours = useMemo(() => colorScale(['source', 'account', 'category', 'residual'], theme), [theme]);

  const rows = useMemo(
    () =>
      links.map((link, i) => ({
        id: i,
        from: nodeName(nodes[link.source], t),
        to: nodeName(nodes[link.target], t),
        value: link.value,
      })),
    [links, nodes, t],
  );

  return (
    <ChartCard
      {...card}
      title={t('widget.flow.name')}
      subtitle={t('widget.flow.desc')}
      loading={loading}
      empty={!links.length}
      emptyMessage={t('widget.flow.empty')}
      footnote={
        data
          ? t('widget.flow.footnote', { income: eur(data.totals.income), expense: eur(data.totals.expense) })
          : undefined
      }
      table={{
        rows,
        columns: [
          { key: 'from', label: t('widget.flow.from') },
          { key: 'to', label: t('widget.flow.to') },
          { key: 'value', label: t('common.amount'), align: 'right', format: eur },
        ],
      }}
    >
      <Sankey
        data={{ nodes: nodes.map((n) => ({ ...n, label: nodeName(n, t) })), links }}
        nodePadding={18}
        nodeWidth={12}
        // Wide gutters: an income node is a bank descriptor, not a word.
        margin={{ top: 8, right: 150, bottom: 8, left: 210 }}
        link={{ stroke: theme.border, strokeOpacity: 0.25, fill: theme.textMuted, fillOpacity: 0.18 }}
        node={<FlowNode theme={theme} colours={colours} label={label} />}
      >
        <Tooltip
          content={
            <ChartTooltip
              formatValue={eur}
              formatLabel={(_, payload) =>
                payload?.[0]?.payload?.payload?.label ?? payload?.[0]?.payload?.label ?? ''
              }
            />
          }
        />
      </Sankey>
    </ChartCard>
  );
}

/** The residual and unknown nodes are named by the engine as bare tokens, so the
    words on screen come from the catalogue rather than from the ledger. */
function nodeName(node, t) {
  if (!node) return '';
  if (node.kind === 'residual') return t(`widget.flow.node.${node.name}`);
  if (node.kind === 'account' && node.name === 'unknown') return t('widget.flow.node.unknownAccount');
  // Money that came back rather than money that arrived. The engine decides
  // which credits these are; all this has to do is not call it a category.
  if (node.kind === 'source' && node.name === 'refund') return t('widget.flow.node.refund');
  if (node.name === 'other') return t('chart.other');
  return node.name;
}

/**
 * One node, drawn with its own label.
 *
 * Recharts' default node is an unlabelled rectangle, which for a diagram whose
 * entire content is "which named thing connects to which" is not a chart. The
 * label sits outside the column so it never overlaps the ribbon, and flips side
 * at the right-hand column so it stays inside the card.
 */
function FlowNode({ x, y, width, height, index, payload, theme, colours, label }) {
  const colour = colours(payload.kind);
  const isRight = payload.kind === 'category' || payload.kind === 'residual';
  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={seriesFill(theme, columnIndex(payload.kind), colour)}
        stroke={theme.surface1}
        strokeWidth={2}
      />
      <text
        x={isRight ? x + width + 8 : x - 8}
        y={y + height / 2}
        textAnchor={isRight ? 'start' : 'end'}
        dominantBaseline="middle"
        fill={theme.textSecondary}
        fontSize={11}
      >
        {/* Truncated from the end, never clipped by the viewport: a label cut
            off at the left edge reads as a different merchant. The full text is
            in the title below and in the card's table. */}
        {trim(payload.label)}
      </text>
      <title>{`${label[payload.kind]}: ${payload.label}`}</title>
    </Layer>
  );
}

const columnIndex = (kind) => ({ source: 0, account: 1, category: 2, residual: 3 }[kind] ?? 0);

const MAX_LABEL = 26;
const trim = (text = '') => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);
