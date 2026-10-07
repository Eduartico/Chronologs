import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

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
import IconButton from '../components/ui/IconButton.jsx';
import Popover from '../components/ui/Popover.jsx';
import { useSavedViews } from '../state/SettingsProvider.jsx';
import DashboardGrid from '../dashboard/DashboardGrid.jsx';
import { PRESETS, rangeFor, shiftRange, presetOf } from '../lib/dateRanges.js';

/* `labelKey`, not `label`: these are user-visible copy, and `t()` cannot be
   called at module scope — see web/src/lib/i18nScope.test.js.

   `auto` is the default and the one most readers should never change: it picks
   the bucket from the length of the range on the server (`resolveGranularity`),
   so "last month" draws thirty days and "last two years" draws twenty-four
   months without anyone having to know there was a setting. */
const GRANULARITIES = [
  { id: 'auto', labelKey: 'dashboard.granularity.auto' },
  { id: 'day', labelKey: 'dashboard.granularity.day' },
  { id: 'week', labelKey: 'dashboard.granularity.week' },
  { id: 'month', labelKey: 'dashboard.granularity.month' },
  { id: 'quarter', labelKey: 'dashboard.granularity.quarter' },
  { id: 'year', labelKey: 'dashboard.granularity.year' },
];

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
  // A new key rather than the old one: every reader who ever opened the page
  // has 'month' stored under `dashboard.granularity`, and reading that would
  // keep "last month" drawn as a single point for exactly the people who asked
  // for it not to be.
  const [granularity, setGranularity] = usePersistentState('dashboard.granularity.v2', 'auto');
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

  /** One step back or forward: last month to the month before, and so on. The
      control relabels itself when the step lands on a named preset. */
  function step(direction) {
    const next = shiftRange(range, direction);
    if (!next) return;
    const named = presetOf(next);
    if (named !== 'custom') {
      setPreset(named);
      return;
    }
    setCustomRange(next);
    setPreset('custom');
  }
  const canStep = !!(range.from && range.to);

  /* ---- saved views ----
     A view keeps the *preset* when there is one, so "Last month" saved today
     still means last month next spring; only a hand-picked range is stored as
     its dates. */
  const { views, setViews } = useSavedViews();
  const current = useMemo(
    () => ({
      preset,
      ...(preset === 'custom' ? { from: customRange.from, to: customRange.to } : {}),
      granularity,
      categories: selectedCats,
    }),
    [preset, customRange, granularity, selectedCats],
  );
  const sameView = (v) =>
    v.preset === current.preset &&
    (v.preset !== 'custom' || (v.from === current.from && v.to === current.to)) &&
    v.granularity === current.granularity &&
    (v.categories || []).join(',') === (current.categories || []).join(',');
  const activeView = views.find(sameView) || null;
  const saveAnchor = useRef(null);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState('');
  const [armedDelete, setArmedDelete] = useState(false);

  function applyView(id) {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    if (v.preset === 'custom') setCustomRange({ from: v.from || '', to: v.to || '' });
    setPreset(v.preset);
    setGranularity(v.granularity || 'auto');
    setSelectedCats(v.categories || []);
  }

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const id = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
    // A name already in use is replaced rather than duplicated: saving "Food"
    // again means "Food is now this".
    setViews([...views.filter((v) => v.name !== name), { id, name, ...current }]).catch(() => {});
    setNaming(false);
    setViewName('');
  }

  function deleteView() {
    if (!activeView) return;
    if (!armedDelete) {
      setArmedDelete(true);
      setTimeout(() => setArmedDelete(false), 1000);
      return;
    }
    setArmedDelete(false);
    setViews(views.filter((v) => v.id !== activeView.id)).catch(() => {});
  }

  const cashflow = data?.monthlyCashflow || [];

  const totals = useMemo(() => {
    const income = cashflow.reduce((s, m) => s + m.income, 0);
    const expense = cashflow.reduce((s, m) => s + m.expense, 0);
    const invested = cashflow.reduce((s, m) => s + (m.invested || 0), 0);
    // Against the period before, as the server measured it: the same calendar
    // span immediately earlier (last month against the month before it, this
    // month so far against the same days of last month), under the same
    // category filter. It used to be the two halves of the range on screen,
    // which over a month drawn by day compared the half holding the salary
    // with the half that did not, and read "−100%".
    //
    // Measured on the flows, never on the net. The net crosses zero routinely —
    // one month of tuition against one of salary — and a percentage change
    // across zero is arithmetic, not information. Only offered where the
    // earlier figure is not zero: a percentage change from nothing is not a
    // number.
    const previous = data?.previous;
    const shift = (now, before) => (previous && before > 0 ? ((now - before) / before) * 100 : null);
    return {
      income,
      expense,
      invested,
      // What the accounts kept: investing is not spending, but the money did
      // leave them, so the balance is after it.
      net: income - expense - invested,
      savings: income > 0 ? ((income - expense) / income) * 100 : null,
      // Both tiles get the same two figures. Spending had an average per period
      // and a shift against the period before; income had neither, so the one
      // question you could ask of half the pair — "is this a normal month?" —
      // had an answer on one tile and not on the other sitting beside it.
      avgIncome: cashflow.length ? income / cashflow.length : 0,
      avgExpense: cashflow.length ? expense / cashflow.length : 0,
      incomeShift: shift(income, previous?.income),
      spendShift: shift(expense, previous?.expense),
    };
  }, [cashflow, data?.previous]);

  // The bucket actually drawn, which under `auto` is the server's decision.
  const resolvedGranularity = data?.range?.granularity || (granularity === 'auto' ? 'month' : granularity);
  const periodWord = t(`dashboard.periodWord.${resolvedGranularity}`);
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
        {/* Stepping is how "how did last month go" becomes "and the one before":
            one click each way, without reopening the date fields. */}
        <IconButton
          icon="chevronLeft"
          label={t('dashboard.stepBack')}
          disabled={!canStep}
          onClick={() => step(-1)}
        />
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
          ))}
          {/* Named, so a hand-picked range never leaves the control blank. */}
          <option value="custom">{t('dashboard.customRange')}</option>
        </select>
        <IconButton
          icon="chevronRight"
          label={t('dashboard.stepForward')}
          disabled={!canStep}
          onClick={() => step(1)}
        />
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
            <option key={g.id} value={g.id}>
              {/* "Automatic (daily)": the choice, and what it chose. */}
              {g.id === 'auto' && data?.range?.granularity
                ? t('dashboard.granularity.autoResolved', {
                    granularity: t(`dashboard.granularity.${data.range.granularity}`),
                  })
                : t(g.labelKey)}
            </option>
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
        {/* Saved views: pick one to put the whole bar back the way it was saved,
            the bookmark to save what is on screen now. */}
        {views.length > 0 && (
          <select
            value={activeView?.id || ''}
            onChange={(e) => applyView(e.target.value)}
            aria-label={t('dashboard.views.pick')}
          >
            <option value="" disabled>
              {t('dashboard.views.pick')}
            </option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        )}
        <span ref={saveAnchor} style={{ display: 'inline-flex' }}>
          <IconButton
            icon="bookmark"
            label={t('dashboard.views.save')}
            className={activeView ? 'is-on' : undefined}
            onClick={() => {
              setViewName(activeView?.name || '');
              setNaming((v) => !v);
            }}
          />
        </span>
        {activeView && (
          <IconButton
            icon={armedDelete ? 'check' : 'trash'}
            tone={armedDelete ? 'armed' : 'danger'}
            label={armedDelete ? t('dashboard.views.confirmDelete') : t('dashboard.views.delete', { name: activeView.name })}
            onClick={deleteView}
          />
        )}
        <Popover anchorRef={saveAnchor} open={naming} onClose={() => setNaming(false)} width={260} className="widget-picker">
          <div className="bill-detail">
            <label htmlFor="view-name">{t('dashboard.views.name')}</label>
            <input
              id="view-name"
              autoFocus
              value={viewName}
              placeholder={t('dashboard.views.placeholder')}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveView();
                if (e.key === 'Escape') setNaming(false);
              }}
            />
            <button type="button" className="btn-primary btn-sm" disabled={!viewName.trim()} onClick={saveView}>
              {t('common.save')}
            </button>
          </div>
        </Popover>
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
        {/* Its own tile, and no tone: money put into an ETF or a skin is not
            gone, and colouring it as spending would say it was. Signed, because
            a period that sold more than it bought is a real negative here. */}
        <Stat
          label={t('dashboard.invested')}
          value={totals.invested}
          symbol={totals.invested < 0 ? 'sign' : 'none'}
          hint={
            totals.income > 0 && totals.invested > 0
              ? t('dashboard.investedHint', { rate: percent((totals.invested / totals.income) * 100) })
              : t('dashboard.investedHelp')
          }
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

      <DashboardGrid
        data={data}
        loading={loading}
        range={range}
        periodWord={periodWord}
        categories={selectedCats}
      />
    </div>
  );
}
