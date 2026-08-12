import { useState, useEffect } from 'react';
import { api, errText } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import Switch from '../components/ui/Switch.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import Icon from '../components/Icon.jsx';
import { refreshLlmStatus } from '../lib/useLlmStatus.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { useT } from '../i18n/index.js';
import { fetchModules } from '../modules/registry.js';
import AppearancePanel from './settings/AppearancePanel.jsx';
import AccessibilityPanel from './settings/AccessibilityPanel.jsx';

/*
 * Three tabs, because the page had grown four unrelated cards in a single
 * column and the two new subjects — how the app looks, and how it behaves for
 * a reader who cannot use colour — are not more scheduling options.
 *
 * The tab is remembered per sitting, not per machine: it is a place in a page,
 * like a scroll position, and `usePersistentState` is sessionStorage for
 * exactly that reason. Which theme you chose is a real preference and lives in
 * settings.json instead.
 */
const TABS = [
  { id: 'general', label: (t) => t('settings.tab.general'), icon: 'settings' },
  { id: 'appearance', label: (t) => t('settings.tab.appearance'), icon: 'palette' },
  { id: 'accessibility', label: (t) => t('settings.tab.accessibility'), icon: 'eye' },
];

const PRESETS = [
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'every6h', label: 'Every 6 hours', cron: '0 */6 * * *' },
  { id: 'daily', label: 'Daily (08:00)', cron: '0 8 * * *' },
  { id: 'weekly', label: 'Weekly (Mon 08:00)', cron: '0 8 * * 1' },
  { id: 'custom', label: 'Custom cron…', cron: null },
];

/**
 * What each schedulable thing is called, from the manifest that declares it.
 *
 * This was a hardcoded object naming five providers, in English, which meant a
 * fork's own bank appeared in the schedules table as a bare id and the whole
 * table stayed English whatever the language was set to. A module's `label` is
 * a translation key, so both problems have the same fix.
 */
function useModuleLabels() {
  const { t } = useT();
  const [labels, setLabels] = useState({});
  useEffect(() => {
    fetchModules().then(({ modules }) => {
      setLabels(Object.fromEntries(modules.map((m) => [m.id, m.label])));
    });
  }, []);
  return (id) => (labels[id] ? t(labels[id]) : id);
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [toast, setToast] = useState(null);
  const [busyModule, setBusyModule] = useState(null);
  const [rate, setRate] = useState(null);
  const [tab, setTab] = usePersistentState('settings.tab', 'general');
  const { t, tx } = useT();
  const moduleLabel = useModuleLabels();

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
      showToast(errText(e));
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
      showToast(`${moduleLabel(module)}: ${JSON.stringify(result)}`);
    } catch (e) {
      showToast(errText(e));
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
      showToast(errText(e));
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
      showToast(errText(e));
    }
  };

  if (!settings) return <div className="empty-state"><p>{t('common.loading')}</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>{t('settings.title')}</h2>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`tab${tab === entry.id ? ' is-on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            <Icon name={entry.icon} size={15} />
            {entry.label(t)}
          </button>
        ))}
      </div>

      {tab === 'appearance' && <AppearancePanel />}
      {tab === 'accessibility' && <AccessibilityPanel />}

      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="refresh" size={16} />{t('settings.schedules.title')}</h3>
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
                  label={moduleLabel(module)}
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
                    <Icon name="play" size={12} />{t('settings.schedules.runNow')}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="brain" size={16} />{t('settings.llm.title')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          When enabled, your local Ollama model gives a second opinion in the rule advisor and
          suggests categories for what nothing else recognises. Nothing here is required — every
          AI-gated button on the site is greyed out with an explanation until this is on and a
          model is chosen, and everything else keeps working exactly the same without it.
        </p>
        <ol style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{t('settings.llm.step1')}<span style={{ fontFamily: 'monospace' }}>ollama.com</span> and
            leave it running — it listens on your machine, nothing leaves it.
          </li>
          <li>
            Pull a model in a terminal, e.g.{' '}
            <span style={{ fontFamily: 'monospace' }}>ollama pull llama3.2</span>.
          </li>
          <li>{t('settings.llm.step3')}</li>
          <li>{t('settings.llm.step4')}</li>
        </ol>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Switch
            checked={!!settings.llm.enabled}
            onChange={(enabled) => save({ ...settings, llm: { ...settings.llm, enabled } })}
            label={t('settings.llm.enable')}
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
            <option value="">{t('settings.llm.selectModel')}</option>
            {[settings.llm.model, ...models]
              .filter((m, i, arr) => m && arr.indexOf(m) === i)
              .map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
          </select>
          <button className="btn-ghost btn-sm" disabled={!settings.llm.enabled} onClick={loadModels}>{t('settings.llm.test')}</button>
        </div>
      </div>

      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chartLine" size={16} />{t('settings.quotes.title')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          {tx('settings.quotes.help', { only: <strong>{t('settings.quotes.helpOnly')}</strong> })}
        </p>
        <Switch
          checked={!!settings.quotes?.enabled}
          onChange={(enabled) => save({ ...settings, quotes: { ...settings.quotes, enabled } })}
          label={t('settings.quotes.enable')}
        />
      </div>

      {/*
        One currency on screen, always. The CS2 side of the ledger is quoted in
        dollars and the bank side in euros, and rendering both at once turned
        every table into a conversion exercise.
      */}
      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3>{t('settings.currency.title')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          Os valores são guardados na moeda em que o mercado os cotou, para continuarem a bater
          certo com o Pricempire e a Steam. Isto é só a moeda em que aparecem no ecrã.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{t('settings.currency.showEverythingIn')}<select
              value={settings.currency?.base || 'EUR'}
              onChange={(e) =>
                save({ ...settings, currency: { ...settings.currency, base: e.target.value } })
              }
            >
              <option value="EUR">euros</option>
              <option value="USD">{t('settings.currency.dollars')}</option>
            </select>
          </label>

          <Switch
            checked={!!settings.currency?.autoRate}
            onChange={(autoRate) => save({ ...settings, currency: { ...settings.currency, autoRate } })}
            label={t('settings.currency.autoRate')}
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
