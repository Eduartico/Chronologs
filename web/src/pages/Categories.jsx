import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const PROTECTED = 'uncategorized';

const PALETTE = [
  'hsl(25, 70%, 55%)', 'hsl(205, 65%, 55%)', 'hsl(30, 45%, 50%)', 'hsl(50, 65%, 50%)',
  'hsl(280, 55%, 60%)', 'hsl(330, 60%, 58%)', 'hsl(0, 60%, 58%)', 'hsl(230, 55%, 60%)',
  'hsl(180, 45%, 45%)', 'hsl(140, 55%, 45%)', 'hsl(160, 50%, 40%)', 'hsl(210, 15%, 55%)',
  'hsl(260, 60%, 62%)', 'hsl(190, 65%, 50%)', 'hsl(80, 50%, 60%)', 'hsl(15, 65%, 55%)',
];

function formatCurrency(val) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(val || 0);
}

function ColorPicker({ value, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 220 }}>
      {PALETTE.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          title={c}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: c,
            padding: 0,
            border: value === c ? '2px solid var(--text)' : '1px solid var(--border)',
          }}
        />
      ))}
    </div>
  );
}

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newName, setNewName] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function loadData() {
    try {
      const [cats, analytics] = await Promise.all([api.getCategories(), api.getAnalytics()]);
      setCategories(cats);
      setBreakdown(analytics.categoryBreakdown || []);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      await api.createCategory(newName.trim());
      showToast(`Categoria "${newName.trim()}" criada`);
      setNewName('');
      loadData();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  function startEdit(cat) {
    setEditing(cat.id);
    setDraftName(cat.name);
  }

  async function saveName(cat) {
    const name = draftName.trim();
    if (!name || name === cat.name) {
      setEditing(null);
      return;
    }
    try {
      const r = await api.updateCategory(cat.id, { name });
      showToast(
        r.moved > 0
          ? `Renomeada para "${name}" — ${r.moved} transacções e ${r.rulesTouched} regras actualizadas`
          : `Renomeada para "${name}"`
      );
      setEditing(null);
      loadData();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function changeColor(cat, color) {
    try {
      await api.updateCategory(cat.id, { color });
      loadData();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function askDelete(cat) {
    try {
      const { count } = await api.getCategoryUsage(cat.name);
      setConfirmDelete({ cat, count });
    } catch {
      setConfirmDelete({ cat, count: null });
    }
  }

  async function doDelete() {
    const { cat } = confirmDelete;
    try {
      const r = await api.deleteCategory(cat.id);
      showToast(`"${cat.name}" apagada — ${r.moved} transacções voltaram a uncategorized`);
      setConfirmDelete(null);
      loadData();
    } catch (err) {
      showToast('Erro: ' + err.message);
      setConfirmDelete(null);
    }
  }

  async function handleMerge() {
    if (!mergeSource || !mergeTarget) return;
    try {
      await api.mergeCategories(mergeTarget, mergeSource);
      showToast(`"${mergeSource}" fundida em "${mergeTarget}"`);
      setMergeSource('');
      setMergeTarget('');
      setShowMerge(false);
      loadData();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  if (loading) return <div className="empty-state"><p>A carregar…</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>Categorias e tags</h2>
        <button className="btn-ghost" onClick={() => setShowMerge(true)}>Fundir categorias</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <strong style={{ fontSize: 13 }}>📂 Categoria</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              Uma por transacção. Responde a <em>em quê gastei</em> — mercado, transportes,
              educação. É o que alimenta os gráficos de despesa.
            </p>
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>🏷 Tag</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              Várias por transacção. Responde a <em>para quê</em> — "Viagem 2026", "Obras em casa".
              Cruza categorias: um jantar e um comboio podem ter a mesma tag.
            </p>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Apagar "{confirmDelete.cat.name}"?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 16px' }}>
              {confirmDelete.count === null
                ? 'As transacções desta categoria voltam a uncategorized.'
                : confirmDelete.count === 0
                  ? 'Não há transacções nesta categoria.'
                  : `${confirmDelete.count} transacções voltam a uncategorized. As regras que apontam para esta categoria passam a apontar para uncategorized.`}
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn-red" onClick={doDelete}>Apagar</button>
            </div>
          </div>
        </div>
      )}

      {showMerge && (
        <div className="modal-overlay" onClick={() => setShowMerge(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Fundir categorias</h3>
            <div className="form-group">
              <label>Origem (desaparece)</label>
              <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
                <option value="">Escolher…</option>
                {categories.filter((c) => c.name !== PROTECTED).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Destino (fica)</label>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">Escolher…</option>
                {categories.filter((c) => c.name !== mergeSource).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowMerge(false)}>Cancelar</button>
              <button className="btn-primary" onClick={handleMerge}>Fundir</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Cor</th>
              <th>Despesa</th>
              <th>Transacções</th>
              <th style={{ width: 150 }}>Acções</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const stats = breakdown.find((b) => b.category === cat.name);
              const isProtected = cat.name === PROTECTED;
              return (
                <tr key={cat.id}>
                  <td style={{ fontWeight: 500 }}>
                    {editing === cat.id ? (
                      <input
                        value={draftName}
                        autoFocus
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveName(cat);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        onBlur={() => saveName(cat)}
                        style={{ maxWidth: 200 }}
                      />
                    ) : (
                      <>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: cat.color,
                            marginRight: 8,
                          }}
                        />
                        {cat.name}
                        {isProtected && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                            (do sistema)
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <ColorPicker value={cat.color} onPick={(c) => changeColor(cat, c)} />
                  </td>
                  <td className="amount-negative">{formatCurrency(stats?.expense)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{stats?.count || 0}</td>
                  <td>
                    {!isProtected && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-ghost btn-sm" onClick={() => startEdit(cat)}>
                          Renomear
                        </button>
                        <button className="btn-red btn-sm" onClick={() => askDelete(cat)}>
                          Apagar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={5} style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    placeholder="Nova categoria…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    style={{ maxWidth: 240 }}
                  />
                  <button className="btn-primary" onClick={handleCreate}>+ Adicionar</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <TagsManager showToast={showToast} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function TagsManager({ showToast }) {
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');

  const load = () => api.getTags().then(setTags).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!newTag.trim()) return;
    try {
      await api.createTag(newTag.trim());
      showToast(`Tag "${newTag.trim()}" criada`);
      setNewTag('');
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  };

  const remove = async (tag) => {
    if (!confirm(`Apagar a tag "${tag.name}"? As transacções mantêm o histórico.`)) return;
    try {
      await api.deleteTag(tag.id);
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>🏷 Tags</h3>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input
          placeholder="Nova tag…"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          style={{ maxWidth: 260 }}
        />
        <button className="btn-primary" onClick={create}>+ Adicionar</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tags.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Ainda não há tags.</span>
        )}
        {tags.map((t) => (
          <span
            key={t.id}
            style={{
              background: t.color,
              color: '#0d1117',
              borderRadius: 12,
              padding: '3px 10px',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t.name}
            <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => remove(t)}>×</span>
          </span>
        ))}
      </div>
    </div>
  );
}
