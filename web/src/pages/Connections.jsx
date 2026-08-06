import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
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
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} How to get Google credentials
      </button>
      {open && (
        <ol style={{ margin: '8px 0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>console.cloud.google.com</a> and create a project (any name).</li>
          <li>APIs &amp; Services → Library → enable <strong>Gmail API</strong>.</li>
          <li>APIs &amp; Services → OAuth consent screen → External → add your own email as a test user.</li>
          <li>APIs &amp; Services → Credentials → Create credentials → <strong>OAuth client ID</strong> → Application type: <strong>Desktop app</strong>.</li>
          <li>Copy the Client ID and Client Secret into the fields above.</li>
        </ol>
      )}
    </div>
  );
}

function ActivobankCard() {
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
      setMessage('Error: ' + err.message);
    }
  };

  const connectGoogle = async () => {
    try {
      const { url } = await api.getGoogleAuthUrl();
      window.open(url, '_blank');
      setMessage('Complete the Google login in the new tab, then click "Check status".');
    } catch (err) {
      setMessage('Error: ' + err.message);
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
      setMessage('Error: ' + err.message);
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
      setMessage('Error: ' + err.message);
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
      setMessage('Error: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="accounts" size={16} /> ActivoBank (via Gmail)
        </h3>
        <div style={{ display: 'flex', gap: 14 }}>
          <StatusDot ok={status.hasCredentials} label="Credentials" />
          <StatusDot ok={status.connected} label="Google connected" />
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
              placeholder="Google Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <input
              placeholder="Client Secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            <button className="btn-primary" onClick={saveCredentials} disabled={!clientId || !clientSecret}>
              Save credentials
            </button>
          </div>
          <GcpInstructions />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status.hasCredentials && !status.connected && (
          <button className="btn-primary" onClick={connectGoogle}>Connect Google account</button>
        )}
        <button className="btn-ghost" onClick={loadStatus}>Check status</button>
        {status.connected && (
          <button className="btn-primary" onClick={scanNow} disabled={busy}>
            {busy ? 'Scanning…' : 'Scan email now'}
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={reprocessStored}
          disabled={busy}
          title="Re-read every document already downloaded, without fetching from Gmail"
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
      setMessage('Error: ' + err.message);
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
      setMessage('Error: ' + err.message);
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
      setMessage('Error: ' + err.message);
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
        `${result.new ?? 0} transacções novas de ${result.parsed ?? 0} linhas`,
        result.duplicates ? `${result.duplicates} já registadas` : null,
        result.portfolios ? `${result.portfolios} portefólio(s)` : null,
        result.method === 'scrape-fallback' ? 'via scraper (export indisponível)' : null,
      ].filter(Boolean);
      setMessage(`Ressincronização concluída: ${parts.join(', ')}.`);
      loadStatus();
    } catch (err) {
      setMessage('Erro: ' + err.message);
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
          <Icon name="gaming" size={16} /> Pricempire (CS2 skins)
        </h3>
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
              title="Abre o portefólio, descarrega o CSV de export e importa-o"
            >
              {busy ? 'A trabalhar…' : 'Ressincronizar agora'}
            </button>
          </>
        )}
        <button className="btn-ghost" onClick={loadStatus}>Check status</button>
      </div>

      {portfolios && (
        <div className="modal-overlay" onClick={() => setPortfolios(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select portfolios to import</h3>
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
                title="Opens the browser and re-reads the list from Pricempire (~10s)"
                style={{ marginLeft: 'auto' }}
              >
                {busy ? '⏳ …' : '↻ Actualizar lista'}
              </button>
            </div>
            {portfolios.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>
                Nenhum portefólio em cache — carrega em "Actualizar lista".
              </p>
            )}
            {portfolios.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
                {p.value != null && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>€{p.value}</span>}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setPortfolios(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveSelection}>Save selection</button>
            </div>
          </div>
        </div>
      )}

      {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
    </div>
  );
}

export default function Connections() {
  return (
    <div>
      <div className="page-header">
        <h2>Connections</h2>
      </div>
      <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
        <ActivobankCard />
        <PricempireCard />
      </div>
    </div>
  );
}
