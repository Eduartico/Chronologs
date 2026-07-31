import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const PRESETS = [
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'every6h', label: 'Every 6 hours', cron: '0 */6 * * *' },
  { id: 'daily', label: 'Daily (08:00)', cron: '0 8 * * *' },
  { id: 'weekly', label: 'Weekly (Mon 08:00)', cron: '0 8 * * 1' },
  { id: 'custom', label: 'Custom cron…', cron: null },
];

const MODULE_LABELS = {
  activobank: 'ActivoBank email scan',
  pricempire: 'Pricempire portfolio refresh',
  correlations: 'Correlation detection',
  rules: 'Rules engine sweep',
};

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [toast, setToast] = useState(null);
  const [busyModule, setBusyModule] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const save = async (next) => {
    setSettings(next);
    try {
      await api.saveSettings(next);
      showToast('Settings saved — scheduler reloaded');
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  };

  const setSchedule = (module, patch) => {
    const next = {
      ...settings,
      schedules: { ...settings.schedules, [module]: { ...settings.schedules[module], ...patch } },
    };
    save(next);
  };

  const runNow = async (module) => {
    setBusyModule(module);
    try {
      const result = await api.runScheduledModule(module);
      showToast(`${MODULE_LABELS[module]}: ${JSON.stringify(result)}`);
    } catch (e) {
      showToast('Error: ' + e.message);
    } finally {
      setBusyModule(null);
    }
  };

  const loadModels = async () => {
    try {
      const { models } = await api.getLlmModels();
      setModels(models);
      showToast(`Ollama reachable — ${models.length} model(s) found`);
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  };

  if (!settings) return <div className="empty-state"><p>Loading…</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h3>⏱ Automatic refresh</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          Each module refreshes on its own schedule while the server is running — e.g. ActivoBank
          weekly, Pricempire several times a day. Optionally you can drive these endpoints from
          n8n instead (see README) — in that case disable the internal schedule here.
        </p>
        {Object.entries(settings.schedules).map(([module, cfg]) => {
          const preset = PRESETS.find((p) => p.cron === cfg.cron)?.id || 'custom';
          return (
            <div
              key={module}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 240, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!cfg.enabled}
                  onChange={(e) => setSchedule(module, { enabled: e.target.checked })}
                />
                {MODULE_LABELS[module] || module}
              </label>
              <select
                value={preset}
                disabled={!cfg.enabled}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.id === e.target.value);
                  setSchedule(module, { preset: p.id, ...(p.cron ? { cron: p.cron } : {}) });
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {preset === 'custom' && (
                <input
                  value={cfg.cron}
                  disabled={!cfg.enabled}
                  style={{ width: 120, fontFamily: 'monospace' }}
                  onChange={(e) => setSchedule(module, { cron: e.target.value })}
                  placeholder="* * * * *"
                />
              )}
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>{cfg.cron}</span>
              <button
                className="btn-ghost btn-sm"
                style={{ marginLeft: 'auto' }}
                disabled={busyModule === module}
                onClick={() => runNow(module)}
              >
                {busyModule === module ? 'Running…' : '▶ Run now'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
        <h3>🤖 Local AI (Ollama) — optional</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          When enabled, your local Ollama model suggests categorization rules from your real
          transactions (quality over quantity). Everything works without it.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!settings.llm.enabled}
              onChange={(e) => save({ ...settings, llm: { ...settings.llm, enabled: e.target.checked } })}
            />
            Enable
          </label>
          <input
            value={settings.llm.baseUrl}
            disabled={!settings.llm.enabled}
            style={{ width: 220 }}
            onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })}
            onBlur={() => save(settings)}
          />
          <select
            value={settings.llm.model}
            disabled={!settings.llm.enabled}
            onChange={(e) => save({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
          >
            <option value="">select model…</option>
            {[settings.llm.model, ...models]
              .filter((m, i, arr) => m && arr.indexOf(m) === i)
              .map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
          </select>
          <button className="btn-ghost btn-sm" disabled={!settings.llm.enabled} onClick={loadModels}>
            Test connection
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
