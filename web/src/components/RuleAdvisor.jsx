import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import Icon from './Icon.jsx';
import IconButton from './ui/IconButton.jsx';
import { useLlmStatus } from '../lib/useLlmStatus.js';

const NO_LLM_LABEL = 'Liga um modelo local em Definições para usar isto';

/**
 * The rule advisor's UI.
 *
 * Four lists, and every entry leads with a sentence saying what was noticed
 * and why. It used to lead with "12 regras → 1 · food", which tells you the
 * shape of the change and nothing about whether you want it — you had to open
 * "Detalhes" and read twelve raw patterns to find out it was all Continente.
 *
 * The sentence is written by the server from the data, so it is there with the
 * model switched off. Ollama adds a second opinion underneath, labelled as a
 * guess.
 *
 * Accepting a suggestion used to call `load()`, which re-ran the whole
 * analysis — including the optional Ollama pass — and threw away every model
 * note on screen along with the card that was just accepted. Now it only
 * removes that one card from local state; the rest of the panel, model notes
 * included, stays exactly as it was.
 *
 * Rejections are kept. A suggestion turned down does not come back, and the
 * reason is replayed into the next model prompt — which is the whole point of
 * asking for a note.
 */
/**
 * A finding's explanation.
 *
 * The engine now sends `{rationaleKey, rationaleParams}` beside the sentence it
 * has always sent. Preferring the key is what makes the advisor speak the reader's
 * language; falling back to the sentence is what keeps a finding that was fetched
 * before this change — or produced by an older server — readable rather than blank.
 */
function explain(finding, t, prefix = 'rationale') {
  const key = finding?.[`${prefix}Key`];
  return key ? t(key, finding[`${prefix}Params`] || {}) : finding?.[prefix];
}

