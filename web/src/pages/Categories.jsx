import { useState, useEffect, useMemo } from 'react';
import { useT } from '../i18n/index.js';
import { nf } from '../lib/locale.js';
import { api, errText } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { CategoryIcon } from '../components/CategoryPicker.jsx';
import RowActions from '../components/ui/RowActions.jsx';
import EditableField from '../components/ui/EditableField.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import StylePicker from '../components/ui/StylePicker.jsx';
import { PALETTE } from '../components/ui/ColorPicker.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import { useSortableRows } from '../lib/useSortableRows.js';
import { useRowEditor } from '../lib/useRowEditor.js';

const PROTECTED = 'uncategorized';

function formatCurrency(val) {
  return nf({ style: 'currency', currency: 'EUR' }).format(val || 0);
}

// One shape for both tables. Categories and subcategories answer different
// questions but they are the same kind of object, and there is no reason for one
// to have icons, colours and sortable columns while the other is a row of pills.
// A label is a *function* of `t`, not a string. These live at module scope, so a
// direct t() call here would run at import time — before any provider exists,
// and before the reader's language is even known.
const COLUMNS = (t) => [
  { key: 'name', label: t('common.category'), get: (r) => r.name },
  { key: 'expense', label: t('categories.expense'), align: 'right', get: (r) => r.expense, width: 140 },
  { key: 'count', label: t('nav.transactions'), align: 'right', get: (r) => r.count, width: 130 },
  { key: 'actions', label: '', sortable: false, width: 110 },
];

const SUB_COLUMNS = (t) => [
  { key: 'name', label: t('categories.subcategory'), get: (r) => r.name },
  { key: 'count', label: t('nav.transactions'), align: 'right', get: (r) => r.count, width: 130 },
  { key: 'actions', label: '', sortable: false, width: 110 },
];

/**
 * The blank row at the foot of a table.
 *
 * Adding used to mean a separate strip below the table with a bordered text box
 * and an "+ Adicionar" button — a small form that looked nothing like the rows
 * it was making. This is a row: same cells, same positions, same pickers, and in
 * the actions column a `+` to keep it and an `×` to clear it. What you fill in
 * is what you get.
 */
function AddRow({ columns, draft, onChange, onAdd, onClear, placeholder, children }) {
  const { t } = useT();
  const ready = Boolean(String(draft.name || '').trim());
  return (
    <tr className="add-row">
      <td>
        <div className="category-edit">
          <StylePicker
            icon={draft.icon}
            color={draft.color}
            onPickIcon={(icon) => onChange({ icon })}
            onPickColor={(color) => onChange({ color })}
            label={t('categories.iconAndColour')}
            bare
          />
          <span className="autosize" data-value={draft.name || placeholder}>
            <input
              value={draft.name}
              placeholder={placeholder}
              onChange={(e) => onChange({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) onAdd();
                if (e.key === 'Escape') onClear();
              }}
            />
          </span>
        </div>
      </td>
      {children}
      <td>
        <div className="row-actions">
          <IconButton icon="plus" tone="good" label={t('common.add')} disabled={!ready} onClick={onAdd} />
          <IconButton icon="close" label={t('common.clear')} onClick={onClear} />
        </div>
      </td>
    </tr>
  );
}

const emptyDraft = () => ({
  name: '',
  icon: 'tag',
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
});

