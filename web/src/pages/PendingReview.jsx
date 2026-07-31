import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';

const SORTS = [
  { id: 'date_desc', label: 'Mais recentes primeiro' },
  { id: 'date_asc', label: 'Mais antigas primeiro' },
  { id: 'amount_desc', label: 'Maior valor primeiro' },
  { id: 'amount_asc', label: 'Menor valor primeiro' },
];

const SOURCE_LABEL = {
  history: 'já categorizaste assim',
  llm: 'palpite da IA — confirma',
  rule: 'regra tua',
  template: 'template',
  keyword: 'palavra-chave',
};

function formatAmount(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  return (
    <span className={num >= 0 ? 'amount-positive' : 'amount-negative'}>
      {num >= 0 ? '+' : '−'}€{Math.abs(num).toFixed(2)}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
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
      {primary && !isGuess ? '✓ ' : ''}
      {isGuess ? '🧠 ' : ''}
      {suggestion.category} <span style={{ opacity: 0.75 }}>{pct}%</span>
    </button>
  );
}

function CategoryPicker({ categories, onPick, label = 'Outra…' }) {
  return (
    <select
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      style={{ minWidth: 130 }}
    >
      <option value="">{label}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export default function PendingReview({ onCountChange }) {
  const [mode, setMode] = useState('grouped');
  const [sort, setSort] = useState('date_desc');
  const [groups, setGroups] = useState([]);
  const [flat, setFlat] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [llm, setLlm] = useState({ enabled: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, cats] = await Promise.all([
        api.getPending({ sort, group: mode === 'grouped' ? 'merchant' : undefined }),
        api.getCategories(),
      ]);
      setCategories(cats);
      setTotal(data.totalPending);
      setGroups(data.groups || []);
      setFlat(data.transactions || []);
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
    api.getLlmStatus().then(setLlm).catch(() => {});
  }, []);

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
          {llm.enabled ? (
            <button className="btn-ghost" onClick={runLlm} disabled={busy === 'llm'}>
              {busy === 'llm' ? '⏳ A analisar…' : `🧠 Sugerir com IA (${llm.model || 'sem modelo'})`}
            </button>
          ) : (
            <span
              style={{ fontSize: 12, color: 'var(--text-muted)' }}
              title="Activa o Ollama em Settings para classificar os comerciantes que as regras não reconhecem"
            >
              🧠 IA desligada — activa em Settings
            </span>
          )}
          <button className="btn-ghost" onClick={load}>↻ Actualizar</button>
        </div>
      </div>

      <div className="filter-bar">
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="grouped">Agrupado por comerciante</option>
          <option value="flat">Uma a uma</option>
        </select>
      </div>

      {loading ? (
        <div className="empty-state"><p>A carregar…</p></div>
      ) : total === 0 ? (
        <div className="empty-state">
          <h3>Está tudo categorizado 🎉</h3>
          <p>Não há transacções à espera de revisão.</p>
        </div>
      ) : mode === 'grouped' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => {
            const top = g.suggestions[0];
            const others = g.suggestions.slice(1, 4);
            return (
              <div key={g.key} className="card" style={{ padding: 16, opacity: busy === g.key ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {g.count} {g.count === 1 ? 'transacção' : 'transacções'} · {dateRange(g.dateFrom, g.dateTo)}
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
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {SOURCE_LABEL[top.source] || top.source}
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
                    <CategoryPicker categories={categories} onPick={(c) => acceptGroup(g, c)} />
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
            const top = tx.suggestions[0];
            return (
              <div key={tx.id} className="card" style={{ padding: 14, opacity: busy === tx.id ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 500 }}>{tx.description}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(tx.date)}</div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{formatAmount(tx.amount)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {top ? (
                    <>
                      <SuggestionPill suggestion={top} primary onAccept={() => acceptOne(tx, top.category)} />
                      {tx.suggestions.slice(1, 3).map((s) => (
                        <SuggestionPill key={s.category} suggestion={s} onAccept={() => acceptOne(tx, s.category)} />
                      ))}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem sugestão</span>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <CategoryPicker categories={categories} onPick={(c) => acceptOne(tx, c)} />
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
