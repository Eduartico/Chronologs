/**
 * The Pricempire connection card.
 *
 * Its own component rather than a `ModuleCard` description, because choosing
 * which portfolios to import is a modal with a cached list, a refresh that
 * drives a real browser, and a checkbox per portfolio — none of which a generic
 * card could render without inventing a whole modal vocabulary for one module.
 *
 * Moved here verbatim from `web/src/pages/Connections.jsx`.
 */
import { useState, useEffect } from 'react';
import { useT } from '../../web/src/i18n/index.js';
import { api, errText } from '../../web/src/lib/api.js';
import { formatDateTime } from '../../web/src/lib/format.js';
import Icon from '../../web/src/components/Icon.jsx';
import StatusDot from '../../web/src/components/ui/StatusDot.jsx';

export default function PricempireCard() {
  const { t, tx } = useT();
  const [status, setStatus] = useState({ sessionOk: false, selectedPortfolios: [], lastSync: null });
  const [portfolios, setPortfolios] = useState(null);
  const [portfoliosFetchedAt, setPortfoliosFetchedAt] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const loadStatus = () =>
    api
      .getPricempireStatus()
      .then((s) => {
        setStatus(s);
        setSelected(s.selectedPortfolios || []);
      })
      .catch(() => {});

  useEffect(() => {
    loadStatus();
  }, []);

  const connect = async () => {
    setBusy(true);
    setMessage('A browser window will open — log in to Pricempire there.');
    try {
      await api.connectPricempire();
      setMessage('Session established.');
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  // The cached list opens instantly; refreshing drives a real browser and takes
  // around ten seconds, so it is an explicit action rather than the default.
  const loadPortfolios = async (refresh = false) => {
    setBusy(true);
    setMessage(refresh ? 'A abrir o browser para actualizar a lista…' : null);
    try {
      const { portfolios: list, fetchedAt } = await api.getPricempirePortfolios(refresh);
      setPortfolios(list);
      setPortfoliosFetchedAt(fetchedAt);
      if (refresh) setMessage(null);
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSelection = async () => {
    try {
      await api.savePricempirePortfolios(selected);
      setPortfolios(null);
      setMessage(`Importing ${selected.length} portfolio(s) on each refresh.`);
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    }
  };

  /**
   * Resync downloads each selected portfolio's own CSV export and imports it,
   * which is the same data path as a manual upload. The old scraper only runs
   * if the export button cannot be found, and the server says so when it does.
   */
  const resyncNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.ingestPricempire();
      const parts = [
        t('connections.importedSummary', { imported: result.new ?? 0, rows: result.parsed ?? 0 }),
        result.duplicates ? `${result.duplicates} já registadas` : null,
        result.portfolios ? `${result.portfolios} portefólio(s)` : null,
        result.method === 'scrape-fallback' ? 'via scraper (export indisponível)' : null,
      ].filter(Boolean);
      setMessage(`Ressincronização concluída: ${parts.join(', ')}.`);
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="gaming" size={16} />{t('connections.pricempire')}</h3>
        <StatusDot ok={status.sessionOk} label={status.sessionOk ? 'Session active' : 'Not connected'} />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 12px' }}>
        Abre uma janela de browser real para entrares uma vez; a sessão fica guardada para as
        sincronizações seguintes. A ressincronização descarrega o CSV de <strong>Export</strong> de
        cada portefólio escolhido e importa-o.
        {status.lastSync && ` Última sincronização: ${formatDateTime(status.lastSync)}`}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={connect} disabled={busy}>
          {status.sessionOk ? 'Re-login' : 'Connect (opens browser)'}
        </button>
        {status.sessionOk && (
          <>
            <button className="btn-ghost" onClick={() => loadPortfolios(false)} disabled={busy}>
              Escolher portefólios{status.selectedPortfolios?.length ? ` (${status.selectedPortfolios.length} seleccionados)` : ''}
            </button>
            <button
              className="btn-primary"
              onClick={resyncNow}
              disabled={busy || !status.selectedPortfolios?.length}
              title={t('connections.exportHelp')}
            >
              {busy ? 'A trabalhar…' : 'Ressincronizar agora'}
            </button>
          </>
        )}
        <button className="btn-ghost" onClick={loadStatus}>{t('connections.checkStatus')}</button>
      </div>

      {portfolios && (
        <div className="modal-overlay" onClick={() => setPortfolios(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('connections.selectPortfolios')}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {portfoliosFetchedAt
                  ? `Lista em cache de ${formatDateTime(portfoliosFetchedAt)}`
                  : 'Ainda sem cache'}
              </span>
              <button
                className="btn-ghost btn-sm"
                onClick={() => loadPortfolios(true)}
                disabled={busy}
                title={t('connections.refreshListHelp')}
                style={{ marginLeft: 'auto' }}
              >
                {busy ? '⏳ …' : '↻ Actualizar lista'}
              </button>
            </div>
            {portfolios.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>{t('connections.noPortfolios')}</p>
            )}
            {portfolios.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
                {p.value != null && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>€{p.value}</span>}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setPortfolios(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={saveSelection}>{t('connections.saveSelection')}</button>
            </div>
          </div>
        </div>
      )}

      {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
    </div>
  );
}
