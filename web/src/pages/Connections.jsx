import { useState, useEffect, useRef } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import Icon from '../components/Icon.jsx';

/**
 * Most ActivoBank mail is not a statement — repeated template notices,
 * contracts, marketing — so the summary separates "nothing to read here" from
 * an actual failure instead of reporting both as errors.
 */
function describeIngest(result) {
  const parts = [
    `${result.new ?? 0} new transactions from ${result.parsed ?? result.documents ?? 0} statement/advice document(s)`,
  ];
  if (result.duplicates) parts.push(`${result.duplicates} already recorded`);
  if (result.skippedDocuments) parts.push(`${result.skippedDocuments} repeated document(s)`);
  if (result.nonTransactional) parts.push(`${result.nonTransactional} non-transactional`);
  if (result.errors?.length) parts.push(`${result.errors.length} error(s)`);
  return parts.join(', ');
}

function StatusDot({ ok, label }) {
  const { t, tx } = useT();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ok ? 'var(--accent-green)' : 'var(--text-muted)',
        }}
      />
      {label}
    </span>
  );
}

function GcpInstructions() {
  const { t, tx } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {t('connections.howToCredentials')}
      </button>
      {open && (
        <ol style={{ margin: '8px 0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>console.cloud.google.com</a>{t('connections.step1')}</li>
          {/* The console's own menu path stays in English — it is what is written
              on the screen the reader is looking at, and translating it would send
              them hunting for a menu item that does not exist. */}
          <li>{tx('connections.step2', { api: <strong>Gmail API</strong> })}</li>
          <li>{t('connections.stepConsent')}</li>
          <li>{tx('connections.step4', { client: <strong>OAuth client ID</strong>, app: <strong>Desktop app</strong> })}</li>
          <li>{t('connections.step3')}</li>
        </ol>
      )}
    </div>
  );
}

function ActivobankCard() {
  const { t, tx } = useT();
  const [status, setStatus] = useState({ hasCredentials: false, connected: false, lastSyncAt: null });
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const loadStatus = () => api.getGoogleStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    loadStatus();
  }, []);

  const saveCredentials = async () => {
    try {
      await api.saveGoogleCredentials({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setMessage('Credentials saved. Now connect your Google account.');
      setClientId('');
      setClientSecret('');
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    }
  };

  const connectGoogle = async () => {
    try {
      const { url } = await api.getGoogleAuthUrl();
      window.open(url, '_blank');
      setMessage('Complete the Google login in the new tab, then click "Check status".');
    } catch (err) {
      setMessage(errText(err));
    }
  };

  const scanNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.ingestActivobank();
      setMessage(`Scan complete: ${describeIngest(result)}`);
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  // Gmail hands over each message once, so a parser improvement only reaches
  // the existing mailbox through the documents already saved on disk.
  const reprocessStored = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.reprocessActivobank();
      setMessage(`Re-parsed ${result.filesFound} stored document(s): ${describeIngest(result)}`);
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.uploadActivobankDocuments(files);
      setMessage(`Upload processed: ${describeIngest(result)}`);
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="accounts" size={16} />{t('connections.activobank')}</h3>
        <div style={{ display: 'flex', gap: 14 }}>
          <StatusDot ok={status.hasCredentials} label={t('connections.credentials')} />
          <StatusDot ok={status.connected} label={t('connections.googleConnected')} />
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 12px' }}>
        Scans every ActivoBank email and attachment in your Gmail and builds the transaction
        history. You can also upload statements (PDF/CSV) manually below.
        {status.lastSyncAt && ` Última sincronização: ${formatDateTime(status.lastSyncAt)}`}
      </p>

      {!status.connected && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              placeholder={t('connections.clientId')}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <input
              placeholder={t('connections.clientSecret')}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            <button className="btn-primary" onClick={saveCredentials} disabled={!clientId || !clientSecret}>{t('connections.saveCredentials')}</button>
          </div>
          <GcpInstructions />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status.hasCredentials && !status.connected && (
          <button className="btn-primary" onClick={connectGoogle}>{t('connections.connectGoogle')}</button>
        )}
        <button className="btn-ghost" onClick={loadStatus}>{t('connections.checkStatus')}</button>
        {status.connected && (
          <button className="btn-primary" onClick={scanNow} disabled={busy}>
            {busy ? 'Scanning…' : 'Scan email now'}
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={reprocessStored}
          disabled={busy}
          title={t('connections.reprocessHelp')}
        >
          {busy ? 'Working…' : 'Re-parse stored documents'}
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFiles([...e.dataTransfer.files]);
        }}
        onClick={() => fileInput.current?.click()}
        style={{
          marginTop: 14,
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          padding: '22px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        {busy ? 'Processing…' : 'Drop ActivoBank statements here (PDF / CSV) or click to browse'}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.csv,.tsv,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            uploadFiles([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>

      {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
    </div>
  );
}

function PricempireCard() {
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

export default function Connections() {
  const { t } = useT();
  return (
    <div>
      <div className="page-header">
        <h2>{t('nav.connections')}</h2>
      </div>
      <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
        <ActivobankCard />
        <PricempireCard />
      </div>
    </div>
  );
}
