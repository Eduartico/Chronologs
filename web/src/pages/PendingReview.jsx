import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDate } from '../lib/format.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import CategoryPicker from '../components/CategoryPicker.jsx';
import { useLlmStatus } from '../lib/useLlmStatus.js';

const SORT_FIELDS = [
  { id: 'date', label: 'Data' },
  { id: 'amount', label: 'Valor' },
];

/**
 * Sorting without a table to click.
 *
 * Everywhere else the column head is the control; this screen is a stack of
 * cards, so it borrows the gesture rather than the markup — one press sorts by
 * that field, a second reverses it, and the arrow says which way. What it
 * replaces is a dropdown that spelled all four combinations out as sentences.
 */
function SortStrip({ sort, onChange }) {
  const [field, dir] = String(sort).split('_');
  return (
    <div className="sort-strip">
      {SORT_FIELDS.map((f) => {
        const active = field === f.id;
        return (
          <button
            key={f.id}
            type="button"
            className={`sort-strip-btn ${active ? 'is-on' : ''}`.trim()}
            onClick={() => onChange(active ? `${f.id}_${dir === 'asc' ? 'desc' : 'asc'}` : `${f.id}_desc`)}
            title={`Ordenar por ${f.label.toLowerCase()}`}
          >
            {f.label}
            <Icon name={active && dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={12} />
          </button>
        );
      })}
    </div>
  );
}

const SOURCE_LABEL = {
  history: 'já categorizaste assim',
  travel: 'estavas em viagem',
  llm: 'palpite da IA — confirma',
  rule: 'regra tua',
  template: 'template',
  keyword: 'palavra-chave',
};

// Above this, a suggestion is worth its own button rather than a pill the eye
// skips. Two strong candidates then sit side by side and either is one click
// away — the model's fixed 0.55 never reaches it, so a guess still reads as a
// guess.
const STRONG_SUGGESTION = 0.7;
const MAX_STRONG_BUTTONS = 3;

/** Splits suggestions into the ones that earn a button and the rest. */
function splitSuggestions(suggestions = []) {
  const strong = suggestions
    .filter((s) => s.source !== 'llm' && (s.confidence || 0) >= STRONG_SUGGESTION)
    .slice(0, MAX_STRONG_BUTTONS);
  const rest = suggestions.filter((s) => !strong.includes(s));
  return { strong, rest };
}

function formatAmount(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  return (
    <span className={num >= 0 ? 'amount-positive' : 'amount-negative'}>
      {num >= 0 ? '+' : '−'}€{Math.abs(num).toFixed(2)}
    </span>
  );
}


function dateRange(from, to) {
  if (!from || from === to) return formatDate(to || from);
  return `${formatDate(from)} — ${formatDate(to)}`;
}

/**
 * A model guess never gets the confident green treatment — it renders as a
 * neutral pill so the eye does not read it as a verified match.
 */
function SuggestionPill({ suggestion, onAccept, primary }) {
  const pct = Math.round((suggestion.confidence || 0) * 100);
  const isGuess = suggestion.source === 'llm';
  return (
    <button
      className={primary && !isGuess ? 'btn-green btn-sm' : 'tag'}
      onClick={onAccept}
      title={suggestion.reason || ''}
      style={{ cursor: 'pointer' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {primary && !isGuess && <Icon name="check" size={11} />}
        {isGuess && <Icon name="brain" size={11} />}
        {suggestion.category} <span style={{ opacity: 0.75 }}>{pct}%</span>
      </span>
    </button>
  );
}

export default function PendingReview({ onCountChange }) {
  const [mode, setMode] = usePersistentState('pendingreview.mode', 'grouped');
  const [sort, setSort] = usePersistentState('pendingreview.sort', 'date_desc');
  const [groups, setGroups] = useState([]);
  const [flat, setFlat] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [travels, setTravels] = useState([]);
  const llm = useLlmStatus();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  // Selection is by group key in grouped mode and by transaction id in flat
  // mode; both resolve to a flat list of transaction ids before any bulk call.
  const [selected, setSelected] = useState(() => new Set());
  // Anchor for shift-click range selection.
  const lastToggled = useRef(null);
  const [newTagName, setNewTagName] = useState('');
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [applyingRules, setApplyingRules] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, cats, tagList] = await Promise.all([
        api.getPending({ sort, group: mode === 'grouped' ? 'merchant' : undefined }),
        api.getCategories(true),
        api.getTags(),
      ]);
      setCategories(cats);
      setTags(tagList);
      setTotal(data.totalPending);
      setGroups(data.groups || []);
      setFlat(data.transactions || []);
      setSelected(new Set());
      onCountChange?.(data.totalPending);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [sort, mode, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.getTravels().then(setTravels).catch(() => {});
  }, []);

  const travelFor = useCallback(
    (dateStr) => {
      const d = String(dateStr).slice(0, 10);
      return travels.find((t) => t.window && d >= t.window.from && d <= t.window.to) || null;
    },
    [travels]
  );

  // Every id currently selected, whichever mode produced the selection.
  const selectedIds = useMemo(() => {
    if (mode === 'grouped') {
      return groups.filter((g) => selected.has(g.key)).flatMap((g) => g.transactionIds);
    }
    return flat.filter((t) => selected.has(t.id)).map((t) => t.id);
  }, [selected, groups, flat, mode]);

  const visibleKeys = mode === 'grouped' ? groups.map((g) => g.key) : flat.map((t) => t.id);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    lastToggled.current = key;
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleKeys));
  }

  /** Selects every card between the last one touched and this one. */
  function selectRangeTo(key) {
    const from = visibleKeys.indexOf(lastToggled.current);
    const to = visibleKeys.indexOf(key);
    if (from === -1 || to === -1) return toggle(key);
    const [start, end] = from <= to ? [from, to] : [to, from];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of visibleKeys.slice(start, end + 1)) next.add(k);
      return next;
    });
    lastToggled.current = key;
  }

  /**
   * The whole card selects, not just the checkbox — but only when the click was
   * not aimed at something else. Accepting a suggestion, opening a picker or
   * expanding the sample all live inside the card and must not double as a
   * selection.
   */
  function selectFromCard(event, key) {
    if (event.target.closest('button, a, select, input, summary, [role="button"]:not(.card)')) return;
    if (event.shiftKey) {
      // Stops the browser turning a shift-click into a text selection.
      window.getSelection?.()?.removeAllRanges();
      selectRangeTo(key);
    } else {
      toggle(key);
    }
  }

  function selectFromKey(event, key) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    toggle(key);
  }

  async function acceptGroup(group, category) {
    setBusy(group.key);
    try {
      const r = await api.categorizeBulk(group.transactionIds, category);
      showToast(`${r.applied} transacções categorizadas como "${category}"`);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function acceptOne(tx, category) {
    setBusy(tx.id);
    try {
      await api.categorize(tx.id, category);
      showToast(`Categorizada como "${category}"`);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function categorizeSelection(category) {
    if (selectedIds.length === 0) return;
    setBusy('selection');
    try {
      const r = await api.categorizeBulk(selectedIds, category);
      showToast(`${r.applied} transacções categorizadas como "${category}"`);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function tagSelection(tagId) {
    if (selectedIds.length === 0) return;
    setBusy('selection');
    try {
      const r = await api.tagBulk(selectedIds, tagId);
      showToast(`${r.applied} transacções marcadas`);
      setShowTagMenu(false);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function createAndTag() {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const tag = await api.createTag(name);
      setNewTagName('');
      await tagSelection(tag.id);
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function runLlm() {
    setBusy('llm');
    showToast('A perguntar ao modelo local… isto pode demorar.');
    try {
      const r = await api.suggestWithLlm();
      if (r.classified === 0) {
        showToast(`O modelo analisou ${r.asked} comerciantes e não identificou nenhum com confiança.`);
      } else {
        // Merge the model's answers into the groups already on screen rather
        // than reloading — nothing was written to the ledger.
        const byKey = new Map(r.results.map((x) => [x.key, x]));
        setGroups((prev) =>
          prev.map((g) => {
            const hit = byKey.get(g.key);
            if (!hit) return g;
            // Merged by confidence, not prepended: the model's answers rank
            // below every deterministic source, so they only lead when nothing
            // else recognised the merchant.
            return {
              ...g,
              suggestions: [
                ...g.suggestions.filter((s) => s.category !== hit.category),
                {
                  category: hit.category,
                  confidence: hit.confidence,
                  source: 'llm',
                  reason: 'palpite do modelo local — confirma antes de aceitar',
                },
              ].sort((a, b) => b.confidence - a.confidence),
            };
          })
        );
        showToast(
          `O modelo deu palpites para ${r.classified} de ${r.asked} comerciantes. ` +
            `Confirma um a um — modelos pequenos raramente admitem que não sabem.`
        );
      }
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  const covered = groups.filter((g) => g.suggestions.length > 0).reduce((s, g) => s + g.count, 0);

  // How many of these already have a strong rule match sitting unapplied —
  // the queue should not be asking a human to re-decide what a rule already
  // answered, it should just apply the answer and leave only what nothing
  // could resolve.
  const ruleResolvedCount = useMemo(() => {
    const items = mode === 'grouped' ? groups : flat;
    return items.reduce((sum, item) => {
      const hasStrongRule = (item.suggestions || []).some(
        (s) => s.source === 'rule' && (s.confidence || 0) >= STRONG_SUGGESTION
      );
      if (!hasStrongRule) return sum;
      return sum + (mode === 'grouped' ? item.count : 1);
    }, 0);
  }, [groups, flat, mode]);

  async function applyRuleMatches() {
    setApplyingRules(true);
    try {
      const result = await api.runRules();
      showToast(`${result.categorized} categorizadas pelas tuas regras.`);
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setApplyingRules(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Por rever</h2>
          {!loading && total > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
              {total} transacções
              {mode === 'grouped' && (
                <> em <strong>{groups.length}</strong> comerciantes · {covered} com sugestão</>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn-ghost"
            onClick={runLlm}
            disabled={busy === 'llm' || !llm.ready}
            title={llm.ready ? undefined : 'Liga um modelo local em Definições para usar isto'}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name={busy === 'llm' ? 'hourglass' : 'brain'} size={15} />
              {busy === 'llm' ? 'A analisar…' : `Sugerir com IA${llm.ready ? ` (${llm.model})` : ''}`}
            </span>
          </button>
          <button className="btn-ghost" onClick={load}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh" size={15} /> Actualizar
            </span>
          </button>
        </div>
      </div>

      {/* The queue should not ask a human to re-decide what a rule already
          answers — it should apply the answer and leave only what nothing
          could resolve. Only appears when there is unapplied rule coverage
          sitting in the queue; disappears the moment "Aplicar" clears it. */}
      {ruleResolvedCount > 0 && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <p style={{ flex: 1, fontSize: 13 }}>
            <strong>{ruleResolvedCount}</strong> destas já têm resposta nas tuas regras.
          </p>
          <button className="btn-primary btn-sm" onClick={applyRuleMatches} disabled={applyingRules}>
            {applyingRules ? 'A aplicar…' : 'Aplicar'}
          </button>
        </div>
      )}

      {/* Controls for a queue with nothing in it are furniture: a select-all
          that selects nothing, a sort order for no rows. They appear when there
          is something to review. */}
      {visibleKeys.length > 0 && (
        <div className="filter-bar">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              className="select-box"
              checked={allSelected}
              onChange={toggleAll}
            />
            Seleccionar tudo o que está visível
          </label>
          <SortStrip sort={sort} onChange={setSort} />
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="grouped">Agrupado por comerciante</option>
            <option value="flat">Uma a uma</option>
          </select>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="selection-bar">
          <span className="selection-count">
            {selectedIds.length} {selectedIds.length === 1 ? 'transacção' : 'transacções'}
            {mode === 'grouped' && ` em ${selected.size} comerciantes`}
          </span>

          <CategoryPicker
            compact
            label="Categorizar como…"
            categories={categories}
            disabled={busy === 'selection'}
            onPick={categorizeSelection}
          />

          <div style={{ position: 'relative' }}>
            <button
              className="btn-ghost btn-sm"
              disabled={busy === 'selection'}
              onClick={() => setShowTagMenu((s) => !s)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="tag" size={14} /> Adicionar tag…
              </span>
            </button>
            {showTagMenu && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  zIndex: 30,
                  width: 260,
                  maxHeight: 300,
                  overflowY: 'auto',
                  background: 'var(--surface-3)',
                  boxShadow: 'var(--shadow-3)',
                  padding: 'var(--sp-3)',
                }}
              >
                {tags.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Ainda não há tags.
                  </p>
                )}
                {tags.map((t) => (
                  <button
                    key={t.id}
                    className="category-option"
                    style={{ marginBottom: 4 }}
                    onClick={() => tagSelection(t.id)}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: t.color,
                        flexShrink: 0,
                      }}
                    />
                    {t.name}
                  </button>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    placeholder="Nova tag…"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createAndTag()}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button className="btn-primary btn-sm" onClick={createAndTag} disabled={!newTagName.trim()}>
                    Criar
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn-ghost btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setSelected(new Set())}
          >
            Limpar selecção
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><p>A carregar…</p></div>
      ) : total === 0 ? (
        <div className="empty-state">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={18} /> Está tudo categorizado
          </h3>
          <p>Não há transacções à espera de revisão.</p>
        </div>
      ) : mode === 'grouped' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => {
            const { strong, rest } = splitSuggestions(g.suggestions);
            const top = strong[0] || g.suggestions[0];
            const alternates = strong.slice(1);
            const others = rest.slice(0, 3);
            const travel = travelFor(g.dateFrom);
            const isSelected = selected.has(g.key);
            return (
              <div
                key={g.key}
                className={`card selectable${isSelected ? ' selected' : ''}`}
                style={{ padding: 16, opacity: busy === g.key ? 0.5 : 1 }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={(e) => selectFromCard(e, g.key)}
                onKeyDown={(e) => selectFromKey(e, g.key)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 220 }}>
                    <input
                      type="checkbox"
                      className="select-box"
                      style={{ marginTop: 4 }}
                      checked={isSelected}
                      onChange={() => toggle(g.key)}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{g.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {g.count} {g.count === 1 ? 'transacção' : 'transacções'} · {dateRange(g.dateFrom, g.dateTo)}
                        {travel && (
                          <span style={{ color: 'var(--info)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            · <Icon name="travel" size={11} /> {travel.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 600 }}>{formatAmount(g.total)}</div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {top ? (
                    <>
                      <SuggestionPill
                        suggestion={top}
                        primary
                        onAccept={() => acceptGroup(g, top.category)}
                      />
                      {alternates.map((s) => (
                        <SuggestionPill
                          key={s.category}
                          suggestion={s}
                          primary
                          onAccept={() => acceptGroup(g, s.category)}
                        />
                      ))}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {strong.length > 1
                          ? strong.map((s) => SOURCE_LABEL[s.source] || s.source).join(' / ')
                          : SOURCE_LABEL[top.source] || top.source}
                        {g.count > 1 && ` · aplica a ${g.count}`}
                      </span>
                      {others.length > 0 && (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ou</span>
                          {others.map((s) => (
                            <SuggestionPill
                              key={s.category}
                              suggestion={s}
                              onAccept={() => acceptGroup(g, s.category)}
                            />
                          ))}
                        </>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Sem sugestão — escolhe a categoria:
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <CategoryPicker
                      compact
                      label="Outra…"
                      categories={categories}
                      onPick={(c) => acceptGroup(g, c)}
                    />
                  </div>
                </div>

                {g.count > 1 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
                      Ver exemplo
                    </summary>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                      {g.sample.description} · {formatDate(g.sample.date)}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {flat.map((tx) => {
            const { strong, rest } = splitSuggestions(tx.suggestions);
            const top = strong[0] || tx.suggestions[0];
            const alternates = strong.slice(1);
            const travel = travelFor(tx.date);
            const isSelected = selected.has(tx.id);
            return (
              <div
                key={tx.id}
                className={`card selectable${isSelected ? ' selected' : ''}`}
                style={{ padding: 14, opacity: busy === tx.id ? 0.5 : 1 }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={(e) => selectFromCard(e, tx.id)}
                onKeyDown={(e) => selectFromKey(e, tx.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 220 }}>
                    <input
                      type="checkbox"
                      className="select-box"
                      style={{ marginTop: 4 }}
                      checked={isSelected}
                      onChange={() => toggle(tx.id)}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>{tx.description}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDate(tx.date)}
                        {travel && (
                          <span style={{ color: 'var(--info)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            · <Icon name="travel" size={11} /> {travel.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{formatAmount(tx.amount)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {top ? (
                    <>
                      <SuggestionPill suggestion={top} primary onAccept={() => acceptOne(tx, top.category)} />
                      {alternates.map((s) => (
                        <SuggestionPill
                          key={s.category}
                          suggestion={s}
                          primary
                          onAccept={() => acceptOne(tx, s.category)}
                        />
                      ))}
                      {rest.slice(0, 2).map((s) => (
                        <SuggestionPill key={s.category} suggestion={s} onAccept={() => acceptOne(tx, s.category)} />
                      ))}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem sugestão</span>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <CategoryPicker
                      compact
                      label="Outra…"
                      categories={categories}
                      onPick={(c) => acceptOne(tx, c)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