export default function Categories() {
  const { t, tx } = useT();
  const [categories, setCategories] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
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
      showToast(errText(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = draft.name.trim();
    if (!name) return;
    try {
      const created = await api.createCategory(name);
      // The name is what the create endpoint takes; the look follows in a patch,
      // so the row appears exactly as it was drawn in the blank row above.
      if (created?.id) await api.updateCategory(created.id, { icon: draft.icon, color: draft.color });
      showToast(`Categoria "${name}" criada`);
      setDraft(emptyDraft());
      loadData();
    } catch (err) {
      showToast(errText(err));
    }
  }

  async function saveName(id, patch) {
    const cat = categories.find((c) => c.id === id);
    const name = String(patch.name || '').trim();
    if (!cat || !name || name === cat.name) return;
    try {
      const r = await api.updateCategory(id, { name });
      showToast(
        r.moved > 0
          ? t('categories.renamed', { name, moved: r.moved, rules: r.rulesTouched })
          : `Renomeada para "${name}"`
      );
      loadData();
    } catch (err) {
      showToast(errText(err));
    }
  }

  async function restyle(cat, patch) {
    try {
      await api.updateCategory(cat.id, patch);
      loadData();
    } catch (err) {
      showToast(errText(err));
    }
  }

  // A category drags every transaction filed under it, so this one earns a
  // dialog rather than an armed button — and the dialog exists to show the
  // count, not to ask "tem a certeza?".
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
      showToast(t('categories.deleted', { name: cat.name, moved: r.moved }));
      setConfirmDelete(null);
      loadData();
    } catch (err) {
      showToast(errText(err));
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
      showToast(errText(err));
    }
  }

  const editor = useRowEditor({ onSave: saveName });

  // The numbers live in the analytics payload and the names in the category
  // list; sorting needs them on one object.
  const rows = useMemo(
    () =>
      categories.map((cat) => {
        const stats = breakdown.find((b) => b.category === cat.name);
        return { ...cat, expense: stats?.expense || 0, count: stats?.count || 0 };
      }),
    [categories, breakdown]
  );
  // Rebuilt when the language moves; the descriptor is a function of `t` because
  // it lives at module scope and cannot call a hook itself.
  const columns = useMemo(() => COLUMNS(t), [t]);
  const { rows: sorted, sort, toggleSort } = useSortableRows(rows, columns, 'categories.sort', {
    key: 'expense',
    dir: 'desc',
  });

  if (loading) return <div className="empty-state"><p>{t('common.loading')}</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>{t('nav.categories')}</h2>
        <button className="btn-ghost" onClick={() => setShowMerge(true)}>{t('categories.merge')}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <strong style={{ fontSize: 13 }}>{t('common.category')}</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              {tx('categories.categoryHelp', { what: <em>{t('categories.categoryHelpEm')}</em> })}
            </p>
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>{t('categories.subcategory')}</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              {tx('categories.subcategoryHelp', { what: <em>{t('categories.subcategoryHelpEm')}</em> })}
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Apagar "${confirmDelete.cat.name}"?` : ''}
        impact={
          confirmDelete
            ? confirmDelete.count === null
              ? t('categories.deleteImpactUnknown')
              : confirmDelete.count === 0
                ? t('categories.deleteImpactNone')
                : t('categories.deleteImpact', { count: confirmDelete.count })
            : ''
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />

      {showMerge && (
        <div className="modal-overlay" onClick={() => setShowMerge(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('categories.merge')}</h3>
            <div className="form-group">
              <label>{t('categories.mergeSource')}</label>
              <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
                <option value="">{t('categories.choose')}</option>
                {categories.filter((c) => c.name !== PROTECTED).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('categories.mergeTarget')}</label>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">{t('categories.choose')}</option>
                {categories.filter((c) => c.name !== mergeSource).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowMerge(false)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleMerge}>{t('categories.mergeVerb')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table-fixed">
          <thead>
            <tr>
              {columns.map((col) => (
                <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((cat) => {
              // System categories carry meaning the engines depend on, so their
              // names are fixed — but colour and icon stay editable.
              const isProtected = cat.name === PROTECTED || cat.system === true;
              const editing = editor.isEditing(cat.id);
              return (
                <tr key={cat.id} className={editing ? 'is-editing' : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    <div className="category-edit">
                      {/* Icon and colour are always editable, on every row,
                          without entering edit mode: one button, one click,
                          and nothing else on the row depends on them. */}
                      <StylePicker
                        icon={cat.icon}
                        color={cat.color}
                        onPickIcon={(icon) => restyle(cat, { icon })}
                        onPickColor={(color) => restyle(cat, { color })}
                        bare
                      />
                      <EditableField
                        editing={editing && !isProtected}
                        value={editing ? editor.draft?.name : cat.name}
                        autoFocus
                        disabled={isProtected}
                        title={isProtected ? 'Nome mantido pelo sistema' : undefined}
                        onChange={(name) => editor.patch({ name })}
                        onStartEdit={() => editor.start(cat, { name: cat.name })}
                        onCommit={editor.commit}
                        onCancel={editor.cancel}
                      />
                      {!editing && isProtected && (
                        <span className="tag" title={t('categories.systemHeld')}>
                          sistema
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num amount-negative">{formatCurrency(cat.expense)}</td>
                  <td className="num muted">{cat.count}</td>
                  <td>
                    <RowActions
                      editing={editing}
                      busy={editor.busy}
                      canEdit={!isProtected}
                      canDelete={!isProtected}
                      deleteMode="modal"
                      deleteBlockedReason="Categoria do sistema — os motores dependem dela"
                      onEdit={() => editor.start(cat, { name: cat.name })}
                      onSave={editor.commit}
                      onCancel={editor.cancel}
                      onAskDelete={() => askDelete(cat)}
                    />
                  </td>
                </tr>
              );
            })}
            <AddRow
              columns={columns}
              draft={draft}
              placeholder={t('categories.newCategory')}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onAdd={handleCreate}
              onClear={() => setDraft(emptyDraft())}
            >
              <td colSpan={2} />
            </AddRow>
          </tbody>
        </table>
      </div>

      <SubcategoriesManager showToast={showToast} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * Subcategories, managed exactly like categories.
 *
 * They used to be a strip of coloured pills with a text box beside it: no icon,
 * no sortable columns, rename by clicking the pill itself, delete through the
 * browser's `confirm()`. They are half of how spending gets described and they
 * were the least serious thing on the page.
 */
function SubcategoriesManager({ showToast }) {
  const { t } = useT();
  const [subcategories, setSubcategories] = useState([]);
  const [usage, setUsage] = useState({});
  const [draft, setDraft] = useState(emptyDraft);

  const load = async () => {
    try {
      const [list, txs] = await Promise.all([
        api.getTags(),
        api.searchTransactions({ status: 'all' }).catch(() => ({ transactions: [] })),
      ]);
      setSubcategories(list);
      const counts = {};
      for (const tx of txs.transactions || []) {
        for (const id of tx.tags || []) counts[id] = (counts[id] || 0) + 1;
      }
      setUsage(counts);
    } catch {
      /* the page still works without the counts */
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const name = draft.name.trim();
    if (!name) return;
    try {
      await api.createTag(name, { color: draft.color, icon: draft.icon });
      showToast(`Subcategoria "${name}" criada`);
      setDraft(emptyDraft());
      load();
    } catch (err) {
      showToast(errText(err));
    }
  };

  // Cheap to recreate and it takes nothing with it, so it gets the armed bin
  // rather than a dialog. The browser's own confirm() used to be here, stopping
  // the whole page for a decision worth one click.
  const remove = async (id) => {
    try {
      await api.deleteTag(id);
      load();
    } catch (err) {
      showToast(errText(err));
    }
  };

  const rename = async (id, patch) => {
    const current = subcategories.find((s) => s.id === id);
    const name = String(patch.name || '').trim();
    if (!current || !name || name === current.name) return;
    try {
      await api.updateTag(id, { name });
      showToast(`Subcategoria renomeada para "${name}"`);
      load();
    } catch (err) {
      showToast(errText(err));
    }
  };

  const restyle = async (id, patch) => {
    try {
      await api.updateTag(id, patch);
      load();
    } catch (err) {
      showToast(errText(err));
    }
  };

  const editor = useRowEditor({ onSave: rename, onDelete: remove });

  const rows = useMemo(
    () => subcategories.map((s) => ({ ...s, count: usage[s.id] || 0 })),
    [subcategories, usage]
  );
  const subColumns = useMemo(() => SUB_COLUMNS(t), [t]);
  const { rows: sorted, sort, toggleSort } = useSortableRows(
    rows,
    subColumns,
    'subcategories.sort',
    { key: 'count', dir: 'desc' }
  );

  return (
    <>
      <h3 className="section-title">
        <Icon name="tag" size={17} />{t('categories.subcategories')}<span className="section-title-aside">{subcategories.length}</span>
      </h3>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table-fixed">
          <thead>
            <tr>
              {subColumns.map((col) => (
                <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((sub) => {
              const editing = editor.isEditing(sub.id);
              return (
                <tr key={sub.id} className={editing ? 'is-editing' : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    <div className="category-edit">
                      <StylePicker
                        icon={sub.icon}
                        color={sub.color}
                        onPickIcon={(icon) => restyle(sub.id, { icon })}
                        onPickColor={(color) => restyle(sub.id, { color })}
                        bare
                      />
                      <EditableField
                        editing={editing}
                        value={editing ? editor.draft?.name : sub.name}
                        autoFocus
                        onChange={(name) => editor.patch({ name })}
                        onStartEdit={() => editor.start(sub, { name: sub.name })}
                        onCommit={editor.commit}
                        onCancel={editor.cancel}
                      />
                    </div>
                  </td>
                  <td className="num muted">{sub.count}</td>
                  <td>
                    <RowActions
                      editing={editing}
                      deleting={editor.isDeleting(sub.id)}
                      busy={editor.busy}
                      onEdit={() => editor.start(sub, { name: sub.name })}
                      onSave={editor.commit}
                      onCancel={editor.cancel}
                      onAskDelete={() => editor.askDelete(sub.id)}
                      onConfirmDelete={() => editor.confirmDelete(sub.id)}
                    />
                  </td>
                </tr>
              );
            })}
            <AddRow
              columns={subColumns}
              draft={draft}
              placeholder={t('categories.newSubcategory')}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onAdd={create}
              onClear={() => setDraft(emptyDraft())}
            >
              <td />
            </AddRow>
          </tbody>
        </table>
      </div>
    </>
  );
}
