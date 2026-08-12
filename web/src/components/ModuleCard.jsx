/**
 * A connection card drawn from what a module declares, for modules that ship no
 * component of their own.
 *
 * This is the path a new module should take. Its author writes a `configSchema`
 * and a list of capabilities in `module.js` and gets a card that already obeys
 * every rule this codebase has: colours from the theme tokens rather than
 * literals, dates through `format.js`, icons from `Icon.jsx` rather than emoji,
 * status shown as a word as well as a dot, and every string a translation key.
 * None of that is knowledge a module author should have to acquire in order to
 * add a bank.
 *
 * A module that needs something this cannot express ships `modules/<id>/ui.jsx`
 * instead — ActivoBank's OAuth flow and Pricempire's portfolio picker both do.
 */
import { useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n/index.js';
import { errText } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import Icon from './Icon.jsx';
import StatusDot from './ui/StatusDot.jsx';

/** The buttons a capability earns, in the order they are useful. */
const ACTION_LABELS = {
  connect: 'modules.action.connect',
  sync: 'modules.action.sync',
  reprocess: 'modules.action.reprocess',
};
const ACTION_ORDER = ['connect', 'sync', 'reprocess'];

async function call(path, options = {}) {
  const response = await fetch(`/api/modules/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options.body ?? {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || String(response.status));
  return body;
}

export default function ModuleCard({ instance, manifest }) {
  const { t } = useT();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const capabilities = manifest?.capabilities ?? [];

  const loadStatus = useCallback(() => {
    if (!capabilities.includes('status')) return;
    fetch(`/api/modules/${instance.id}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, [instance.id, capabilities]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const run = async (capability) => {
    setBusy(capability);
    setMessage(null);
    try {
      const result = await call(`${instance.id}/${capability}`);
      // A module decides its own result shape, so the summary reports the two
      // counts nearly all of them have and says nothing it cannot stand behind.
      setMessage(
        t('modules.ranSummary', {
          imported: result.new ?? 0,
          files: result.documents ?? result.parsed ?? 0,
        })
      );
      loadStatus();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  };

  // `connected` is the one status field the framework understands; everything
  // else a module reports is its own business and is left alone.
  const connected = status?.connected ?? status?.sessionOk ?? null;
  const lastSync = status?.lastSyncAt ?? status?.lastSync ?? null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name={manifest?.icon ?? 'connections'} size={16} />
          {t(instance.label ?? manifest?.label ?? instance.id)}
        </h3>
        {connected !== null && (
          <StatusDot
            ok={connected}
            label={connected ? t('modules.connected') : t('modules.notConnected')}
          />
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 12px' }}>
        {t('modules.instanceOf', { module: instance.module })}
        {lastSync && ` · ${t('modules.lastSync', { when: formatDateTime(lastSync) })}`}
      </p>

      {instance.missing && (
        // Its data is still in the ledger under this source. Saying so is the
        // difference between "my bank disappeared" and a five-second fix.
        <p style={{ color: 'var(--bad)', fontSize: 13 }}>
          {t('modules.missingModule', { module: instance.module })}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ACTION_ORDER.filter((c) => capabilities.includes(c)).map((capability) => (
          <button
            key={capability}
            className={capability === 'sync' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => run(capability)}
            disabled={busy !== null || instance.missing}
          >
            {busy === capability ? t('common.loading') : t(ACTION_LABELS[capability])}
          </button>
        ))}
        {capabilities.includes('status') && (
          <button className="btn-ghost" onClick={loadStatus}>
            {t('connections.checkStatus')}
          </button>
        )}
      </div>

      {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
    </div>
  );
}
