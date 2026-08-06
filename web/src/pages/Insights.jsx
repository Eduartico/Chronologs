import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { formatCurrency, formatDate, formatMonth } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import { useSortableRows } from '../lib/useSortableRows.js';

/**
 * Análises.
 *
 * The previous version had five panels and the user's verdict on all five was
 * that they were useless — with reason. It ranked categories by absolute
 * turnover, so "income" came top of a list headed *where your money went*; it
 * read any run of similar charges as a subscription, so the launderette
 * outranked Spotify; and it wrote its findings in English, in en-GB currency
 * formatting, on an otherwise Portuguese screen. Worst of all it counted
 * transfers between the user's own accounts as spending, which is what made
 * October 2025 read €3.333 heavier than it was.
 *
 * Each panel here answers a question someone would actually ask, and every
 * figure is shown against something: the period before, the usual month, or the
 * pace so far. A panel with nothing to say renders nothing at all.
 */

const RANGES = [
  { id: '3m', label: '3 meses', months: 3 },
  { id: '6m', label: '6 meses', months: 6 },
  { id: '12m', label: '12 meses', months: 12 },
  { id: 'all', label: 'Tudo', months: null },
];

function rangeFor(id) {
  const preset = RANGES.find((r) => r.id === id) || RANGES[2];
  if (!preset.months) return { from: '', to: '' };
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - preset.months);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const SHIFT_COLUMNS = [
  { key: 'category', label: 'Categoria', get: (s) => s.category },
  { key: 'previous', label: 'Antes', align: 'right', get: (s) => s.previous },
  { key: 'current', label: 'Agora', align: 'right', get: (s) => s.current },
  { key: 'delta', label: 'Diferença', align: 'right', get: (s) => s.delta },
  { key: 'driver', label: 'O que pesou', sortable: false },
];

const RECURRING_COLUMNS = [
  { key: 'merchant', label: 'Onde', get: (r) => r.merchant },
  { key: 'cadence', label: 'Ritmo', get: (r) => r.cadence },
  { key: 'avgAmount', label: 'Valor', align: 'right', get: (r) => r.avgAmount },
  { key: 'monthlyCost', label: 'Por mês', align: 'right', get: (r) => r.monthlyCost },
  { key: 'lastDate', label: 'Último', get: (r) => r.lastDate || '' },
];

function Delta({ value }) {
  if (!value) return null;
  return (
    <span className={value > 0 ? 'amount-negative' : 'amount-positive'}>
      {value > 0 ? '+' : '−'}
      {formatCurrency(Math.abs(value))}
    </span>
  );
}

