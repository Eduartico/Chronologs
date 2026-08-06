import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import IconButton from './ui/IconButton.jsx';

/**
 * How this bank spells the things the internal-transfer logic needs to
 * recognise — five patterns, editable, instead of five constants baked into
 * `accounts.js` in ActivoBank's own words.
 *
 * The reason this matters: the whole point of `accounts.js` is refusing to
 * count a move between the owner's own accounts as spending — that mistake is
 * what made October 2025 read €3.333 heavier than it actually was. That logic
 * only fires when it recognises "TRF P/", "PoupeUp", "LEV ATM" for what they
 * are. A Santander statement spells the same three ideas differently, and
 * without a place to say so the whole protection silently stops working for
 * anyone who isn't on ActivoBank.
 *
 * "Testar" runs the candidate against the real ledger without saving it, so a
 * typo in a hand-edited regex shows up as "0 movimentos reconhecidos" before
 * it is ever applied — not after.
 */
const FIELDS = [
  { key: 'transferOut', label: 'Dinheiro sai desta conta', hint: 'ex.: TRF P/, TRANSF PARA' },
  { key: 'transferIn', label: 'Dinheiro entra nesta conta', hint: 'ex.: TRF DE, TRANSF DE PARTE DE' },
  { key: 'savingsProduct', label: 'Isto é o produto de poupança', hint: 'ex.: PoupeUp' },
  { key: 'savingsAccount', label: 'Esta conta é a de poupança', hint: 'ex.: POUPEUP|POUPANÇA' },
  { key: 'cashWithdrawal', label: 'Isto é um levantamento ATM', hint: 'ex.: LEV ATM' },
];

export default function InstitutionProfile({ showToast }) {
  const [defaultProfile, setDefaultProfile] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getInstitutionProfile().then(({ profile, default: def }) => {
      setDefaultProfile(def);
      setSaved(profile || def);
      setDraft(profile || def);
    }).catch(() => {});
  }, []);

  if (!draft) return null;

  const isCustom = !!saved && saved.name !== defaultProfile?.name;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function test() {
    setBusy('test');
    try {
      setPreview(await api.previewInstitutionProfile(draft));
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    try {
      await api.saveInstitutionProfile(draft);
      setSaved(draft);
      showToast(`Perfil «${draft.name}» guardado — a recalcular o ledger`);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  function resetToDefault() {
    setDraft(defaultProfile);
    setPreview(null);
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ flex: 1 }}>Banco</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {isCustom ? `perfil «${saved.name}»` : `omissão (${defaultProfile?.name})`}
        </span>
        <IconButton
          icon={open ? 'chevronLeft' : 'chevronRight'}
          label={open ? 'Fechar' : 'Editar como este banco escreve as transferências internas'}
          onClick={() => setOpen((o) => !o)}
        />
      </div>

      {open && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 12px' }}>
            Contar uma transferência entre as tuas próprias contas como despesa é o erro que este
            sistema existe para evitar — e só evita porque reconhece as palavras do extracto. Isto é
            o que ensina o Chronologs a ler o extracto de outro banco.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <input
              placeholder="Nome do banco"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ maxWidth: 260 }}
            />
            {FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {f.label} <span className="muted">— {f.hint}</span>
                </span>
                <input
                  value={draft[f.key] || ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-ghost btn-sm" onClick={test} disabled={busy === 'test'}>
              {busy === 'test' ? 'A testar…' : 'Testar contra o ledger'}
            </button>
            <button className="btn-primary btn-sm" onClick={save} disabled={!dirty || busy === 'save'}>
              Guardar
            </button>
            {isCustom && (
              <button className="btn-ghost btn-sm" onClick={resetToDefault} disabled={busy != null}>
                Repor ActivoBank
              </button>
            )}
            {preview && (
              <span className="evidence" style={{ marginLeft: 'auto' }}>
                {preview.internalMovements} movimentos internos · {preview.vaults.length} cofres
                {preview.reconciled === false && ' · não bate certo'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
