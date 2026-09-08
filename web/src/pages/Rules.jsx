import { useState, useEffect } from 'react';
import { useT } from '../i18n/index.js';
import { fetchModules } from '../modules/registry.js';
import { api, errText } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import CorrelationReview from '../components/CorrelationReview.jsx';
import InstitutionProfile from '../components/InstitutionProfile.jsx';
import RuleAdvisor from '../components/RuleAdvisor.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import RowActions from '../components/ui/RowActions.jsx';
import EditableField from '../components/ui/EditableField.jsx';
import { DateRangeField } from '../components/ui/DateField.jsx';
import Switch from '../components/ui/Switch.jsx';
import RuleConditionTree, { emptyGroup, pruneTree, describeTree } from '../components/RuleConditionTree.jsx';
import { useRowEditor } from '../lib/useRowEditor.js';

const EMPTY_RULE = {
  name: '',
  stopProcessing: false,
  // `tree` sits alongside the flat fields in the draft but is only ever saved
  // when advanced mode is on — see `cleanRule`. Keeping both in one draft
  // means switching the toggle back and forth does not lose what was typed
  // into either form.
  advanced: false,
  conditions: {
    text: [{ field: 'any', op: 'contains', value: '' }],
    dateRange: { from: '', to: '' },
    amountRange: { min: '', max: '' },
    direction: 'any',
    sources: [],
    tree: emptyGroup('all'),
  },
  actions: { setCategory: '', addTags: [] },
};

/**
 * Where a movement came from, as the rule editor offers it.
 *
 * Read from what is installed rather than written down: a fork with a different
 * bank had a source filter listing two providers it does not have and not the
 * one it does. `manual` is always there — it is the app itself, not a module.
 */
function useSources() {
  const [sources, setSources] = useState(['manual']);
  useEffect(() => {
    fetchModules().then(({ instances }) => {
      const ids = instances.filter((i) => i.kind === 'source' || i.missing).map((i) => i.id);
      setSources([...new Set([...ids, 'manual'])]);
    });
  }, []);
  return sources;
}

function cleanRule(draft) {
  const c = draft.conditions;

  // Advanced mode saves the tree and nothing else — the two forms edit the
  // same draft object but are never combined into one rule, which would make
  // "what actually has to be true" impossible to read back from either view.
  if (draft.advanced) {
    const tree = pruneTree(c.tree);
    return {
      name: draft.name || 'Unnamed rule',
      stopProcessing: draft.stopProcessing,
      conditions: tree ? { tree } : {},
      actions: {
        setCategory: draft.actions.setCategory || null,
        addTags: draft.actions.addTags,
      },
    };
  }

  const conditions = {};
  const text = (c.text || []).filter((t) => t.value.trim());
  if (text.length) conditions.text = text;
  if (c.dateRange?.from || c.dateRange?.to) {
    conditions.dateRange = {
      from: c.dateRange.from || null,
      to: c.dateRange.to || null,
    };
  }
  if (c.amountRange?.min !== '' || c.amountRange?.max !== '') {
    conditions.amountRange = {
      min: c.amountRange.min === '' ? null : parseFloat(c.amountRange.min),
      max: c.amountRange.max === '' ? null : parseFloat(c.amountRange.max),
    };
  }
  if (c.direction && c.direction !== 'any') conditions.direction = c.direction;
  if (c.sources?.length) conditions.sources = c.sources;
  return {
    name: draft.name || text[0]?.value || 'Unnamed rule',
    stopProcessing: draft.stopProcessing,
    conditions,
    actions: {
      setCategory: draft.actions.setCategory || null,
      addTags: draft.actions.addTags,
    },
  };
}

