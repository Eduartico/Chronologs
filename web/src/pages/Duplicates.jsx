import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../lib/format.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

/**
 * Duplicate review.
 *
 * Deliberately not automatic. In this ledger, identical rows on the same day
 * are usually real — one statement holds fifteen separate €0.01 international
 * fees and thirteen €0.14 Google charges. So each group is shown with its
 * evidence, and "Verificar no documento" re-reads the original PDF to say how
 * many copies the document actually justifies.
 */

const EVIDENCE_LABEL = {
  'same-document': 'mesmo documento',
  'different-documents': 'documentos diferentes',
  'different-document-kinds': 'extrato + nota',
  'same-date': 'mesma data',
  'dates-apart': 'datas diferentes',
  'repeat-ordinal': 'lida como repetição',
};

const CONFIDENCE_LABEL = {
  high: 'Muito provável',
  review: 'A confirmar',
  low: 'Pouco provável',
};

function formatAmount(amount) {
  const num = Number(amount) || 0;
  return (
    <span className={num >= 0 ? 'amount-positive' : 'amount-negative'}>
      {num >= 0 ? '+' : '−'}€{Math.abs(num).toFixed(2)}
    </span>
  );
}

export default function Duplicates({ onCountChange }) {
  const [data, setData] = useState({ groups: [], surplus: 0, voided: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [checks, setChecks] = useState({});
  const [toast, setToast] = useState(null);
  const [showVoided, setShowVoided] = usePersistentState('duplicates.showVoided', false);
  const [voided, setVoided] = useState([]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getDuplicates();
      setData(result);
      onCountChange?.(result.groups.length);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function verify(group) {
    setBusy(group.key);
    try {
      const result = await api.verifyDuplicate(group.key, group.transactions.map((t) => t.id));
      setChecks((prev) => ({ ...prev, [group.key]: result }));
      if (!result.verified) {
        showToast(
          result.reason === 'document-not-found'
            ? 'O documento original já não está em user-data/documents.'
            : `Não foi possível verificar: ${result.reason}`
        );
      }
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function keepOnly(group, keepId) {
    setBusy(group.key);
    try {
      const r = await api.voidDuplicates(group.transactions.map((t) => t.id), keepId);
      showToast(
        r.collapsed
          ? 'Este grupo já só tinha um movimento — não havia nada para anular.'
          : `${r.voided} transacção(ões) anuladas — o registo original mantém-se no ledger.`
      );
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(group) {
    setBusy(group.key);
    try {
      await api.dismissDuplicate(group.key);
      showToast('Marcado como não sendo duplicado.');
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function loadVoided() {
    try {
      setVoided(await api.getVoidedTransactions());
      setShowVoided(true);
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function restore(id) {
    try {
      await api.restoreTransactions([id]);
      showToast('Transacção reposta.');
      setVoided(await api.getVoidedTransactions());
      load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Duplicados</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            {loading
              ? 'A analisar…'
              : `${data.groups.length} grupos suspeitos · ${data.surplus} registos a mais se todos forem duplicados`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {data.voided > 0 && (
            <button className="btn-ghost" onClick={loadVoided}>
              {data.voided} anuladas
            </button>
          )}
          <button className="btn-ghost" onClick={load}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh" size={15} /> Reanalisar
            </span>
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
        Compras repetidas no mesmo dia costumam ser <strong>reais</strong> — quinze custos de
        €0,01 ou treze micro-compras no mesmo extrato acontecem mesmo. Antes de anular, usa{' '}
        <strong>Verificar no documento</strong>: o PDF original é lido outra vez e diz quantas
        cópias é que existem de facto. Nada é apagado do ledger — a anulação é ela própria um
        registo e pode ser revertida.
      </div>

      {loading ? (
        <div className="empty-state"><p>A analisar o ledger…</p></div>
      ) : data.groups.length === 0 ? (
        <div className="empty-state">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={18} /> Sem duplicados por rever
          </h3>
          <p>Nenhum grupo de transacções parecidas ficou por decidir.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.groups.map((g) => {
            const check = checks[g.key];
            return (
              <div key={g.key} className="card" style={{ opacity: busy === g.key ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontWeight: 600 }}>{g.description}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {g.count} registos · {formatDate(g.date)}
                      {g.dateTo !== g.date && ` → ${formatDate(g.dateTo)}`}
                      {g.documentFilename && ` · ${g.documentFilename}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 600 }}>{formatAmount(g.amount)}</div>
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <span className={`evidence${g.confidence === 'high' ? ' strong' : ''}`}>
                    {CONFIDENCE_LABEL[g.confidence]}
                  </span>
                  {g.evidence.map((e) => (
                    <span key={e.key} className={`evidence${e.strong ? ' strong' : ''}`}>
                      {EVIDENCE_LABEL[e.key] || e.key}
                    </span>
                  ))}
                </div>

                {check?.verified && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 'var(--r-sm)',
                      background: check.surplus > 0 ? 'var(--warn-soft)' : 'var(--good-soft)',
                      color: check.surplus > 0 ? 'var(--warn)' : 'var(--good)',
                      fontSize: 13,
                    }}
                  >
                    {check.surplus > 0
                      ? `O documento justifica ${check.expected} registo(s), mas o ledger tem ${check.found}. ${check.surplus} a mais.`
                      : `O documento contém mesmo ${check.expected} registo(s) — não são duplicados.`}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  {g.transactions.map((t) => (
                    <div key={t.id} className="dup-row">
                      <span style={{ minWidth: 84 }}>{formatDate(t.date)}</span>
                      <span style={{ flex: 1, minWidth: 140 }}>{t.description}</span>
                      {t.occurrence > 1 && (
                        <span className="evidence">ocorrência {t.occurrence}</span>
                      )}
                      {t.ingestions > 1 && (
                        <span className="evidence" title="O mesmo documento foi lido mais do que uma vez; o movimento conta uma só vez.">
                          lido {t.ingestions}×
                        </span>
                      )}
                      <span className="doc">{t.documentFilename || '—'}</span>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => keepOnly(g, t.id)}
                        title="Anula todos os outros registos deste grupo"
                      >
                        Manter só esta
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn-primary btn-sm" onClick={() => verify(g)} disabled={busy === g.key}>
                    Verificar no documento
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => dismiss(g)}>
                    Não são duplicados
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showVoided && (
        <div className="modal-overlay" onClick={() => setShowVoided(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Transacções anuladas</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Continuam no ledger e podem voltar a contar a qualquer momento.
            </p>
            {voided.length === 0 && <p>Nenhuma.</p>}
            {voided.map((t) => (
              <div key={t.id} className="dup-row">
                <span style={{ minWidth: 84 }}>{formatDate(t.date)}</span>
                <span style={{ flex: 1 }}>{t.description}</span>
                <span>{formatAmount(t.amount)}</span>
                <button className="btn-ghost btn-sm" onClick={() => restore(t.id)}>
                  Repor
                </button>
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowVoided(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
