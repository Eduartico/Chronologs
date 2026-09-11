import { Fragment, useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n/index.js';
import { nf } from '../lib/locale.js';
import { formatDate } from '../lib/format.js';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import { useSortableRows } from '../lib/useSortableRows.js';
import TransferChord from '../components/charts/TransferChord.jsx';
import NetWorthSummary from '../components/NetWorthSummary.jsx';

/**
 * Where the money sits, and what the app had to work out to know that.
 *
 * ActivoBank statements cover two accounts and the ledger holds both, so every
 * move between them was recorded twice — once as money leaving the current
 * account, once as money arriving in the savings one. Counting either as
 * spending is what made October 2025 read €3.333 heavier than it was.
 *
 * The two legs are paired back into a single movement here, and the reconciliation
 * strip states plainly how much of the savings balance the app can actually
 * account for. It never quietly rounds the difference away.
 */

const euro = (n) =>
  `€${nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))}`;

const KIND_LABEL = { current: 'Conta corrente', savings: 'Poupança', secondary: 'Secundária' };

const VAULT_COLUMNS = [
  { key: 'vault', label: 'Cofre', get: (v) => v.vault },
  { key: 'balance', label: 'Saldo', align: 'right', get: (v) => v.balance },
  { key: 'movements', label: 'Mov.', align: 'right', get: (v) => v.movements },
  { key: 'lastMovement', label: 'Último', get: (v) => v.lastMovement || '' },
  { key: 'alias', label: '', sortable: false },
];

export default function Accounts() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [movements, setMovements] = useState([]);
  const [openVault, setOpenVault] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aliasing, setAliasing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getAccounts());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleVault = async (vault) => {
    if (openVault === vault) {
      setOpenVault(null);
      return;
    }
    setOpenVault(vault);
    try {
      setMovements(await api.getInternalMovements(vault));
    } catch {
      setMovements([]);
    }
  };

  const applyAlias = async (from, to) => {
    setAliasing(from);
    try {
      await api.setVaultAlias(from, to || null);
      await load();
      setOpenVault(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setAliasing(null);
    }
  };

  const {
    rows: vaults,
    sort,
    toggleSort,
  } = useSortableRows(data?.vaults || [], VAULT_COLUMNS, 'accounts.vaultSort', {
    key: 'balance',
    dir: 'desc',
  });

  if (loading) return <div className="empty-state">{t('common.loading')}</div>;
  if (error) return <div className="empty-state">Erro: {error}</div>;
  if (!data) return null;

  const { accounts = [], vaultTotal = 0, reconciliation, needsAttribution } = data;
  const namedVaults = vaults.filter((v) => !v.unnamed).map((v) => v.vault);

  return (
    <>
      <div className="page-header">
        <h2>
          <Icon name="accounts" size={22} /> {t('accounts.titleFull')}
        </h2>
        <button className="btn-ghost btn-sm" onClick={load}>
          <Icon name="refresh" size={15} />{t('common.refresh')}</button>
      </div>

      {/* What there is, before what it is divided into. The page opened on two
          bank balances and called that the answer, while a third of the money
          was an index fund on another screen. */}
      <NetWorthSummary />

      <div className="grid-2">
        {accounts.map((account) => (
          <div className="card" key={account.id}>
            <div className="section-title">
              <Icon name={account.kind === 'savings' ? 'vault' : 'accounts'} size={17} />
              {KIND_LABEL[account.kind] || account.kind}
            </div>
            <div className="stat">
              <div className="stat-value">
                {account.lastBalance != null ? euro(account.lastBalance) : '—'}
              </div>
              <div className="stat-label">
                {account.lastBalanceDate
                  ? `saldo do extracto de ${formatDate(account.lastBalanceDate)}`
                  : 'sem saldo no extracto'}
              </div>
            </div>
            <dl className="account-meta">
              <dt>Nº</dt>
              <dd>{account.id}</dd>
              <dt>{t('accounts.names')}</dt>
              <dd>{account.labels.join(' · ')}</dd>
              <dt>{t('accounts.movements')}</dt>
              <dd>
                {account.transactions} · {formatDate(account.firstDate)} → {formatDate(account.lastDate)}
              </dd>
              {account.holder && (
                <>
                  <dt>{t('accounts.holder')}</dt>
                  <dd>{account.holder}</dd>
                </>
              )}
            </dl>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-title">
          <Icon name="vault" size={17} />{t('accounts.vaults')}<span className="section-title-aside">{euro(vaultTotal)} atribuídos</span>
        </div>

        {/*
          Only shown when something is actually wrong. A reconciliation that
          balances has nothing to report — printing "bate certo" anyway is a
          sentence of arithmetic nobody asked for, on a screen that already
          says as much by having no warning on it at all.
        */}
        {reconciliation && !reconciliation.balanced && (
          <div className="reconcile">
            <span>
              <strong>Faltam {euro(Math.abs(reconciliation.unaccounted))}.</strong> O extracto de{' '}
              {formatDate(reconciliation.statementDate)} diz{' '}
              {euro(reconciliation.statementBalance)}, e os movimentos que temos só explicam{' '}
              {euro(reconciliation.computed + reconciliation.interest)} — a diferença é o que a
              conta já tinha antes do primeiro extracto ingerido.
            </span>
          </div>
        )}

        <table className="vault-table">
          <thead>
            <tr>
              {VAULT_COLUMNS.map((col) => (
                <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {vaults.map((vault) => (
              <Fragment key={vault.vault}>
                <tr className={vault.short ? 'row-warn' : undefined}>
                  <td>
                    <button
                      className="vault-name"
                      onClick={() => toggleVault(vault.vault)}
                      aria-expanded={openVault === vault.vault}
                    >
                      <Icon
                        name="chevronRight"
                        size={14}
                        className={openVault === vault.vault ? 'chev open' : 'chev'}
                      />
                      <span>{vault.vault}</span>
                    </button>
                    {/* Deposited and withdrawn are context for the balance, not
                        competitors to it: they belong under the name, not in
                        columns of their own. */}
                    <div className="vault-flow">
                      {euro(vault.deposited)} guardados · {euro(vault.withdrawn)} levantados
                      {vault.estimated && (
                        <>
                          {' · '}
                          <span
                            className="vault-estimated"
                            title="O banco só começou a nomear os cofres no descritivo a meio do histórico, por isso alguns depósitos ficaram registados com o nome errado. O total da conta está certo; esta repartição é inferida."
                          >
                            {vault.settled > 0
                              ? `${euro(vault.settled)} atribuídos de ${vault.settledWith.join(', ')}`
                              : `${euro(-vault.settled)} atribuídos a ${vault.settledWith.join(', ')}`}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="num">
                    <strong className="vault-balance">{euro(vault.balance)}</strong>
                  </td>
                  <td className="num">{vault.movements}</td>
                  <td>{formatDate(vault.lastMovement)}</td>
                  <td>
                    {vault.unnamed && namedVaults.length > 0 && (
                      <select
                        className="vault-alias"
                        disabled={aliasing === vault.vault}
                        defaultValue=""
                        onChange={(e) => e.target.value && applyAlias(vault.vault, e.target.value)}
                      >
                        <option value="">{t('accounts.belongsTo')}</option>
                        {namedVaults.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                {openVault === vault.vault && (
                  <tr>
                    <td colSpan={5}>
                      <table className="subtable">
                        <tbody>
                          {movements.map((m, i) => (
                            <tr key={`${m.currentId || m.mirrorId}-${i}`}>
                              <td>{formatDate(m.date)}</td>
                              <td>
                                {m.direction === 'deposit' ? 'Guardado' : 'Levantado'}
                                {m.singleEntry && (
                                  <span className="tag" title={t('accounts.singleEntryHelp')}>{t('accounts.singleEntry')}</span>
                                )}
                              </td>
                              <td
                                className={`num ${
                                  m.direction === 'deposit' ? 'amount-positive' : 'amount-negative'
                                }`}
                              >
                                {euro(m.amount)}
                              </td>
                              <td className="muted">{m.description}</td>
                            </tr>
                          ))}
                          {movements.length === 0 && (
                            <tr>
                              <td colSpan={4} className="muted">{t('accounts.noMovements')}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {needsAttribution && (
          <p className="hint">
            O banco só começou a nomear os cofres no descritivo a meio do histórico, e antes disso
            escrevia «PoupeUp» ou o genérico «Mealheiro» — por isso há depósitos registados com o
            nome errado. Quando um cofre aparece a ser esvaziado sem nunca se ter visto ser enchido,
            os depósitos em falta são reclamados ao cofre onde o dinheiro realmente estava. O total
            da conta mantém-se exacto; as linhas marcadas acima é que são estimativas.
          </p>
        )}
      </div>

      {/* Appended, never substituted — the vault table above stays exactly as it
          was so the diagram can be judged against it rather than instead of it. */}
      {/* Traffic between the current account and its vaults. It was behind an
          experiment flag; the flags are gone, and this is accounts data rather
          than dashboard data, so it lives here unconditionally instead of
          joining the dashboard's widget catalogue. */}
      <TransferChord />
    </>
  );
}
