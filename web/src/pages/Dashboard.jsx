import { useState, useEffect, useMemo, useCallback } from 'react';

import { usePersistentState } from '../lib/usePersistentState.js';
import { formatDate } from '../lib/format.js';
import { useT } from '../i18n/index.js';
/*
 * Amounts here are euro-denominated in the ledger and are rendered in whatever
 * the display currency is, by the one module allowed to decide that.
 *
 * This page used to hold its own `Intl.NumberFormat` pinned to EUR — fine while
 * the euro was the only currency the app could show, and a lie the moment the
 * display currency became a setting: every other number followed it and the
 * dashboard's did not.
 */
import { eur, percent } from '../lib/money.js';
import { api } from '../lib/api.js';
import { INK } from '../components/charts/chartTheme.js';
import Value from '../components/ui/Value.jsx';
import { DateRangeField } from '../components/ui/DateField.jsx';
import DashboardGrid from '../dashboard/DashboardGrid.jsx';

/* `labelKey`, not `label`: these are user-visible copy, and `t()` cannot be
   called at module scope — see web/src/lib/i18nScope.test.js. */
const GRANULARITIES = [
  { id: 'month', labelKey: 'dashboard.granularity.month' },
  { id: 'quarter', labelKey: 'dashboard.granularity.quarter' },
  { id: 'year', labelKey: 'dashboard.granularity.year' },
];

const PRESETS = [
  { id: '12m', labelKey: 'dashboard.preset.12m', months: 12 },
  { id: '24m', labelKey: 'dashboard.preset.24m', months: 24 },
  { id: 'ytd', labelKey: 'dashboard.preset.ytd', ytd: true },
  { id: 'all', labelKey: 'dashboard.preset.all' },
];

function isoMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function rangeFor(preset) {
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'ytd') return { from: `${new Date().getFullYear()}-01-01`, to: '' };
  const p = PRESETS.find((x) => x.id === preset);
  return { from: isoMonthsAgo(p?.months ?? 12), to: '' };
}

/**
 * One headline figure.
 *
 * Colour is never the only channel, and on these three tiles it is never the
 * channel at all: the word under the number says "Income" or "Spending", and the
 * hue only agrees with it. That is the distinction that matters. Colouring a
 * *number inside a chart* green would be a claim about the number; colouring a
 * tile whose own label already names it is redundancy, which is what the
 * accessibility rule asks for rather than what it forbids — the tile is legible
 * with the colour removed, by construction.
 *
 * So `tone` never touches `Value`. The number itself still goes through it and
 * still carries direction three independent ways where direction is real — the
 * net tile, the only one where above and below zero mean different things.
 */
