import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatDate } from '../lib/format.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { api } from '../lib/api.js';
import SubcategoryPicker from '../components/SubcategoryPicker.jsx';
import Icon from '../components/Icon.jsx';
import CategoryPicker from '../components/CategoryPicker.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import RowActions from '../components/ui/RowActions.jsx';
import DateField, { DateRangeField } from '../components/ui/DateField.jsx';

const PAGE_SIZE = 50;

// Column definitions drive the header row, the comparator and the column
// widths, so adding a sortable column is one entry rather than four edits.
//
// The widths are not decoration. The table is `table-layout: fixed`, which is
// what stops a cell's contents from resizing its column: opening the category
// picker used to make the row three hundred pixels tall and shove the page
// down, and adding a subcategory left the column a different width than before.
const COLUMNS = [
  { key: 'date', label: 'Data', sortable: true, get: (t) => t.date || '', width: 100 },
  { key: 'description', label: 'Descrição', sortable: true, get: (t) => (t.description || '').toLowerCase() },
  { key: 'merchant', label: 'Comerciante', sortable: true, get: (t) => (t.merchant || '').toLowerCase(), width: 200 },
  { key: 'amount', label: 'Montante', sortable: true, get: (t) => Number(t.amount) || 0, align: 'right', width: 110 },
  { key: 'category', label: 'Categoria', sortable: true, get: (t) => t.category || '', width: 170 },
  { key: 'tags', label: 'Subcategorias', sortable: false, width: 200 },
  { key: 'status', label: 'Estado', sortable: true, get: (t) => t.status || '', width: 110 },
  // The actions column has no heading: the icons in it say what they do, and a
  // word above them only widens the column.
  { key: 'actions', label: '', sortable: false, width: 80 },
];

const STATUS_LABELS = {
  all: 'Todos os estados',
  pending: 'Por classificar',
  categorized: 'Categorizadas',
  overridden: 'Corrigidas à mão',
};