function describeConditions(rule) {
  const c = rule.conditions || {};
  if (c.tree) return describeTree(c.tree);
  const parts = [];
  if (c.text?.length) parts.push(c.text.map((t) => `${t.field} ${t.op} "${t.value}"`).join(' OR '));
  if (c.dateRange)
    parts.push(
      `data ${c.dateRange.from ? formatDate(c.dateRange.from) : '…'} → ${c.dateRange.to ? formatDate(c.dateRange.to) : '…'}`
    );
  if (c.amountRange) parts.push(`|amount| ${c.amountRange.min ?? 0}–${c.amountRange.max ?? '∞'}`);
  if (c.direction) parts.push(c.direction);
  if (c.sources?.length) parts.push(`from ${c.sources.join('/')}`);
  return parts.join(' · ') || 'matches everything';
}

export default function Rules() {
  const { t, tx } = useT();
  const sources = useSources();
  const [rules, setRules] = useState([]);
  const [tags, setTags] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);

  const load = async () => {
    const [r, t, c] = await Promise.all([api.getRules(), api.getTags(), api.getCategories()]);
    setRules(r);
    setTags(t);
    setCategories(c);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setRules(reordered);
    await api.reorderRules(reordered.map((r) => r.id)).catch(() => {});
    load();
  };

  const patch = async (rule, changes) => {
    await api.updateRule(rule.id, changes).catch((e) => showToast(errText(e)));
    load();
  };

  // The browser's own confirm() used to guard this: a modal dialog that blocks
  // the tab, for a rule that takes five seconds to rewrite. The bin arms itself
  // instead — one press to load it, a second to fire.
  const remove = async (id) => {
    await api.deleteRule(id).catch((e) => showToast(errText(e)));
    load();
  };

  const rename = async (id, changes) => {
    const name = String(changes.name || '').trim();
    if (!name) return;
    await api.updateRule(id, { name }).catch((e) => showToast(errText(e)));
    load();
  };

  const editor = useRowEditor({ onSave: rename, onDelete: remove });

  const runNow = async () => {
    try {
      const result = await api.runRules();
      showToast(
        `Rules run: ${result.evaluated} evaluated, ${result.categorized} categorized, ${result.tagged} tagged`
      );
    } catch (e) {
      showToast(errText(e));
    }
  };

  const loadSuggestions = async () => {
    try {
      const settings = await api.getSettings().catch(() => null);
      const s = await api.getRuleSuggestions(!!settings?.llm?.enabled);
      setSuggestions([...(s.static || []), ...(s.llm || [])]);
    } catch (e) {
      showToast(errText(e));
    }
  };

  const accept = async (suggestion) => {
    await api.acceptRuleSuggestion(suggestion).catch((e) => showToast(errText(e)));
    setSuggestions((prev) => prev.filter((s) => s !== suggestion));
    load();
  };

  const saveDraft = async () => {
    try {
      await api.createRule(cleanRule(draft));
      setDraft(null);
      showToast('Rule created');
      load();
    } catch (e) {
      showToast(errText(e));
    }
  };

  const toggleDraftSource = (s) => {
    const sources = draft.conditions.sources.includes(s)
      ? draft.conditions.sources.filter((x) => x !== s)
      : [...draft.conditions.sources, s];
    setDraft({ ...draft, conditions: { ...draft.conditions, sources } });
  };

  const toggleDraftTag = (id) => {
    const addTags = draft.actions.addTags.includes(id)
      ? draft.actions.addTags.filter((x) => x !== id)
      : [...draft.actions.addTags, id];
    setDraft({ ...draft, actions: { ...draft.actions, addTags } });
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t('rules.title')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={loadSuggestions}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="lightbulb" size={15} /> {t('rules.suggestions')}
            </span>
          </button>
          <button className="btn-ghost" onClick={runNow}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="play" size={15} /> {t('rules.runNow')}
            </span>
          </button>
          <button className="btn-primary" onClick={() => setDraft(structuredClone(EMPTY_RULE))}>
            + {t('rules.new')}
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        {tx('rules.help', { stop: <strong>{t('rules.stop')}</strong> })}
        Manual category choices are never overwritten.
      </p>

      <RuleAdvisor categories={categories} onChanged={load} />

      {suggestions && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>{t('rules.suggestedRules')}</h3>
          {suggestions.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {t('rules.noSuggestions')}
            </p>
          )}
          {suggestions.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong>{s.name}</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  → {s.actions?.setCategory}
                  {/* Template suggestions are grouped by category, so one row can
                      stand in for a dozen merchants — say so instead of dumping
                      every pattern inline. */}
                  {s.coversMerchants > 1 &&
                    ` · ${s.conditions?.text?.length || 0} padrões, ${s.coversMerchants} comerciantes`}
                </span>
              </span>
              <span className="badge">{s.origin === 'suggested-llm' ? 'AI' : 'template'}</span>
              <button className="btn-green btn-sm" onClick={() => accept(s)}>{t('rules.accept')}</button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setSuggestions((prev) => prev.filter((x) => x !== s))}
              >
                {t('rules.dismiss')}
              </button>
            </div>
          ))}
          <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSuggestions(null)}>
            {t('common.close')}
          </button>
        </div>
      )}

      {draft && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ flex: 1 }}>{t('rules.new')}</h3>
            <Switch
              checked={draft.advanced}
              onChange={(advanced) => setDraft({ ...draft, advanced })}
              label={t('rules.advanced')}
              title={t('rules.advancedHelp')}
            />
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <input
              placeholder={t('rules.namePlaceholder')}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />

            {draft.advanced ? (
              <RuleConditionTree
                tree={draft.conditions.tree}
                onChange={(tree) => setDraft({ ...draft, conditions: { ...draft.conditions, tree } })}
              />
            ) : (
              <>
            {draft.conditions.text.map((cond, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select
                  value={cond.field}
                  onChange={(e) => {
                    const text = [...draft.conditions.text];
                    text[i] = { ...cond, field: e.target.value };
                    setDraft({ ...draft, conditions: { ...draft.conditions, text } });
                  }}
                >
                  <option value="any">{t('rules.textPlaceholder')}</option>
                  <option value="description">description</option>
                  <option value="merchant">merchant</option>
                </select>
                <select
                  value={cond.op}
                  onChange={(e) => {
                    const text = [...draft.conditions.text];
                    text[i] = { ...cond, op: e.target.value };
                    setDraft({ ...draft, conditions: { ...draft.conditions, text } });
                  }}
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="regex">regex</option>
                </select>
                <input
                  placeholder={t('rules.textShort')}
                  value={cond.value}
                  style={{ flex: 1, minWidth: 140 }}
                  onChange={(e) => {
                    const text = [...draft.conditions.text];
                    text[i] = { ...cond, value: e.target.value };
                    setDraft({ ...draft, conditions: { ...draft.conditions, text } });
                  }}
                />
                {i === draft.conditions.text.length - 1 && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        conditions: {
                          ...draft.conditions,
                          text: [...draft.conditions.text, { field: 'any', op: 'contains', value: '' }],
                        },
                      })
                    }
                  >
                    + OR
                  </button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('common.date')}</span>
              <DateRangeField
                from={draft.conditions.dateRange.from}
                to={draft.conditions.dateRange.to}
                onChange={({ from, to }) =>
                  setDraft({
                    ...draft,
                    conditions: { ...draft.conditions, dateRange: { from, to } },
                  })
                }
              />
              <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>{t('common.amount')}</span>
              <input
                type="number"
                placeholder="min"
                style={{ width: 90 }}
                value={draft.conditions.amountRange.min}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditions: { ...draft.conditions, amountRange: { ...draft.conditions.amountRange, min: e.target.value } },
                  })
                }
              />
              <span>–</span>
              <input
                type="number"
                placeholder="max"
                style={{ width: 90 }}
                value={draft.conditions.amountRange.max}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditions: { ...draft.conditions, amountRange: { ...draft.conditions.amountRange, max: e.target.value } },
                  })
                }
              />
              <select
                value={draft.conditions.direction}
                onChange={(e) =>
                  setDraft({ ...draft, conditions: { ...draft.conditions, direction: e.target.value } })
                }
              >
                <option value="any">{t('rules.anyDirection')}</option>
                <option value="debit">{t('rules.debitOnly')}</option>
                <option value="credit">{t('rules.creditOnly')}</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('rules.sources')}</span>
              {sources.map((s) => (
                <label key={s} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.conditions.sources.includes(s)}
                    onChange={() => toggleDraftSource(s)}
                  />
                  {s}
                </label>
              ))}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>(none = all)</span>
            </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('rules.then')}</span>
              <select
                value={draft.actions.setCategory}
                onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, setCategory: e.target.value } })}
              >
                <option value="">(don't set category)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>set category: {c.name}</option>
                ))}
              </select>
              {tags.map((t) => (
                <label key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.actions.addTags.includes(t.id)}
                    onChange={() => toggleDraftTag(t.id)}
                  />
                  <span style={{ background: t.color, borderRadius: 8, padding: '0 8px', color: '#0d1117', fontWeight: 600 }}>
                    {t.name}
                  </span>
                </label>
              ))}
              <div style={{ marginLeft: 'auto' }}>
                <Switch
                  checked={draft.stopProcessing}
                  onChange={(stopProcessing) => setDraft({ ...draft, stopProcessing })}
                  label={t('rules.stopHelp')}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <RowActions editing onSave={saveDraft} onCancel={() => setDraft(null)} />
            </div>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="empty-state">
          <h3>{t('rules.emptyTitle')}</h3>
          <p>{t('rules.emptyBody')}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>{t('rules.order')}</th>
                <th>{t('rules.rule')}</th>
                <th>{t('rules.conditions')}</th>
                <th>{t('common.actions')}</th>
                <th style={{ width: 60 }}>{t('rules.stop')}</th>
                <th style={{ width: 70 }}>{t('rules.enabled')}</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => (
                <tr key={rule.id} style={{ opacity: rule.enabled ? 1 : 0.5 }}>
                  {/* This table is deliberately not sortable: the order of the
                      rows is the order the rules run in, so re-sorting it would
                      show a sequence the engine does not use. */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <IconButton icon="arrowUp" label={t('rules.moveUp')} onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton
                      icon="arrowDown"
                      label={t('rules.moveDown')}
                      onClick={() => move(i, 1)}
                      disabled={i === rules.length - 1}
                    />
                  </td>
                  <td>
                    <strong>
                      <EditableField
                        editing={editor.isEditing(rule.id)}
                        value={editor.isEditing(rule.id) ? editor.draft?.name : rule.name}
                        autoFocus
                        onChange={(name) => editor.patch({ name })}
                        onStartEdit={() => editor.start(rule, { name: rule.name })}
                        onCommit={editor.commit}
                        onCancel={editor.cancel}
                      />
                    </strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rule.origin}</div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{describeConditions(rule)}</td>
                  <td style={{ fontSize: 12 }}>
                    {rule.actions?.setCategory && <span className="tag">{rule.actions.setCategory}</span>}{' '}
                    {(rule.actions?.addTags || []).map((id) => {
                      const t = tags.find((x) => x.id === id);
                      return t ? (
                        <span key={id} style={{ background: t.color, borderRadius: 8, padding: '0 8px', color: '#0d1117', fontWeight: 600, fontSize: 11 }}>
                          {t.name}
                        </span>
                      ) : null;
                    })}
                  </td>
                  <td>
                    <Switch
                      checked={!!rule.stopProcessing}
                      onChange={(stopProcessing) => patch(rule, { stopProcessing })}
                      title={t('rules.stopHelp')}
                    />
                  </td>
                  <td>
                    <Switch
                      checked={!!rule.enabled}
                      onChange={(enabled) => patch(rule, { enabled })}
                      title={t('rules.enabledHelp')}
                    />
                  </td>
                  <td>
                    <RowActions
                      editing={editor.isEditing(rule.id)}
                      deleting={editor.isDeleting(rule.id)}
                      busy={editor.busy}
                      onEdit={() => editor.start(rule, { name: rule.name })}
                      onSave={editor.commit}
                      onCancel={editor.cancel}
                      onAskDelete={() => editor.askDelete(rule.id)}
                      onConfirmDelete={() => editor.confirmDelete(rule.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CorrelationReview showToast={showToast} />
      <InstitutionProfile showToast={showToast} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