export default function RuleAdvisor({ categories = [], onChanged }) {
  const { t } = useT();
  const llm = useLlmStatus();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Distinct from `loading`: this is a re-analysis on top of a panel that
  // already has content, so the old content stays visible under a dimmed
  // overlay instead of being replaced by a blank "a carregar" card.
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [compaction, setCompaction] = useState(null);
  const [compacting, setCompacting] = useState(false);

  async function load(useLlm = false) {
    const isRefresh = data != null;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setMessage(null);
    try {
      setData(await api.getAdvisor(useLlm));
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const llmNoteFor = (id) => data?.llm?.findings?.find((f) => f.id === id);

  /** Drops one finding from whichever list it lives in, without touching the rest. */
  function dismiss(id) {
    setData((d) =>
      d && {
        ...d,
        collapses: d.collapses.filter((c) => c.id !== id),
        shadowed: (d.shadowed || []).filter((s) => s.id !== id),
        ambiguous: (d.ambiguous || []).filter((a) => a.id !== id),
        patterns: (d.patterns || []).filter((p) => p.id !== id),
        anomalies: d.anomalies.filter((a) => a.id !== id),
      }
    );
  }

  async function acceptCollapse(candidate, force = false) {
    setBusy(candidate.id);
    try {
      const r = await api.acceptCollapse(candidate.id, force);
      setMessage(`${r.removed} regras substituídas por 1.`);
      dismiss(candidate.id);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function acceptAnomaly(finding) {
    setBusy(finding.id);
    try {
      await api.acceptAnomaly(finding.id, finding.transaction.id, finding.expected);
      setMessage(`Movida para "${finding.expected}".`);
      dismiss(finding.id);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function acceptPattern(finding) {
    setBusy(finding.id);
    try {
      await api.acceptPattern(finding.id);
      setMessage(`Regra criada: «${finding.root}» → ${finding.category}.`);
      dismiss(finding.id);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /** The other direction: the flagged one was right, the group was wrong. */
  async function inverseAnomaly(finding) {
    setBusy(finding.id);
    try {
      const r = await api.inverseAnomaly(finding.id);
      setMessage(`${r.moved} transacção(ões) do grupo movidas para "${r.category}".`);
      dismiss(finding.id);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function resolveShadowed(finding, action) {
    setBusy(finding.id);
    try {
      const r = await api.resolveShadowed(finding.id, action);
      const affected = r.impact?.affected;
      const impactNote =
        affected != null ? ` (${affected === 0 ? 'nada muda' : `${affected} transacções mudam`})` : '';
      setMessage(
        (r.action === 'delete'
          ? `«${finding.rule.name}» apagada.`
          : r.action === 'deleteGeneral'
            ? `«${finding.shadowedBy.name}» apagada — «${finding.rule.name}» decide agora.`
            : r.action === 'promote'
              ? `«${finding.rule.name}» sobe na ordem — decide a partir de agora.`
              : `«${finding.shadowedBy.name}» passa a apontar para ${r.category}.`) + impactNote
      );
      dismiss(finding.id);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function reject(item) {
    setBusy(item.id);
    try {
      await api.rejectAdvice(item.id, item.kind, item.subject, note.trim() || null);
      dismiss(item.id);
      setRejecting(null);
      setNote('');
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function previewCompaction() {
    setCompacting(true);
    try {
      setCompaction(await api.previewCompaction());
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setCompacting(false);
    }
  }

  async function applyCompaction() {
    setCompacting(true);
    try {
      const r = await api.applyCompaction();
      setMessage(`${r.removed} regras aprendidas substituídas por ${r.created}.`);
      setCompaction(null);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setCompacting(false);
    }
  }

  if (!data && !loading) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h3>{t('advisor.title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Procura regras que dizem a mesma coisa e podem ser fundidas, e classificações que
              destoam do resto do comerciante. Tem em conta as viagens: um supermercado marcado
              como viagem só é estranho fora de uma viagem detectada.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={() => load(false)}>{t('advisor.analyse')}</button>
            <button
              className="btn-ghost"
              onClick={() => load(true)}
              disabled={!llm.ready}
              title={llm.ready ? 'Junta a opinião do modelo local' : NO_LLM_LABEL}
            >{t('advisor.analyseWithAi')}</button>
            <button className="btn-ghost" onClick={previewCompaction} disabled={compacting}>
              {compacting ? 'A ver…' : 'Compactar regras aprendidas'}
            </button>
          </div>
        </div>
        {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
        {compaction && (
          <CompactionPreview
            preview={compaction}
            busy={compacting}
            onApply={applyCompaction}
            onCancel={() => setCompaction(null)}
          />
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('advisor.simulating')}</p>
      </div>
    );
  }

  return (
    <div className="card advisor-panel" style={{ marginBottom: 12 }}>
      {/* The panel underneath stays fully rendered and interactive-looking
          while this sits on top — a re-analysis is not the first analysis,
          and the model notes already on screen should not vanish to make
          room for a spinner. */}
      {refreshing && (
        <div className="advisor-overlay">
          <p>A voltar a simular sobre {data?.totalRules ?? 0} regras…</p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ flex: 1 }}>{t('advisor.title')}</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {data.totalRules} regras · {data.feedback} decisões memorizadas
        </span>
        <button
          className="btn-ghost btn-sm"
          onClick={() => load(true)}
          disabled={refreshing || !llm.ready}
          title={llm.ready ? undefined : NO_LLM_LABEL}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="brain" size={14} />{t('advisor.askAi')}</span>
        </button>
        <button className="btn-ghost btn-sm" onClick={previewCompaction} disabled={compacting}>
          {compacting ? 'A ver…' : 'Compactar regras aprendidas'}
        </button>
        <button className="btn-ghost btn-sm" onClick={() => setData(null)}>{t('common.close')}</button>
      </div>

      {compaction && (
        <CompactionPreview
          preview={compaction}
          busy={compacting}
          onApply={applyCompaction}
          onCancel={() => setCompaction(null)}
        />
      )}

      {data.llm?.error && (
        <p style={{ fontSize: 12, color: 'var(--warn)', marginTop: 6 }}>{data.llm.error}</p>
      )}
      {message && <p style={{ marginTop: 8, fontSize: 13 }}>{message}</p>}

      <h4 className="section-title" style={{ fontSize: 14, marginTop: 16 }}>
        Colapsar regras ({data.collapses.length})
      </h4>
      {data.collapses.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('advisor.nothingToMerge')}</p>
      )}
      {data.collapses.map((c) => {
        const llm = llmNoteFor(c.id);
        const merchants = c.merchants || c.patterns;
        return (
          <div key={c.id} className="advice-item" style={{ opacity: busy === c.id ? 0.5 : 1 }}>
            {/* The reasoning first. The counts are the footnote, not the headline. */}
            <p className="advice-lead">{explain(c, t)}</p>

            <div className="advice-actions">
              <span className="evidence">
                {c.replaces.length} regras → 1 · {c.category}
              </span>
              {c.ambiguous ? (
                <span className="evidence strong" title={c.ambiguous.summary}>{t('advisor.ambiguousRoot')}</span>
              ) : c.lossless ? (
                <span className="evidence">{t('advisor.noCategoryChange')}</span>
              ) : (
                <span className="evidence strong">{c.changed} transacções mudariam</span>
              )}
              <span style={{ flex: 1 }} />
              <IconButton
                icon="search"
                label={expanded === c.id ? 'Esconder detalhes' : 'Ver os padrões e o impacto'}
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              />
              <IconButton
                icon="check"
                tone="good"
                label={
                  c.lossless
                    ? 'Fundir: substitui as regras antigas por uma só'
                    : `Fundir mesmo assim — ${c.changed} transacções mudam de categoria`
                }
                disabled={busy === c.id}
                onClick={() => acceptCollapse(c, !c.lossless)}
              />
              <IconButton
                icon="close"
                tone="danger"
                label={t('advisor.rejectAndRemember')}
                disabled={busy === c.id}
                onClick={() => setRejecting(c)}
              />
            </div>

            {llm && <p className="advice-llm">{llm.note}</p>}

            {expanded === c.id && (
              <div className="advice-details">
                <strong>{t('advisor.merchants')}</strong>
                <div className="advice-details-grid">
                  {merchants.slice(0, 40).map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                  {merchants.length > 40 && <span className="muted">+{merchants.length - 40}</span>}
                </div>
                {c.changes?.length > 0 && (
                  <>
                    <strong style={{ marginTop: 8, display: 'block' }}>{t('advisor.changesThisWouldCause')}</strong>
                    <div className="advice-details-grid">
                      {c.changes.map((ch) => (
                        <span key={ch.id}>
                          {ch.description} · {ch.before} → {ch.after}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/*
        Rules that never get their turn. Invisible in a list of four hundred
        entries, and the reason a correction can look like it did nothing.
      */}
      {data.shadowed?.length > 0 && (
        <>
          <h4 className="section-title" style={{ fontSize: 14 }}>
            Regras que nunca decidem ({data.shadowed.length})
          </h4>
          {data.shadowed.map((s) => {
            const llm = llmNoteFor(s.id);
            return (
              <div key={s.id} className="advice-item" style={{ opacity: busy === s.id ? 0.5 : 1 }}>
                <p className="advice-lead">{explain(s, t)}</p>
                <div className="advice-actions">
                  <span className="evidence">
                    {s.matched} transacções · ordem {s.rule.order} depois de {s.shadowedBy.order}
                  </span>
                  <span style={{ flex: 1 }} />
                  {/* Every option that could apply here, at once — a single
                      guessed fix used to leave no way out when it guessed
                      wrong (two rules with the same name and different
                      categories, or a specific rule that just needs to go
                      even though it agrees with the general one). Deleting
                      the specific rule never changes a single existing
                      categorization — it never wins today, that is what
                      "shadowed" means — so it is always on offer. */}
                  <IconButton
                    icon="trash"
                    tone="danger"
                    label={`Apagar «${s.rule.name}»${s.redundant ? ' — já não faz diferença' : ''}`}
                    disabled={busy === s.id}
                    onClick={() => resolveShadowed(s, 'delete')}
                  />
                  {s.canDeleteGeneral && (
                    <IconButton
                      icon="trash"
                      tone="danger"
                      label={`Apagar «${s.shadowedBy.name}» em vez desta — é a que está a tapar`}
                      disabled={busy === s.id}
                      onClick={() => resolveShadowed(s, 'deleteGeneral')}
                    />
                  )}
                  {!s.redundant && (
                    <>
                      <IconButton
                        icon="arrowUp"
                        tone="good"
                        label={`Subir «${s.rule.name}» acima de «${s.shadowedBy.name}»`}
                        disabled={busy === s.id}
                        onClick={() => resolveShadowed(s, 'promote')}
                      />
                      {s.retargetTo && (
                        <IconButton
                          icon="refresh"
                          tone="good"
                          label={`Mudar «${s.shadowedBy.name}» para ${s.retargetTo}, que é o que a maioria das transacções dela já é`}
                          disabled={busy === s.id}
                          onClick={() => resolveShadowed(s, 'retarget')}
                        />
                      )}
                    </>
                  )}
                  <IconButton
                    icon="close"
                    tone="danger"
                    label={t('advisor.fineAsIs')}
                    disabled={busy === s.id}
                    onClick={() => setRejecting(s)}
                  />
                </div>
                {llm && <p className="advice-llm">{llm.note}</p>}
              </div>
            );
          })}
        </>
      )}

      {/*
        Roots the data says cannot carry one rule. Nothing here knows what MB WAY
        is — it knows that root lands in seven categories, which is the same
        answer for Bizum or Swish.
      */}
      {data.ambiguous?.length > 0 && (
        <>
          <h4 className="section-title" style={{ fontSize: 14 }}>
            Não dá para automatizar ({data.ambiguous.length})
          </h4>
          {data.ambiguous.map((a) => {
            const llm = llmNoteFor(a.id);
            return (
              <div key={a.id} className="advice-item" style={{ opacity: busy === a.id ? 0.5 : 1 }}>
                <p className="advice-lead">
                  «{a.root}» aparece em {a.total} transacções repartidas por {a.categories.length}{' '}
                  categorias ({a.summary}). É um método de pagamento ou uma transferência, não um
                  comerciante — uma regra única classificaria mal a maior parte. Vale mais deixar
                  estas a decidir uma a uma.
                </p>
                <div className="advice-actions">
                  <span className="evidence">{a.sample.slice(0, 2).join(' · ')}</span>
                  <span style={{ flex: 1 }} />
                  <IconButton
                    icon="close"
                    tone="danger"
                    label={t('advisor.dontWarnRoot')}
                    disabled={busy === a.id}
                    onClick={() => setRejecting(a)}
                  />
                </div>
                {llm && <p className="advice-llm">{llm.note}</p>}
              </div>
            );
          })}
        </>
      )}

      {/*
        The mirror image of the ambiguous list: roots the ledger agrees on
        three or more times over, with no rule yet saying so. This is what a
        correction produces now instead of a one-transaction rule — evidence
        first, a rule only once the evidence is there.
      */}
      {data.patterns?.length > 0 && (
        <>
          <h4 className="section-title" style={{ fontSize: 14 }}>
            Padrões sem regra ({data.patterns.length})
          </h4>
          {data.patterns.map((p) => {
            const llm = llmNoteFor(p.id);
            return (
              <div key={p.id} className="advice-item" style={{ opacity: busy === p.id ? 0.5 : 1 }}>
                <p className="advice-lead">{explain(p, t)}</p>
                <div className="advice-actions">
                  <span className="evidence">{p.share}% concordam · {p.sample.slice(0, 2).join(' · ')}</span>
                  <span style={{ flex: 1 }} />
                  <IconButton
                    icon="check"
                    tone="good"
                    label={`Criar regra «${p.root}» → ${p.category}`}
                    disabled={busy === p.id}
                    onClick={() => acceptPattern(p)}
                  />
                  <IconButton
                    icon="close"
                    tone="danger"
                    label={t('advisor.noThanks')}
                    disabled={busy === p.id}
                    onClick={() => setRejecting(p)}
                  />
                </div>
                {llm && <p className="advice-llm">{llm.note}</p>}
              </div>
            );
          })}
        </>
      )}

      <h4 className="section-title" style={{ fontSize: 14 }}>
        Achados estranhos ({data.anomalies.length})
      </h4>
      {data.anomalies.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('advisor.noAnomalies')}</p>
      )}
      {data.anomalies.map((a) => {
        const llm = llmNoteFor(a.id);
        return (
          <div key={a.id} className="advice-item" style={{ opacity: busy === a.id ? 0.5 : 1 }}>
            <p className="advice-lead">
              <strong>{a.transaction.description}</strong> — {explain(a, t, 'reason')}
            </p>
            <div className="advice-actions">
              {a.travel && (
                <span className="evidence">
                  <Icon name="travel" size={11} /> {a.travel.name}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <IconButton
                icon="check"
                tone="good"
                label={`Mudar para ${a.expected}`}
                disabled={busy === a.id}
                onClick={() => acceptAnomaly(a)}
              />
              {/* The direction the accept button never offered: this one was
                  right, and it is the majority that is wrong. */}
              <IconButton
                icon="arrowUp"
                tone="good"
                label={`Esta é que está certa — mudar o resto do grupo para ${a.transaction.category}`}
                disabled={busy === a.id}
                onClick={() => inverseAnomaly(a)}
              />
              <IconButton
                icon="close"
                tone="danger"
                label={t('advisor.isCorrect')}
                disabled={busy === a.id}
                onClick={() => setRejecting(a)}
              />
            </div>
            {llm && <p className="advice-llm">{llm.note}</p>}
          </div>
        );
      })}

      {rejecting && (
        <div className="modal-overlay" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('advisor.whyWrong')}</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Opcional, mas o motivo fica guardado e entra no contexto da próxima análise — a
              sugestão não voltará a aparecer.
            </p>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('advisor.notePlaceholder')}
              style={{ width: '100%' }}
            />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setRejecting(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={() => reject(rejecting)}>{t('advisor.rejectAndRemember')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What compacting the learned rules would do, before it does it — every
 * root it would merge, the category it picked (the real ledger's majority,
 * not whichever correction happened first), and how many transactions would
 * actually change category as a result.
 */
function CompactionPreview({ preview, busy, onApply, onCancel }) {
  const { t } = useT();
  if (preview.groups.length === 0) {
    return (
      <div className="advisor-overlay" style={{ position: 'static', marginTop: 12 }}>
        <p>{t('advisor.nothingToCompact')}</p>
        <button className="btn-ghost btn-sm" onClick={onCancel}>{t('common.close')}</button>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>
          Compactar regras aprendidas — {preview.before} → {preview.after}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          {preview.removed} regras de uma transacção cada substituídas por {preview.created}, uma por
          raiz de comerciante, cada uma com a categoria que a maioria real já tem.{' '}
          {preview.changed === 0
            ? 'Nenhuma transacção muda de categoria.'
            : `${preview.changed} transacção(ões) mudariam de categoria.`}
        </p>
        <div className="advice-details-grid" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {preview.groups.map((g) => (
            <span key={g.root}>
              «{g.root}» — {g.replaces.length} regras → {g.category}
            </span>
          ))}
        </div>
        {preview.changes.length > 0 && (
          <>
            <strong style={{ marginTop: 10, display: 'block', fontSize: 13 }}>{t('advisor.transactionsThatWouldChange')}</strong>
            <div className="advice-details-grid" style={{ maxHeight: 160, overflowY: 'auto' }}>
              {preview.changes.map((ch) => (
                <span key={ch.id}>
                  {ch.description} · {ch.before} → {ch.after}
                </span>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn-primary" disabled={busy} onClick={onApply}>{t('advisor.compact')}</button>
        </div>
      </div>
    </div>
  );
}
