import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

import ChartCard from '../../components/charts/ChartCard.jsx';
import ChartTooltip from '../../components/charts/ChartTooltip.jsx';
import { useSeriesToggle } from '../../components/charts/useSeriesToggle.jsx';
import { SERIES, INK, axisMoney, dashOf, cartesianDefaults, fitAxis } from '../../components/charts/chartTheme.js';
import { api } from '../../lib/api.js';
import { eur, percent } from '../../lib/money.js';
import { nf } from '../../lib/locale.js';
import { readNetWorth } from '../../lib/netWorth.js';
import { useT } from '../../i18n/index.js';

/**
 * How long the money would last, and when work becomes optional.
 *
 * Two figures, both built from a typical month (the mean of the last twelve
 * complete ones, from /analytics/runway) and from what is held (/networth,
 * converted here, where the rates are):
 *
 *  - **Runway**: months of ordinary spending the cash in the accounts covers.
 *    Cash only, deliberately — an index fund can be sold, but not at a price
 *    anyone can promise on the day it is needed.
 *  - **Financial independence**: the invested pot at which a safe yearly
 *    withdrawal (`planning.withdrawalRate`, 4% by default) pays for a typical
 *    year. The line is that pot growing at `planning.realReturn` with the
 *    investing the ledger shows month to month, against the target, flat.
 *
 * Every assumption is printed under the chart. A projection that hides its
 * inputs gets quoted as a fact; one that names them gets argued with, which is
 * what a forty-year guess deserves.
 */
const MAX_YEARS = 50;

export default function Freedom({ card, nodeId }) {
  const { t } = useT();
  const [runway, setRunway] = useState(null);
  const [holdings, setHoldings] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getRunway(), api.getNetWorth()])
      .then(([r, n]) => {
        if (cancelled) return;
        setRunway(r);
        setHoldings(readNetWorth(n));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    if (!runway || !holdings) return null;
    const counted = holdings.components.filter((c) => c.included && c.convertible);
    const cash = counted.filter((c) => c.id === 'cash').reduce((s, c) => s + c.converted, 0);
    const invested = counted.filter((c) => c.id !== 'cash').reduce((s, c) => s + c.converted, 0);
    const monthly = runway.expense;
    const wr = Number(runway.planning?.withdrawalRate) || 4;
    const r = (Number(runway.planning?.realReturn) || 0) / 100;
    const contribution = Math.max(runway.invested || 0, 0) * 12;
    const target = monthly > 0 ? (monthly * 12) / (wr / 100) : null;

    const startYear = new Date().getFullYear();
    const rows = [];
    let pot = invested;
    let reached = target != null && pot >= target ? 0 : null;
    for (let y = 0; y <= MAX_YEARS; y++) {
      rows.push({ year: startYear + y, pot: Math.round(pot), target: target != null ? Math.round(target) : null });
      if (reached != null && y >= reached + 3) break;
      const next = pot * (1 + r) + contribution;
      // Fractional year of the crossing, so "11.4 years" rather than "12".
      if (reached == null && target != null && next >= target && pot < target) {
        reached = y + (target - pot) / (next - pot);
      }
      pot = next;
      if (reached == null && y >= 40 && contribution === 0) break;
    }

    return {
      cash,
      invested,
      monthly,
      wr,
      r: r * 100,
      contribution: contribution / 12,
      target,
      progress: target ? (invested / target) * 100 : null,
      runwayMonths: monthly > 0 ? cash / monthly : null,
      years: reached,
      rows,
    };
  }, [runway, holdings]);

  const names = useMemo(
    () => ({ pot: t('widget.freedom.pot'), target: t('widget.freedom.target') }),
    [t],
  );
  const filter = useSeriesToggle(`dashboard.${nodeId}.hidden`, [names.pot, names.target]);
  const yAxis = useMemo(
    () => fitAxis((model?.rows || []).flatMap((row) => [row.pot, row.target]).filter((v) => v != null)),
    [model],
  );

  const months = (value) => nf({ maximumFractionDigits: 1 }).format(value);

  const subtitle = model
    ? [
        model.runwayMonths != null ? t('widget.freedom.runway', { months: months(model.runwayMonths) }) : null,
        model.target != null
          ? t('widget.freedom.number', { amount: eur(model.target), progress: percent(model.progress) })
          : null,
        model.years != null
          ? model.years === 0
            ? t('widget.freedom.reached')
            : t('widget.freedom.years', { years: months(model.years) })
          : model.target != null
            ? t('widget.freedom.notOnCourse')
            : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('widget.freedom.desc');

  const footnote = model
    ? t('widget.freedom.assumptions', {
        spend: eur(model.monthly),
        months: runway.months,
        invest: eur(model.contribution),
        wr: percent(model.wr),
        r: percent(model.r),
      })
    : undefined;

  return (
    <ChartCard
      {...card}
      title={t('widget.freedom.name')}
      subtitle={subtitle}
      loading={!model && !failed}
      empty={!model || !runway?.months}
      emptyMessage={failed ? t('dashboard.loadFailed') : t('widget.freedom.empty')}
      footnote={footnote}
      table={{
        rows: model?.rows || [],
        columns: [
          { key: 'year', label: t('widget.freedom.year') },
          { key: 'pot', label: names.pot, align: 'right', format: eur },
          { key: 'target', label: names.target, align: 'right', format: (v) => (v == null ? '—' : eur(v)) },
        ],
      }}
    >
      <LineChart data={model?.rows || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...cartesianDefaults.grid} />
        <XAxis dataKey="year" {...cartesianDefaults.axis} minTickGap={16} />
        <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} {...yAxis} width={58} />
        <Tooltip content={<ChartTooltip formatValue={eur} />} />
        <Legend {...filter.legendProps} />
        {model?.years != null && model.years > 0 && (
          <ReferenceLine
            x={model.rows[Math.min(Math.ceil(model.years), model.rows.length - 1)]?.year}
            stroke={INK.axis}
            strokeDasharray="2 3"
          />
        )}
        <Line
          type="monotone"
          dataKey="pot"
          name={names.pot}
          hide={filter.hidden.has(names.pot)}
          stroke={SERIES[3]}
          strokeOpacity={filter.dimOf(names.pot)}
          strokeWidth={filter.widthOf(names.pot, 2.5)}
          strokeDasharray={dashOf(0)}
          dot={false}
          isAnimationActive={false}
        />
        {/* The target is a level, not a measurement: flat, dashed and quieter. */}
        <Line
          type="linear"
          dataKey="target"
          name={names.target}
          hide={filter.hidden.has(names.target)}
          stroke={INK.secondary}
          strokeOpacity={filter.dimOf(names.target)}
          strokeWidth={filter.widthOf(names.target, 1.5)}
          strokeDasharray={dashOf(1)}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartCard>
  );
}
