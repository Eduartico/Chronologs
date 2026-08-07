import { useState, useEffect } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import Icon from './Icon.jsx';
import IconButton from './ui/IconButton.jsx';
import Switch from './ui/Switch.jsx';
import { useRowEditor } from '../lib/useRowEditor.js';

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
  const { t } = useT();
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
      showToast(errText(e));
    }
  };

  const decide = async (proposal, confirm) => {
    try {
      if (confirm) await api.confirmCorrelation(proposal.id);
      else await api.rejectCorrelation(proposal.id);
      load();
    } catch (e) {
      showToast(errText(e));
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
      showToast(errText(e));
    }
  };

  // The armed bin, not a blocking browser dialog: one press loads it, a second
  // fires, and it forgets after a few seconds.
  const removeRule = async (id) => {
    await api.deleteCorrelationRule(id).catch(() => {});
    load();
  };

  const editor = useRowEditor({ onDelete: removeRule });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="link" size={16} />{t('correlations.title')}</h3>
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
              placeholder={t('correlations.namePlaceholder')}
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
              placeholder={t('correlations.hintPlaceholder')}
              value={draft.textHint}
              onChange={(e) => setDraft({ ...draft, textHint: e.target.value })}
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, marginTop: 8 }}>
            <label>± days <input type="number" value={draft.dateWindowDays} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, dateWindowDays: e.target.value })} /></label>
            <label>{t('correlations.tolerancePct')}<input type="number" value={draft.amountTolerancePct} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, amountTolerancePct: e.target.value })} /></label>
            <label>{t('correlations.toleranceEur')}<input type="number" value={draft.amountToleranceAbs} style={{ width: 60 }} onChange={(e) => setDraft({ ...draft, amountToleranceAbs: e.target.value })} /></label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Switch checked={draft.allowAggregate} onChange={(allowAggregate) => setDraft({ ...draft, allowAggregate })} />{t('correlations.allowCombining')}<input type="number" value={draft.maxAggregateSize} style={{ width: 50 }} onChange={(e) => setDraft({ ...draft, maxAggregateSize: e.target.value })} />
              transactions
            </label>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn-ghost btn-sm" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
              <button className="btn-green btn-sm" onClick={saveDraft}>{t('correlations.create')}</button>
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
              <span style={{ marginLeft: 'auto' }}>
                <Switch
                  checked={!!r.enabled}
                  onChange={(enabled) => api.updateCorrelationRule(r.id, { enabled }).then(load)}
                  label="enabled"
                />
              </span>
              {editor.isDeleting(r.id) ? (
                <IconButton
                  icon="check"
                  tone="armed"
                  label={t('correlations.confirmDelete')}
                  onClick={() => editor.confirmDelete(r.id)}
                />
              ) : (
                <IconButton icon="trash" tone="danger" label={t('common.delete')} onClick={() => editor.askDelete(r.id)} />
              )}
            </div>
          ))}
        </div>
      )}

      <h4 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0' }}>
        Pending proposals {proposals.length > 0 && `(${proposals.length})`}
      </h4>
      {proposals.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('correlations.nothingToReview')}</p>
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
              <IconButton icon="check" tone="good" label={t('correlations.confirm')} onClick={() => decide(p, true)} />
              <IconButton icon="close" tone="danger" label={t('correlations.reject')} onClick={() => decide(p, false)} />
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