function Stat({ label, value, symbol = 'none', tone, hint }) {
  return (
    <div className="card stat" data-tone={tone || undefined}>
      <div className="stat-value">
        <Value amount={value} symbol={symbol} />
      </div>
      <div className="stat-label">{label}</div>
      {hint && <div style={{ fontSize: 11, color: INK.secondary, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/**
 * The page around the grid: what range everything is drawn over, the three
 * headline figures, and the cards the reader arranged.
 *
 * The filter bar and the tiles are deliberately *not* nodes. They steer every
 * card beneath them, so a dashboard someone had removed the filter bar from
 * would be one they could no longer aim — and the layout would be one gesture
 * away from unusable with no obvious way back.
 *
 * Everything below them is `DashboardGrid`, which owns the node list, the
 * dragging and the editing. This file used to hold ten chart definitions and
 * every piece of state behind them; each chart is now its own file under
 * `web/src/dashboard/widgets/`, which is what makes any one of them small enough
 * to hold in your head while changing it.
 */
export default function Dashboard() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Persist the *choice*, derive the range from it.
  //
  // These used to be the other way round: the range was persisted and the preset
  // was not, so coming back to the tab showed all-time charts under a label that
  // read "Últimos 12 meses" — and re-picking that same label fired no change
  // event, leaving no way to put it right. Whatever the control's active state
  // is read from is what has to survive the trip to another tab.
  const [preset, setPreset] = usePersistentState('dashboard.preset', '12m');
  const [customRange, setCustomRange] = usePersistentState('dashboard.customRange', { from: '', to: '' });
  const range = useMemo(
    () => (preset === 'custom' ? customRange : rangeFor(preset)),
    [preset, customRange],
  );
  const [granularity, setGranularity] = usePersistentState('dashboard.granularity', 'month');
  const [categories, setCategories] = useState([]);
  const [selectedCats, setSelectedCats] = usePersistentState('dashboard.categories', []);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.getAnalytics({
          from: range.from || undefined,
          to: range.to || undefined,
          granularity,
          categories: selectedCats.length ? selectedCats.join(',') : undefined,
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, granularity, selectedCats]);

  useEffect(() => {
    load();
  }, [load]);

  /** Switches to a hand-picked range, seeded from whatever is on screen now. */
  function setCustomBound(bound, value) {
    setCustomRange({ ...range, [bound]: value });
    setPreset('custom');
  }

  const cashflow = data?.monthlyCashflow || [];

  const totals = useMemo(() => {
    const income = cashflow.reduce((s, m) => s + m.income, 0);
    const expense = cashflow.reduce((s, m) => s + m.expense, 0);
    // Halves of the range, so "against the period before" means something even
    // when the range is a hand-picked fortnight.
    //
    // Measured on *spending*, not on the net. The net crosses zero routinely —
    // one month of tuition against one of salary — and a percentage change
    // across zero is arithmetic, not information: the first version of this read
    // "1,839.1% against the period before", which is true and says nothing.
    // Spending is always positive and always comparable.
    const half = Math.floor(cashflow.length / 2);
    const shift = (pick) => {
      const prior = cashflow.slice(0, half).reduce((s, m) => s + pick(m), 0);
      const recent = cashflow.slice(half).reduce((s, m) => s + pick(m), 0);
      // Only offered when there are two halves to compare and the earlier one is
      // not zero — a percentage change from nothing is not a number.
      return half && prior > 0 ? ((recent - prior) / prior) * 100 : null;
    };
    return {
      income,
      expense,
      net: income - expense,
      savings: income > 0 ? ((income - expense) / income) * 100 : null,
      // Both tiles get the same two figures. Spending had an average per period
      // and a shift against the period before; income had neither, so the one
      // question you could ask of half the pair — "is this a normal month?" —
      // had an answer on one tile and not on the other sitting beside it.
      avgIncome: cashflow.length ? income / cashflow.length : 0,
      avgExpense: cashflow.length ? expense / cashflow.length : 0,
      incomeShift: shift((m) => m.income),
      spendShift: shift((m) => m.expense),
    };
  }, [cashflow]);

  const periodWord = t(`dashboard.periodWord.${granularity}`);
  const hintFor = (average, shift) =>
    [
      t('dashboard.perPeriod', { amount: eur(average), period: periodWord }),
      shift != null ? t('dashboard.shiftHint', { change: percent(shift, { signed: true }) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  if (error) {
    return (
      <div className="empty-state">
        <h3>{t('dashboard.loadFailed')}</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{t('nav.dashboard')}</h2>
          {data?.range && (
            <p style={{ color: INK.secondary, fontSize: 13, marginTop: 2 }}>
              {t('transactions.countOf', { shown: data.range.matched, total: data.range.total })}
              {data.range.earliest &&
                ` · ${t('dashboard.historySince', { date: formatDate(data.range.earliest) })}`}
            </p>
          )}
        </div>
        <button className="btn-ghost" onClick={load}>↻ {t('common.refresh')}</button>
      </div>

      {/* One control row above the grid drives every card on the page. It is not
          a node for exactly that reason. */}
      <div className="filter-bar">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
          ))}
          {/* Named, so a hand-picked range never leaves the control blank. */}
          <option value="custom">{t('dashboard.customRange')}</option>
        </select>
        <DateRangeField
          from={range.from}
          to={range.to}
          onChange={({ from, to }) => {
            if (from !== range.from) setCustomBound('from', from);
            else setCustomBound('to', to);
          }}
        />
        <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          {GRANULARITIES.map((g) => (
            <option key={g.id} value={g.id}>{t(g.labelKey)}</option>
          ))}
        </select>
        <select
          value={selectedCats[0] || ''}
          onChange={(e) => setSelectedCats(e.target.value ? [e.target.value] : [])}
        >
          <option value="">{t('transactions.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat
          label={t('dashboard.income')}
          value={totals.income}
          tone="up"
          hint={hintFor(totals.avgIncome, totals.incomeShift)}
        />
        <Stat
          label={t('dashboard.expenses')}
          value={totals.expense}
          tone="down"
          hint={hintFor(totals.avgExpense, totals.spendShift)}
        />
        {/* The one tile where direction is real: a balance above zero is money
            kept and below it is money spent that was not earned, so this is the
            tile that carries a sign and a colour. */}
        <Stat
          label={t('dashboard.balance')}
          value={totals.net}
          symbol="sign"
          hint={totals.savings != null ? t('dashboard.savingsRateHint', { rate: percent(totals.savings) }) : null}
        />
      </div>

      <DashboardGrid data={data} loading={loading} range={range} periodWord={periodWord} />
    </div>
  );
}
