import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import { eur } from '../../../lib/money.js';
import { useT } from '../../../i18n/index.js';
import ChartCard from '../ChartCard.jsx';
import { useChartTheme } from '../ChartThemeProvider.jsx';
import { seriesFill } from '../ChartPatterns.jsx';
import { colorScale } from '../chartTheme.js';

/**
 * Money moved between the owner's own places.
 *
 * The most doubtful of the experiments, and it is here to be judged rather than
 * because it is expected to win. A chord diagram earns its complexity when the
 * traffic is many-to-many; this ledger's internal movements are current account
 * ↔ named vault, which is one hub and a fan of spokes. Expect it to say less
 * than the vault list on the Accounts page already says, in more ink.
 *
 * What it might show that a list cannot: the relative *weight* of each vault's
 * traffic at a glance, and whether a vault is one-directional — money goes in
 * and never comes out — which is a real thing to notice about a savings pot and
 * is invisible in a column of balances.
 *
 * Ribbons rather than a true circular chord: the two ends are different kinds of
 * thing (one account, several vaults), so a symmetric matrix would be lying
 * about the shape of the data. Deposits leave the account side, withdrawals
 * return to it, and each direction is drawn separately so a vault that only
 * receives reads as a one-way band.
 */
export default function TransferChord() {
  const { t } = useT();
  const theme = useChartTheme();
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getInternalMovements()
      .then((result) => !cancelled && setMovements(Array.isArray(result) ? result : result?.movements || []))
      .catch(() => !cancelled && setMovements([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const vaults = useMemo(() => {
    const totals = new Map();
    for (const movement of movements || []) {
      const name = movement.vault || t('experimental.chord.unnamed');
      const entry = totals.get(name) || { name, deposited: 0, withdrawn: 0, count: 0 };
      const amount = Math.abs(Number(movement.amount) || 0);
      if (movement.direction === 'withdrawal') entry.withdrawn += amount;
      else entry.deposited += amount;
      entry.count += 1;
      totals.set(name, entry);
    }
    return [...totals.values()]
      .map((v) => ({ ...v, total: v.deposited + v.withdrawn, net: v.deposited - v.withdrawn }))
      .sort((a, b) => b.total - a.total);
  }, [movements, t]);

  const colours = useMemo(() => colorScale(vaults.map((v) => v.name), theme), [vaults, theme]);

  return (
    <ChartCard
      title={t('experimental.chord.title')}
      subtitle={t('experimental.chord.subtitle')}
      loading={loading}
      empty={!vaults.length}
      height={360}
      storageKey="x-chord"
      footnote={t('experimental.chord.footnote')}
      table={{
        rows: vaults,
        colorBy: 'name',
        colorOf: (row) => colours(row.name),
        columns: [
          { key: 'name', label: t('experimental.chord.vault') },
          { key: 'deposited', label: t('experimental.chord.deposited'), align: 'right', format: eur },
          { key: 'withdrawn', label: t('experimental.chord.withdrawn'), align: 'right', format: eur },
          { key: 'net', label: t('experimental.chord.net'), align: 'right', format: eur },
          { key: 'count', label: t('common.count'), align: 'right' },
        ],
      }}
    >
      <ChordRibbons vaults={vaults} colours={colours} theme={theme} t={t} />
    </ChartCard>
  );
}

/*
 * A hub on the left, the vaults fanned down the right, one ribbon each.
 *
 * The first attempt arranged the vaults on an arc around a circle's centre and
 * drew from the rim — which put the hub label on top of the first vault's label
 * and left the whole diagram in a corner of the card, because it also sized
 * itself from a fixed 640×340 rather than the space it was given. Both are the
 * same mistake: laying a bipartite thing out as if it were radial.
 *
 * The SVG scales through its viewBox rather than trusting an injected width, so
 * it fills the card whether or not `ResponsiveContainer` measured it.
 */
const W = 900;
const H = 380;
const HUB_X = 150;
const FAN_X = 620;

function ChordRibbons({ vaults, colours, theme, t }) {
  const busiest = Math.max(...vaults.map((v) => v.total), 1);
  const top = 46;
  const step = vaults.length > 1 ? (H - top * 2) / (vaults.length - 1) : 0;
  const hubY = H / 2;

  const positions = vaults.map((vault, i) => ({
    ...vault,
    x: FAN_X,
    y: vaults.length === 1 ? hubY : top + i * step,
  }));

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t('experimental.chord.title')}
    >
      {positions.map((vault, i) => {
        const thickness = 2 + (vault.total / busiest) * 18;
        const oneWay = vault.withdrawn === 0 || vault.deposited === 0;
        const mid = (HUB_X + FAN_X) / 2;
        return (
          <g key={vault.name}>
            <path
              d={`M ${HUB_X} ${hubY} C ${mid} ${hubY}, ${mid} ${vault.y}, ${vault.x} ${vault.y}`}
              fill="none"
              stroke={colours(vault.name)}
              strokeWidth={thickness}
              strokeOpacity={0.55}
              // A band that only ever ran one way is dashed, so "money goes in
              // and never comes out" is visible without reading the table.
              strokeDasharray={oneWay ? '7 5' : undefined}
              strokeLinecap="round"
            >
              <title>
                {t('experimental.chord.band', {
                  vault: vault.name,
                  deposited: eur(vault.deposited),
                  withdrawn: eur(vault.withdrawn),
                })}
              </title>
            </path>
            <circle
              cx={vault.x}
              cy={vault.y}
              r={7}
              fill={seriesFill(theme, i, colours(vault.name))}
              stroke={theme.surface1}
              strokeWidth={2}
            />
            <text x={vault.x + 14} y={vault.y + 4} fill={theme.text} fontSize={12}>
              {vault.name}
            </text>
            <text x={vault.x + 14} y={vault.y + 19} fill={theme.textMuted} fontSize={11}>
              {`${eur(vault.deposited)} ↓ · ${eur(vault.withdrawn)} ↑`}
            </text>
          </g>
        );
      })}

      <circle cx={HUB_X} cy={hubY} r={10} fill={theme.accent} stroke={theme.surface1} strokeWidth={2} />
      {/* The hub's name sits to its left, away from the fan, so it can never
          land on top of a vault's label however many vaults there are. */}
      <text x={HUB_X - 18} y={hubY + 4} textAnchor="end" fill={theme.text} fontSize={12}>
        {t('experimental.chord.currentAccount')}
      </text>
    </svg>
  );
}
