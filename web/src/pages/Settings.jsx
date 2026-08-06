import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import Switch from '../components/ui/Switch.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import Icon from '../components/Icon.jsx';
import { refreshLlmStatus } from '../lib/useLlmStatus.js';

const PRESETS = [
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'every6h', label: 'Every 6 hours', cron: '0 */6 * * *' },
  { id: 'daily', label: 'Daily (08:00)', cron: '0 8 * * *' },
  { id: 'weekly', label: 'Weekly (Mon 08:00)', cron: '0 8 * * 1' },
  { id: 'custom', label: 'Custom cron…', cron: null },
];

const MODULE_LABELS = {
  activobank: 'ActivoBank email scan',
  pricempire: 'Pricempire portfolio resync',
  correlations: 'Correlation detection',
  rules: 'Rules engine sweep',
  quotes: 'ETF market quotes',
};

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [toast, setToast] = useState(null);
  const [busyModule, setBusyModule] = useState(null);
  const [rate, setRate] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
    api.getCurrencyRate().then(setRate).catch(() => {});
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const save = async (next) => {
    setSettings(next);
    try {
      await api.saveSettings(next);
      // Every AI-gated button on the site reads a cached `/llm/status` — a
      // toggle flipped here would otherwise stay invisible to them until the
      // next full page load.
      refreshLlmStatus();
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

  const refreshRate = async () => {
    setBusyModule('rate');
    try {
      const r = await api.refreshCurrencyRate(true);
      setRate(r);
      setSettings((s) => ({ ...s, currency: { ...s.currency, usdToEur: r.usdToEur } }));
      showToast(
        r.fetched ? `Câmbio actualizado: 1 USD = ${r.usdToEur} EUR` : 'Não foi possível obter o câmbio'
      );
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
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="refresh" size={16} /> Automatic refresh
        </h3>
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
              <div style={{ width: 240 }}>
                <Switch
                  checked={!!cfg.enabled}
                  onChange={(enabled) => setSchedule(module, { enabled })}
                  label={MODULE_LABELS[module] || module}
                />
              </div>
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
                {busyModule === module ? (
                  'Running…'
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="play" size={12} /> Run now
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="brain" size={16} /> Local AI (Ollama) — optional
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          When enabled, your local Ollama model gives a second opinion in the rule advisor and
          suggests categories for what nothing else recognises. Nothing here is required — every
          AI-gated button on the site is greyed out with an explanation until this is on and a
          model is chosen, and everything else keeps working exactly the same without it.
        </p>
        <ol style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            Install Ollama from <span style={{ fontFamily: 'monospace' }}>ollama.com</span> and
            leave it running — it listens on your machine, nothing leaves it.
          </li>
          <li>
            Pull a model in a terminal, e.g.{' '}
            <span style={{ fontFamily: 'monospace' }}>ollama pull llama3.2</span>.
          </li>
          <li>Confirm the address below matches where it's listening (usually the default).</li>
          <li>Turn on "Enable", pick the model from the list, and press "Test connection".</li>
        </ol>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Switch
            checked={!!settings.llm.enabled}
            onChange={(enabled) => save({ ...settings, llm: { ...settings.llm, enabled } })}
            label="Enable"
          />
          <input
            value={settings.llm.baseUrl}
            disabled={!settings.llm.enabled}
            placeholder="http://localhost:11434"
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

      <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chartLine" size={16} /> Cotações de mercado — opcional
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          Os extractos do ActivoBank dizem quanto pagaste pelos ETFs, mas nunca quanto valem hoje.
          Com isto ligado, o Chronologs vai buscar a última cotação ao Yahoo Finance para os
          títulos registados — é a <strong>única</strong> funcionalidade que sai da tua máquina.
          Sem isto, as posições continuam a mostrar o custo real e podes actualizar o preço à mão.
        </p>
        <Switch
          checked={!!settings.quotes?.enabled}
          onChange={(enabled) => save({ ...settings, quotes: { ...settings.quotes, enabled } })}
          label="Permitir a busca de cotações online"
        />
      </div>

      {/*
        One currency on screen, always. The CS2 side of the ledger is quoted in
        dollars and the bank side in euros, and rendering both at once turned
        every table into a conversion exercise.
      */}
      <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
        <h3>Moeda</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          Os valores são guardados na moeda em que o mercado os cotou, para continuarem a bater
          certo com o Pricempire e a Steam. Isto é só a moeda em que aparecem no ecrã.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Mostrar tudo em
            <select
              value={settings.currency?.base || 'EUR'}
              onChange={(e) =>
                save({ ...settings, currency: { ...settings.currency, base: e.target.value } })
              }
            >
              <option value="EUR">euros</option>
              <option value="USD">dólares</option>
            </select>
          </label>

          <Switch
            checked={!!settings.currency?.autoRate}
            onChange={(autoRate) => save({ ...settings, currency: { ...settings.currency, autoRate } })}
            label="Buscar o câmbio automaticamente"
          />

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            1 USD =
            <input
              type="number"
              step="0.0001"
              value={settings.currency?.usdToEur ?? 0.92}
              disabled={!!settings.currency?.autoRate}
              onChange={(e) =>
                save({
                  ...settings,
                  currency: {
                    ...settings.currency,
                    usdToEur: parseFloat(e.target.value) || 0,
                    // Typing a rate makes it a manual one again.
                    rateFetchedAt: null,
                  },
                })
              }
              style={{ width: 100 }}
            />
            EUR
          </label>

          {settings.currency?.autoRate && (
            <IconButton
              icon="refresh"
              label={busyModule === 'rate' ? 'A obter câmbio…' : 'Actualizar câmbio agora'}
              disabled={busyModule === 'rate'}
              onClick={refreshRate}
            />
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
          {rate?.manual
            ? 'Taxa introduzida à mão.'
            : rate?.at
              ? `Taxa obtida em ${formatDateTime(rate.at)}${rate.stale ? ' — já tem mais de uma semana.' : '.'}`
              : 'Ainda não foi obtida nenhuma taxa automática.'}
        </p>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
