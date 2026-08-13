import { useEffect, useState } from 'react';
import { api, errText } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { currencyName, nf } from '../../lib/locale.js';
import { PIVOT } from '../../lib/currencies.js';
import { baseIsUnrated } from '../../lib/money.js';
import { useSettings } from '../../state/SettingsProvider.jsx';
import { useRowEditor } from '../../lib/useRowEditor.js';
import Switch from '../../components/ui/Switch.jsx';
import IconButton from '../../components/ui/IconButton.jsx';
import EditableField from '../../components/ui/EditableField.jsx';
import RowActions from '../../components/ui/RowActions.jsx';
import StatusDot from '../../components/ui/StatusDot.jsx';
import { useT } from '../../i18n/index.js';

/**
 * Which currency everything is shown in, and what it is being converted with.
 *
 * This was one number in a box — "1 USD = [0.92] EUR" — which was honest while
 * the app knew two currencies. It ships fourteen languages now, and a reader in
 * Warsaw has złoty on their statement, so the rate is a table.
 *
 * Two sources sit in the same column on purpose. A fetched rate and a typed one
 * are the same fact to whoever is reading the screen; what differs is whether it
 * will change on its own, and that is what the marker in the last column says.
 * Typing over a rate is an edit, and clearing it back to the fetched value is
 * the row's delete — armed rather than modal, because nothing but that one row
 * is affected and it can be retyped in a second.
 *
 * Currency *names* are not translated here. `Intl.DisplayNames` knows all of
 * them in all fourteen languages; a hand-kept table would be 45 × 14 strings
 * that the platform gets more right than we would.
 */
export default function CurrencyCard({ hidden, onToast }) {
  const { t } = useT();
  const { settings, save } = useSettings();
  const [table, setTable] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.getCurrencyRates().then(setTable).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const currency = settings?.currency || {};
  const base = currency.base || PIVOT;

  const write = async (code, rate) => {
    try {
      setTable(await api.setCurrencyRate(code, rate));
      // The provider holds the copy every screen formats with, so it has to hear
      // about a rate change too — otherwise the table says one thing and every
      // amount on the dashboard says another until the next reload.
      await save({ currency: { ...currency, manual: rateMapAfter(currency.manual, code, rate) } });
    } catch (e) {
      onToast?.(errText(e));
    }
  };

  const editor = useRowEditor({
    onSave: (code, draft) => write(code, Number(String(draft.rate).replace(',', '.')) || null),
    onDelete: (code) => write(code, null),
  });

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await api.refreshCurrencyRates(true);
      await load();
      onToast?.(result.fetched ? t('settings.currency.refreshed', { count: result.count }) : t('settings.currency.refreshFailed'));
    } catch (e) {
      onToast?.(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = ratesToRows(table, base);

  return (
    <div className="card" hidden={hidden} style={{ maxWidth: 760 }}>
      <h3>{t('settings.currency.title')}</h3>
      <p className="hint">{t('settings.currency.help')}</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {t('settings.currency.showEverythingIn')}
          <select value={base} onChange={(e) => save({ currency: { ...currency, base: e.target.value } })}>
            {(table?.currencies || [PIVOT]).map((code) => (
              <option key={code} value={code}>
                {code} — {currencyName(code)}
              </option>
            ))}
          </select>
        </label>

        <Switch
          checked={!!currency.autoRate}
          onChange={(autoRate) => save({ currency: { ...currency, autoRate } })}
          label={t('settings.currency.autoRate')}
        />

        <IconButton
          icon="refresh"
          label={busy ? t('settings.currency.refreshing') : t('settings.currency.refreshNow')}
          disabled={busy}
          onClick={refresh}
        />

        {table?.at && <StatusDot ok={!table.stale} label={rateAgeLabel(t, table)} />}
      </div>

      {/* A base with no rate is not a small problem: amounts stay in the currency
          they were stored in, so the number on screen is right and the label the
          reader picked is not the one they get. Said out loud rather than left
          for them to notice. */}
      {baseIsUnrated() && (
        <p className="hint" style={{ color: 'var(--warn)', marginTop: 8 }}>
          {t('settings.currency.baseNoRate', { base })}
        </p>
      )}

      {rows.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <caption className="sr-only">{t('settings.currency.tableCaption', { base })}</caption>
          <thead>
            <tr>
              <th>{t('settings.currency.currency')}</th>
              <th style={{ textAlign: 'right' }}>{t('settings.currency.rate', { base: PIVOT })}</th>
              <th>{t('settings.currency.source')}</th>
              <th aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const editing = editor.isEditing(row.code);
              return (
                <tr key={row.code} className={editing ? 'is-editing' : undefined}>
                  <td>
                    <strong>{row.code}</strong> <span className="muted">{currencyName(row.code)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableField
                      editing={editing}
                      value={editing ? editor.draft?.rate : row.rate}
                      as="number"
                      align="right"
                      autoFocus
                      onChange={(rate) => editor.patch({ rate })}
                      onStartEdit={() => editor.start({ id: row.code }, { rate: String(row.rate) })}
                      onCommit={editor.commit}
                      onCancel={editor.cancel}
                      render={(v) => (Number(v) ? nf({ maximumFractionDigits: 6 }).format(Number(v)) : '—')}
                    />
                  </td>
                  <td>
                    {/* A row with no rate has not been fetched — saying so beats
                        showing a 0 next to the word "fetched", which is two
                        untruths in one line. */}
                    <span className="muted">
                      {row.manual
                        ? t('settings.currency.typed')
                        : row.rate
                          ? t('settings.currency.fetched')
                          : t('settings.currency.noRate')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <RowActions
                      editing={editing}
                      deleting={editor.isDeleting(row.code)}
                      busy={editor.busy}
                      canDelete={row.manual}
                      editLabel={t('settings.currency.editRate')}
                      deleteLabel={t('settings.currency.clearRate')}
                      confirmDeleteLabel={t('settings.currency.clearRateConfirm')}
                      deleteBlockedReason={t('settings.currency.nothingToClear')}
                      onEdit={() => editor.start({ id: row.code }, { rate: String(row.rate) })}
                      onSave={editor.commit}
                      onCancel={editor.cancel}
                      onAskDelete={() => editor.askDelete(row.code)}
                      onConfirmDelete={() => editor.confirmDelete(row.code)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The rows worth showing: everything with a rate, plus the display currency, so
    picking a currency the ledger has never held still shows you its rate. */
function ratesToRows(table, base) {
  if (!table) return [];
  const codes = new Set(Object.keys(table.rates || {}));
  if (base !== PIVOT) codes.add(base);
  return [...codes]
    .sort()
    .map((code) => ({
      code,
      rate: table.rates[code] ?? 0,
      manual: table.manual?.[code] != null,
    }));
}

function rateMapAfter(manual, code, rate) {
  const next = { ...(manual || {}) };
  if (rate == null) delete next[code];
  else next[code] = rate;
  return next;
}

function rateAgeLabel(t, table) {
  if (!table.at) return t('settings.currency.neverFetched');
  return table.stale
    ? t('settings.currency.fetchedStale', { when: formatDateTime(table.at) })
    : t('settings.currency.fetchedAt', { when: formatDateTime(table.at) });
}
