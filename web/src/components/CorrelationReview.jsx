import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const EMPTY = {
  name: '',
  sourceA: 'activobank',
  sourceB: 'pricempire',
  directionA: 'debit',
  textHint: '',
  dateWindowDays: 4,
  amountTolerancePct: 10,
  amountToleranceAbs: 5,
  allowAggregate: true,
  maxAggregateSize: 4,
};

export default function CorrelationReview({ showToast }) {
  const [rules, setRules] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [draft, setDraft] = useState(null);

  const load = async () => {
    const [r, p] = await Promise.all([api.getCorrelationRules(), api.getCorrelations('pending')]);
    setRules(r);
    setProposals(p);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const run = async () => {
    try {
      const result = await api.runCorrelations();
      showToast(`Correlation run: ${result.proposals} new proposal(s)`);
      load();
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  };

  const decide = async (proposal, confirm) => {
    try {
      if (confirm) await api.confirmCorrelation(proposal.id);
      else await api.rejectCorrelation(proposal.id);
      load();
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  };

  const saveDraft = async () => {
    try {
      await api.createCorrelationRule({
        ...draft,
        dateWindowDays: parseInt(draft.dateWindowDays) || 4,
        amountTolerancePct: parseFloat(draft.amountTolerancePct) || 10,
        amountToleranceAbs: parseFloat(draft.amountToleranceAbs) || 5,
        maxAggregateSize: parseInt(draft.maxAggregateSize) || 4,
      });
      setDraft(null);
      showToast('Correlation rule created');
      load();
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  };

  const removeRule = async (rule) => {
    if (!confirm(`Delete correlation rule "${rule.name}"?`)) return;
    await api.deleteCorrelationRule(rule.id).catch(() => {});
    load();
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>🔗 Correlations</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={run}>▶ Run now</button>
          <button className="btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY })}>+ New correlation rule</button>
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 12px' }}>
        Correlation rules match transactions across platforms by date proximity and amount (with
        tolerance — e.g. a −100€ bank debit vs several Pricempire purchases summing ≈100€). Each
        find becomes a notification you confirm or reject here.
      </p>

      {draft && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <input
              placeholder="Rule name (e.g. Bank → CSFloat topups)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ minWidth: 220 }}
            />
            <select value={draft.sourceA} onChange={(e) => setDraft({ ...draft, sourceA: e.target.value })}>
              <option value="activobank">A: activobank</option>
              <option value="pricempire">A: pricempire</option>
              <option value="manual">A: manual</option>
            </select>
            <span>↔</span>
            <select value={draft.sourceB} onChange={(e) => setDraft({ ...draft, sourceB: e.target.value })}>
              <option value="pricempire">B: pricempire</option>
              <option value="activobank">B: activobank</option>
              <option value="manual">B: manual</option>
            </select>
            <input
              placeholder="text hint (e.g. csfloat)"
              value={draft.textHint}
              onChange={(e) => setDraft({ ...draft, textHint: e.target.value })}
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, marginTop: 8 }}>
            <label>± days <input type="number" value={draft.dateWindowDays} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, dateWindowDays: e.target.value })} /></label>
            <label>tolerance % <input type="number" value={draft.amountTolerancePct} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, amountTolerancePct: e.target.value })} /></label>
            <label>tolerance € <input type="number" value={draft.amountToleranceAbs} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, amountToleranceAbs: e.target.value })} /></label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={draft.allowAggregate} onChange={(e) => setDraft({ ...draft, allowAggregate: e.target.checked })} />
              allow combining up to
              <input type="number" value={draft.maxAggregateSize} style={{ width: 50 }} onChange={(e) => setDraft({ ...draft, maxAggregateSize: e.target.value })} />
              transactions
            </label>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn-ghost btn-sm" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn-green btn-sm" onClick={saveDraft}>Create</button>
            </span>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {rules.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
              <strong>{r.name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                {r.sourceA} → {r.sourceB}
                {r.textHint && ` · "${r.textHint}"`} · ±{r.dateWindowDays}d · ±{r.amountTolerancePct}%/€{r.amountToleranceAbs}
                {r.allowAggregate && ` · combines ≤${r.maxAggregateSize}`}
              </span>
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!r.enabled}
                  onChange={(e) => api.updateCorrelationRule(r.id, { enabled: e.target.checked }).then(load)}
                />
                enabled
              </label>
              <button className="btn-red btn-sm" onClick={() => removeRule(r)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0' }}>
        Pending proposals {proposals.length > 0 && `(${proposals.length})`}
      </h4>
      {proposals.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing to review.</p>
      )}
      {proposals.map((p) => (
        <div
          key={p.id}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 10,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge">{p.ruleName}</span>
            <strong className="amount-negative">{p.amountA?.toFixed(2)}€</strong>
            <span>↔</span>
            <strong>{p.bTransactionIds.length} tx ≈ {p.amountB?.toFixed(2)}€</strong>
            {p.partial && <span className="badge badge-pending">partial</span>}
            <span style={{ color: 'var(--text-muted)' }}>score {p.score}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn-green btn-sm" onClick={() => decide(p, true)}>Confirm</button>
              <button className="btn-red btn-sm" onClick={() => decide(p, false)}>Reject</button>
            </span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
            {p.aTransactionId} ↔ {p.bTransactionIds.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
}
