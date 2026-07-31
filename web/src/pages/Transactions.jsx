import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api.js';
import TagChips from '../components/TagChips.jsx';

const PAGE_SIZE = 50;

// Column definitions drive both the header row and the comparator, so adding a
// sortable column is one entry rather than three edits.
const COLUMNS = [
  { key: 'date', label: 'Data', sortable: true, get: (t) => t.date || '' },
  { key: 'description', label: 'Descrição', sortable: true, get: (t) => (t.description || '').toLowerCase() },
  { key: 'merchant', label: 'Comerciante', sortable: true, get: (t) => (t.merchant || '').toLowerCase() },
  { key: 'amount', label: 'Montante', sortable: true, get: (t) => Number(t.amount) || 0, align: 'right' },
  { key: 'category', label: 'Categoria', sortable: true, get: (t) => t.category || '' },
  { key: 'tags', label: 'Tags', sortable: false },
  { key: 'status', label: 'Estado', sortable: true, get: (t) => t.status || '' },
  { key: 'actions', label: 'Acções', sortable: false },
];

function formatAmount(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const cls = num >= 0 ? 'amount-positive' : 'amount-negative';
  const sign = num >= 0 ? '+' : '';
  return <span className={cls}>{sign}€{Math.abs(num).toFixed(2)}</span>;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
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
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [suggestions, setSuggestions] = useState({});
  const [toast, setToast] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [manualEntry, setManualEntry] = useState({
    description: '',
    merchant: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
  });

  const [tags, setTags] = useState([]);
  const [tagFilter, setTagFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [addingTagFor, setAddingTagFor] = useState(null);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);

  useEffect(() => {
    loadTransactions();
    loadCategories();
    api.getTags().then(setTags).catch(() => {});
  }, [filter]);

  // Any change to what is being shown puts the reader back on the first page —
  // staying on page 12 of a now-shorter list looks like an empty result.
  useEffect(() => {
    setPage(0);
  }, [filter, tagFilter, categoryFilter, sort]);

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  const visible = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key);
    const list = transactions.filter(
      (tx) =>
        (!tagFilter || (tx.tags || []).includes(tagFilter)) &&
        (!categoryFilter || tx.category === categoryFilter)
    );
    if (!column?.get) return list;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = column.get(a);
      const y = column.get(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }, [transactions, tagFilter, categoryFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadTransactions() {
    setLoading(true);
    try {
      const params = { status: filter === 'all' ? undefined : filter };
      if (search) params.search = search;
      const data = await api.getTransactions(params);
      setTransactions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const data = await api.getCategories();
      setCategories(data);
    } catch {}
  }

  async function handleCategorize(tx, category) {
    try {
      await api.categorize(tx.id, category);
      showToast(`Categorized as "${category}"`);
      loadTransactions();
      setEditing(null);
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function handleOverride(tx, newCategory) {
    try {
      await api.overrideCategory(tx.id, newCategory);
      showToast(`Overridden to "${newCategory}"`);
      loadTransactions();
      setEditing(null);
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function loadSuggestions(txId) {
    if (suggestions[txId]) return;
    try {
      const data = await api.getSuggestions(txId);
      setSuggestions((prev) => ({ ...prev, [txId]: data.suggestions }));
    } catch {}
  }

  function handleSearch() {
    loadTransactions();
  }

  async function handleAddTag(tx, tagId) {
    try {
      await api.addTransactionTag(tx.id, tagId);
      setAddingTagFor(null);
      loadTransactions();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function handleRemoveTag(tx, tagId) {
    try {
      await api.removeTransactionTag(tx.id, tagId);
      loadTransactions();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function handleAddManual() {
    if (!manualEntry.description || !manualEntry.amount || !manualEntry.date) {
      showToast('Description, amount and date are required');
      return;
    }
    try {
      await api.ingestManual({
        description: manualEntry.description,
        merchant: manualEntry.merchant,
        amount: parseFloat(manualEntry.amount),
        date: manualEntry.date,
      });
      showToast('Transaction added');
      setShowAdd(false);
      setManualEntry({
        description: '',
        merchant: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
      });
      loadTransactions();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Transactions</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          + Add manual
        </button>
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Description"
              value={manualEntry.description}
              onChange={(e) => setManualEntry({ ...manualEntry, description: e.target.value })}
              style={{ flex: 2, minWidth: 180 }}
            />
            <input
              placeholder="Merchant (optional)"
              value={manualEntry.merchant}
              onChange={(e) => setManualEntry({ ...manualEntry, merchant: e.target.value })}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              placeholder="Amount (e.g. -12.50)"
              type="number"
              step="0.01"
              value={manualEntry.amount}
              onChange={(e) => setManualEntry({ ...manualEntry, amount: e.target.value })}
              style={{ width: 140 }}
            />
            <input
              type="date"
              value={manualEntry.date}
              onChange={(e) => setManualEntry({ ...manualEntry, date: e.target.value })}
            />
            <button className="btn-green" onClick={handleAddManual}>Save</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="pending">Pending Classification</option>
          <option value="all">All</option>
          <option value="categorized">Categorized</option>
          <option value="overridden">Overridden</option>
        </select>
        <input
          placeholder="Search description or merchant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn-ghost" onClick={handleSearch}>
          Search
        </button>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              🏷 {t.name}
            </option>
          ))}
        </select>
        <button className="btn-ghost" onClick={loadTransactions} style={{ marginLeft: 'auto' }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading...</p></div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3>No transactions found</h3>
          <p>Transactions will appear here after ingestion.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.sortable ? 'sortable' : undefined}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                  >
                    {col.label}
                    {sort.key === col.key && (
                      <span className="sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((tx) => (
                <tr key={tx.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(tx.date)}</td>
                  <td>
                    {tx.description}
                    {tx.links && tx.links.length > 0 && (
                      <span
                        title={`Linked to: ${tx.links
                          .map((l) => l.transactionIds.filter((id) => id !== tx.id).join(', '))
                          .join('; ')}`}
                        style={{ marginLeft: 6, cursor: 'help' }}
                      >
                        🔗
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{tx.merchant || '—'}</td>
                  <td>{formatAmount(tx.amount)}</td>
                  <td>
                    {editing === tx.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          defaultValue={tx.category}
                          onChange={(e) => {
                            if (e.target.value) {
                              if (tx.status === 'overridden') {
                                handleOverride(tx, e.target.value);
                              } else {
                                handleCategorize(tx, e.target.value);
                              }
                            }
                          }}
                          style={{ minWidth: 140 }}
                        >
                          <option value="">Select...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <span
                          style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)' }}
                          onClick={() => {
                            setEditing(tx.id);
                            loadSuggestions(tx.id);
                          }}
                        >
                          {tx.category || 'uncategorized'}
                        </span>
                        {suggestions[tx.id] && suggestions[tx.id].length > 0 && (
                          <div className="suggestions">
                            {suggestions[tx.id]
                              .filter((s) => s.category !== tx.category)
                              .slice(0, 3)
                              .map((s) => (
                                <span
                                  key={s.category}
                                  className="tag"
                                  onClick={() =>
                                    tx.status === 'overridden'
                                      ? handleOverride(tx, s.category)
                                      : handleCategorize(tx, s.category)
                                  }
                                >
                                  {s.category}
                                  {s.confidence > 0 && ` (${Math.round(s.confidence * 100)}%)`}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <TagChips tagIds={tx.tags || []} tags={tags} onRemove={(id) => handleRemoveTag(tx, id)} />
                      {addingTagFor === tx.id ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onChange={(e) => e.target.value && handleAddTag(tx, e.target.value)}
                          onBlur={() => setAddingTagFor(null)}
                          style={{ fontSize: 11, padding: '2px 4px' }}
                        >
                          <option value="">tag…</option>
                          {tags
                            .filter((t) => !(tx.tags || []).includes(t.id))
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span
                          style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}
                          onClick={() => setAddingTagFor(tx.id)}
                          title="Add tag"
                        >
                          +🏷
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={tx.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {editing !== tx.id && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => {
                            setEditing(tx.id);
                            loadSuggestions(tx.id);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        className="btn-red btn-sm"
                        onClick={() => {
                          if (tx.status === 'overridden') {
                            handleOverride(tx, 'uncategorized');
                          } else {
                            handleCategorize(tx, 'uncategorized');
                          }
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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