export default function Insights() {
  const [rangeId, setRangeId] = usePersistentState('insights.range', '12m');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = rangeFor(rangeId);
      setData(await api.getAnalytics({ from, to }));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rangeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Destructured before the early returns because the sort hooks below cannot
  // be called conditionally.
  const {
    insights = {},
    monthlyCashflow = [],
    shifts: rawShifts = [],
    projection,
    vaults = [],
    vaultTotal = 0,
  } = data || {};
  const {
    topCategories = [],
    recurring: rawRecurring = [],
    totalSpending = 0,
    averageMonth = 0,
    committedMonthly = 0,
  } = insights;

  const {
    rows: shifts,
    sort: shiftSort,
    toggleSort: toggleShiftSort,
  } = useSortableRows(rawShifts, SHIFT_COLUMNS, 'insights.shiftSort', { key: 'delta', dir: 'desc' });
  const {
    rows: recurring,
    sort: recurringSort,
    toggleSort: toggleRecurringSort,
  } = useSortableRows(rawRecurring, RECURRING_COLUMNS, 'insights.recurringSort', {
    key: 'monthlyCost',
    dir: 'desc',
  });

  if (loading) return <div className="empty-state"><p>A carregar…</p></div>;
  if (error) return <div className="empty-state"><p>Erro: {error}</p></div>;
  if (!data) return null;

  const lastMonth = monthlyCashflow[monthlyCashflow.length - 1];
  const kept = monthlyCashflow.reduce((sum, m) => sum + m.net, 0);

  return (
    <>
      <div className="page-header">
        <h2>
          <Icon name="insights" size={22} /> Análises
        </h2>
        <div className="filter-chips">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`filter-chip${rangeId === r.id ? ' active' : ''}`}
              onClick={() => setRangeId(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* The shape of the period, in three numbers that carry their own context. */}
      <div className="grid-3">
        <div className="card stat">
          <div className="stat-value">{formatCurrency(totalSpending)}</div>
          <div className="stat-label">
            gasto no período · {formatCurrency(averageMonth)}/mês em média
          </div>
        </div>
        <div className="card stat">
          <div className={`stat-value ${kept >= 0 ? 'amount-positive' : 'amount-negative'}`}>
            {formatCurrency(kept, { signed: true })}
          </div>
          <div className="stat-label">
            {kept >= 0 ? 'sobrou' : 'gastaste a mais do que entrou'} · movimentos entre contas tuas
            não contam
          </div>
        </div>
        <div className="card stat">
          <div className="stat-value">{formatCurrency(committedMonthly)}</div>
          <div className="stat-label">
            comprometido por mês em {recurring.length}{' '}
            {recurring.length === 1 ? 'subscrição' : 'subscrições'}
          </div>
        </div>
      </div>

      {/* A month seen on the 8th always looks cheap; projecting it is the only
          honest way to compare it against a finished one. */}
      {projection && (
        <div className="card">
          <div className="section-title">
            <Icon name="calendar" size={17} /> Este mês, ao ritmo actual
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Vais em <strong>{formatCurrency(projection.expenseSoFar)}</strong> ao dia{' '}
            {projection.dayOfMonth} de {projection.daysInMonth}. A este ritmo o mês fecha em{' '}
            <strong>{formatCurrency(projection.projectedExpense)}</strong>
            {averageMonth > 0 && (
              <>
                {' '}
                — {projection.projectedExpense > averageMonth ? 'acima' : 'abaixo'} da tua média de{' '}
                {formatCurrency(averageMonth)}
              </>
            )}
            .
          </p>
        </div>
      )}

      {topCategories.length > 0 && (
        <div className="card">
          <div className="section-title">
            <Icon name="categories" size={17} /> Para onde foi o dinheiro
          </div>
          <table>
            <tbody>
              {topCategories.map((c) => (
                <tr key={c.category}>
                  <td style={{ width: 170 }}>{c.category}</td>
                  <td>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(2, (c.expense / totalSpending) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="num muted" style={{ width: 56 }}>
                    {((c.expense / totalSpending) * 100).toFixed(0)}%
                  </td>
                  <td className="num" style={{ width: 110 }}>
                    <strong>{formatCurrency(c.expense)}</strong>
                  </td>
                  <td className="num muted" style={{ width: 80 }}>
                    {c.count} mov.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reported in euros, never percentages: a category that went from €2 to
          €6 is up 200% and means nothing. */}
      {shifts.length > 0 && (
        <div className="card">
          <div className="section-title">
            <Icon name="transactions" size={17} /> O que mudou
            <span className="section-title-aside">face ao período anterior de igual duração</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {SHIFT_COLUMNS.map((col) => (
                    <SortHeader key={col.key} column={col} sort={shiftSort} onToggle={toggleShiftSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.category}>
                    <td>{s.category}</td>
                    <td className="num muted">{formatCurrency(s.previous)}</td>
                    <td className="num">{formatCurrency(s.current)}</td>
                    <td className="num">
                      <Delta value={s.delta} />
                    </td>
                    <td className="muted">
                      {s.driver
                        ? `${s.driver.description.slice(0, 38)} · ${formatDate(s.driver.date)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recurring.length > 0 && (
        <div className="card">
          <div className="section-title">
            <Icon name="subscriptions" size={17} /> Compromissos recorrentes
            <span className="section-title-aside">{formatCurrency(committedMonthly)}/mês</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {RECURRING_COLUMNS.map((col) => (
                    <SortHeader
                      key={col.key}
                      column={col}
                      sort={recurringSort}
                      onToggle={toggleRecurringSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.merchant}>
                    <td>{r.merchant}</td>
                    <td className="muted">
                      {r.cadence} · {r.count}×
                    </td>
                    <td className="num">{formatCurrency(r.avgAmount)}</td>
                    <td className="num">
                      <strong>{formatCurrency(r.monthlyCost)}</strong>
                    </td>
                    <td className="muted">{formatDate(r.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* This panel can only exist because internal movements are now understood
          instead of being counted as spending. */}
      {vaults.length > 0 && (
        <div className="card">
          <div className="section-title">
            <Icon name="vault" size={17} /> Poupança
            <span className="section-title-aside">{formatCurrency(vaultTotal)} guardados</span>
          </div>
          <table>
            <tbody>
              {vaults.map((v) => (
                <tr key={v.vault}>
                  <td>{v.vault}</td>
                  <td className="num amount-positive">{formatCurrency(v.deposited)} guardados</td>
                  <td className="num amount-negative">{formatCurrency(v.withdrawn)} tirados</td>
                  <td className="num">
                    <strong>{formatCurrency(v.balance)}</strong>
                  </td>
                  <td className="muted">{formatDate(v.lastMovement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastMonth && (
        <p className="hint">
          Último mês com dados: {formatMonth(lastMonth.month)} · {lastMonth.count} movimentos.
        </p>
      )}
    </>
  );
}