// Every filter lives in one object and goes to the server together. Splitting
// them between client and server is what made "All categories" look broken:
// picking a category while the status filter still said "pending" could only
// ever return nothing, since a pending transaction has no category yet.
const EMPTY_FILTERS = {
  status: 'all',
  search: '',
  category: '',
  tag: '',
  startDate: '',
  endDate: '',
  minAmount: '',
  maxAmount: '',
  direction: '',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS = [
  { id: 'all', label: 'Sempre', range: () => ({ startDate: '', endDate: '' }) },
  { id: 'month', label: 'Este mês', range: () => ({ startDate: todayIso().slice(0, 8) + '01', endDate: todayIso() }) },
  { id: '3m', label: '3 meses', range: () => ({ startDate: monthsAgo(3), endDate: todayIso() }) },
  { id: '12m', label: '12 meses', range: () => ({ startDate: monthsAgo(12), endDate: todayIso() }) },
  { id: 'year', label: 'Este ano', range: () => ({ startDate: `${todayIso().slice(0, 4)}-01-01`, endDate: todayIso() }) },
];

function formatAmount(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const cls = num >= 0 ? 'amount-positive' : 'amount-negative';
  const sign = num >= 0 ? '+' : '';
  return <span className={cls}>{sign}€{Math.abs(num).toFixed(2)}</span>;
}


function StatusBadge({ status }) {
  const map = {
    pending: 'badge-pending',
    categorized: 'badge-categorized',
    overridden: 'badge-overridden',
  };
  return <span className={`badge ${map[status] || ''}`}>{status}</span>;
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [totals, setTotals] = useState({ matched: 0, total: 0 });
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [travels, setTravels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState({});
  const [toast, setToast] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showMore, setShowMore] = usePersistentState('transactions.showMore', false);
  const [sort, setSort] = usePersistentState('transactions.sort', { key: 'date', dir: 'desc' });
  const [page, setPage] = usePersistentState('transactions.page', 0);

  const [filters, setFilters] = usePersistentState('transactions.filters', EMPTY_FILTERS);
  // The search box is debounced through its own state so every keystroke does
  // not become a request.
  const [searchInput, setSearchInput] = usePersistentState('transactions.searchInput', '');

  const [manualEntry, setManualEntry] = useState({
    description: '',
    merchant: '',
    amount: '',
    date: todayIso(),
  });

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.searchTransactions(filters);
      setTransactions(data.transactions);
      setTotals({ matched: data.matched, total: data.total });
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.getCategories(true).then(setCategories).catch(() => {});
    api.getTags().then(setTags).catch(() => {});
    api.getTravels().then(setTravels).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setFilter({ search: searchInput }), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any change to what is being shown puts the reader back on the first page —
  // staying on page 12 of a now-shorter list looks like an empty result.
  useEffect(() => {
    setPage(0);
  }, [filters, sort]);

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  const visible = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key);
    if (!column?.get) return transactions;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...transactions].sort((a, b) => {
      const x = column.get(a);
      const y = column.get(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }, [transactions, sort]);

  // Which trip a transaction falls inside, so travel spending is recognisable
  // without opening the travel page.
  const travelFor = useCallback(
    (tx) => {
      const d = String(tx.date).slice(0, 10);
      return travels.find((t) => t.window && d >= t.window.from && d <= t.window.to) || null;
    },
    [travels]
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const categoryByName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.name, c])),
    [categories]
  );

  const activeFilters = useMemo(() => {
    const chips = [];
    if (filters.status !== 'all') chips.push({ key: 'status', label: STATUS_LABELS[filters.status], reset: { status: 'all' } });
    if (filters.search) chips.push({ key: 'search', label: `"${filters.search}"`, reset: { search: '' } });
    if (filters.category) chips.push({ key: 'category', label: filters.category, reset: { category: '' } });
    if (filters.tag) {
      const tag = tags.find((t) => t.id === filters.tag);
      chips.push({ key: 'tag', label: tag?.name || 'tag', reset: { tag: '' } });
    }
    if (filters.startDate || filters.endDate) {
      chips.push({
        key: 'dates',
        label: `${filters.startDate ? formatDate(filters.startDate) : '…'} → ${filters.endDate ? formatDate(filters.endDate) : '…'}`,
        reset: { startDate: '', endDate: '' },
      });
    }
    if (filters.minAmount || filters.maxAmount) {
      chips.push({
        key: 'amount',
        label: `€${filters.minAmount || '0'} – €${filters.maxAmount || '∞'}`,
        reset: { minAmount: '', maxAmount: '' },
      });
    }
    if (filters.direction) {
      chips.push({
        key: 'direction',
        label: filters.direction === 'debit' ? 'Só débitos' : 'Só créditos',
        reset: { direction: '' },
      });
    }
    return chips;
  }, [filters, tags]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function refreshAll() {
    await load();
    api.getCategories(true).then(setCategories).catch(() => {});
  }

  async function handleCategorize(tx, category) {
    try {
      if (tx.status === 'overridden') await api.overrideCategory(tx.id, category);
      else await api.categorize(tx.id, category);
      showToast(`Categorizada como "${category}"`);
      refreshAll();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function loadSuggestions(txId) {
    if (suggestions[txId]) return;
    try {
      const data = await api.getSuggestions(txId);
      setSuggestions((prev) => ({ ...prev, [txId]: data.suggestions }));
    } catch {}
  }

  async function handleAddTag(tx, tagId) {
    try {
      await api.addTransactionTag(tx.id, tagId);
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function handleRemoveTag(tx, tagId) {
    try {
      await api.removeTransactionTag(tx.id, tagId);
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function handleAddManual() {
    if (!manualEntry.description || !manualEntry.amount || !manualEntry.date) {
      showToast('Descrição, montante e data são obrigatórios');
      return;
    }
    try {
      await api.ingestManual({
        description: manualEntry.description,
        merchant: manualEntry.merchant,
        amount: parseFloat(manualEntry.amount),
        date: manualEntry.date,
      });
      showToast('Transacção adicionada');
      setShowAdd(false);
      setManualEntry({ description: '', merchant: '', amount: '', date: todayIso() });
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  const activePreset = DATE_PRESETS.find((p) => {
    const r = p.range();
    return r.startDate === filters.startDate && r.endDate === filters.endDate;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Transacções</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            {loading ? 'A carregar…' : `${totals.matched} de ${totals.total} transacções`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          + Adicionar manual
        </button>
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Descrição"
              value={manualEntry.description}
              onChange={(e) => setManualEntry({ ...manualEntry, description: e.target.value })}
              style={{ flex: 2, minWidth: 180 }}
            />
            <input
              placeholder="Comerciante (opcional)"
              value={manualEntry.merchant}
              onChange={(e) => setManualEntry({ ...manualEntry, merchant: e.target.value })}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              placeholder="Montante (ex.: -12.50)"
              type="number"
              step="0.01"
              value={manualEntry.amount}
              onChange={(e) => setManualEntry({ ...manualEntry, amount: e.target.value })}
              style={{ width: 150 }}
            />
            <DateField
              value={manualEntry.date}
              onChange={(date) => setManualEntry({ ...manualEntry, date })}
              title="Data"
            />
            <RowActions editing onSave={handleAddManual} onCancel={() => setShowAdd(false)} />
          </div>
        </div>
      )}

      <div className="filter-bar">
        <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          placeholder="Pesquisar descrição ou comerciante…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}{c.count ? ` (${c.count})` : ''}
            </option>
          ))}
        </select>
        <select value={filters.tag} onChange={(e) => setFilter({ tag: e.target.value })}>
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button className="btn-ghost" onClick={() => setShowMore((s) => !s)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="filter" size={15} /> {showMore ? 'Menos filtros' : 'Mais filtros'}
          </span>
        </button>
        <button className="btn-ghost" onClick={load} style={{ marginLeft: 'auto' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={15} /> Actualizar
          </span>
        </button>
      </div>

      {showMore && (
        <div className="card" style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 60 }}>Datas</span>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                className={activePreset?.id === p.id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setFilter(p.range())}
              >
                {p.label}
              </button>
            ))}
            <DateRangeField
              from={filters.startDate}
              to={filters.endDate}
              onChange={({ from, to }) => setFilter({ startDate: from, endDate: to })}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 60 }}>Montante</span>
            <input
              type="number"
              step="0.01"
              placeholder="mínimo €"
              value={filters.minAmount}
              onChange={(e) => setFilter({ minAmount: e.target.value })}
              style={{ width: 130, minWidth: 0 }}
            />
            <input
              type="number"
              step="0.01"
              placeholder="máximo €"
              value={filters.maxAmount}
              onChange={(e) => setFilter({ maxAmount: e.target.value })}
              style={{ width: 130, minWidth: 0 }}
            />
            <select value={filters.direction} onChange={(e) => setFilter({ direction: e.target.value })}>
              <option value="">Débitos e créditos</option>
              <option value="debit">Só débitos</option>
              <option value="credit">Só créditos</option>
            </select>
          </div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="filter-chips">
          <span>Filtros:</span>
          {activeFilters.map((chip) => (
            <span key={chip.key} className="filter-chip">
              {chip.label}
              <button onClick={() => setFilter(chip.reset)} title="Remover filtro">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              setSearchInput('');
              setFilters(EMPTY_FILTERS);
            }}
          >
            Limpar tudo
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><p>A carregar…</p></div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3>Nenhuma transacção corresponde</h3>
          {/* The specific dead end that used to read as a broken button. */}
          {filters.status === 'pending' && filters.category && filters.category !== 'uncategorized' ? (
            <p>
              O estado <strong>Por classificar</strong> exclui tudo o que já tem categoria, por isso
              nunca pode devolver transacções em <strong>{filters.category}</strong>.{' '}
              <button className="btn-ghost btn-sm" onClick={() => setFilter({ status: 'all' })}>
                Mostrar todos os estados
              </button>
            </p>
          ) : (
            <p>
              {totals.total} transacções no total — os filtros activos excluem-nas todas.{' '}
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setSearchInput('');
                  setFilters(EMPTY_FILTERS);
                }}
              >
                Limpar filtros
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="table-fixed">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((tx) => {
                const travel = travelFor(tx);
                return (
                  <tr key={tx.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(tx.date)}</td>
                    <td>
                      {tx.description}
                      {tx.links && tx.links.length > 0 && (
                        <span
                          title={tx.links.map((l) => l.note || l.linkId).join('; ')}
                          style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle', color: 'var(--info)' }}
                        >
                          <Icon name="link" size={13} />
                        </span>
                      )}
                      {travel && (
                        <span
                          title={`Durante a viagem "${travel.name}"`}
                          style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle', color: 'var(--info)' }}
                        >
                          <Icon name="travel" size={13} />
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{tx.merchant || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatAmount(tx.amount)}</td>
                    {/*
                      The category cell no longer changes size when it is being
                      used: the picker floats over the table instead of growing
                      inside this cell.
                    */}
                    <td>
                      <CategoryPicker
                        compact
                        categories={categories}
                        selected={tx.category || 'uncategorized'}
                        onPick={(name) => handleCategorize(tx, name)}
                      />
                      {suggestions[tx.id] && suggestions[tx.id].length > 0 && (
                        <div className="suggestions">
                          {suggestions[tx.id]
                            .filter((s) => s.category !== tx.category)
                            .slice(0, 2)
                            .map((s) => (
                              <span
                                key={s.category}
                                className="tag"
                                onClick={() => handleCategorize(tx, s.category)}
                              >
                                {s.category}
                                {s.confidence > 0 && ` (${Math.round(s.confidence * 100)}%)`}
                              </span>
                            ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <SubcategoryPicker
                        subcategories={tags}
                        selected={tx.tags || []}
                        onAdd={(id) => handleAddTag(tx, id)}
                        onRemove={(id) => handleRemoveTag(tx, id)}
                      />
                    </td>
                    <td><StatusBadge status={tx.status} /></td>
                    <td>
                      {/* "Repor" sends the row back to uncategorized — it undoes
                          a decision rather than deleting anything, so it is a
                          refresh, not a bin. */}
                      <div className="row-actions">
                        <IconButton
                          icon="brain"
                          label="Ver o que as regras sugerem para esta"
                          onClick={() => loadSuggestions(tx.id)}
                        />
                        <IconButton
                          icon="refresh"
                          tone="danger"
                          label="Repor: volta a uncategorized"
                          onClick={() => handleCategorize(tx, 'uncategorized')}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderTop: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} de{' '}
              {visible.length}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn-ghost btn-sm" onClick={() => setPage(0)} disabled={page === 0}>
                ««
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ‹ Anterior
              </button>
              <span style={{ minWidth: 90, textAlign: 'center' }}>
                Página {page + 1} de {pageCount}
              </span>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Seguinte ›
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setPage(pageCount - 1)}
                disabled={page >= pageCount - 1}
              >
                »»
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
