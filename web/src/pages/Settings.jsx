import { useState, useEffect } from 'react';
import { api, errText } from '../lib/api.js';
import Switch from '../components/ui/Switch.jsx';
import Icon from '../components/Icon.jsx';
import { refreshLlmStatus } from '../lib/useLlmStatus.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { useT } from '../i18n/index.js';
import { fetchModules } from '../modules/registry.js';
import { useSettings } from '../state/SettingsProvider.jsx';
import AppearancePanel from './settings/AppearancePanel.jsx';
import AccessibilityPanel from './settings/AccessibilityPanel.jsx';
import CurrencyCard from './settings/CurrencyCard.jsx';

/*
 * Four tabs, because the page had grown four unrelated cards in a single
 * column and the newer subjects — how the app looks, how it behaves for a
 * reader who cannot use colour, and which unfinished things are switched on —
 * are not more scheduling options.
 *
 * The tab is remembered per sitting, not per machine: it is a place in a page,
 * like a scroll position, and `usePersistentState` is sessionStorage for
 * exactly that reason. Which theme you chose is a real preference and lives in
 * settings.json instead.
 *
 * This page reads settings from `SettingsProvider` rather than fetching its
 * own copy. It used to hold a second one and PUT that whole snapshot on any
 * change here, so picking a theme in Appearance and then flipping a schedule in
 * General wrote the stale appearance back and reverted the theme. One owner of
 * `/settings` is the fix; there is no version of two that stays in step.
 */
const TABS = [
  { id: 'general', label: (t) => t('settings.tab.general'), icon: 'settings' },
  { id: 'appearance', label: (t) => t('settings.tab.appearance'), icon: 'palette' },
  { id: 'accessibility', label: (t) => t('settings.tab.accessibility'), icon: 'eye' },
];

/* `labelKey` rather than `label`: a preset name is user-visible copy, and
   `t()` cannot be called at module scope — see web/src/lib/i18nScope.test.js. */
const PRESETS = [
  { id: 'hourly', labelKey: 'settings.schedules.preset.hourly', cron: '0 * * * *' },
  { id: 'every6h', labelKey: 'settings.schedules.preset.every6h', cron: '0 */6 * * *' },
  { id: 'daily', labelKey: 'settings.schedules.preset.daily', cron: '0 8 * * *' },
  { id: 'weekly', labelKey: 'settings.schedules.preset.weekly', cron: '0 8 * * 1' },
  { id: 'custom', labelKey: 'settings.schedules.preset.custom', cron: null },
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
  const { settings, save: persist } = useSettings();
  const [models, setModels] = useState([]);
  const [toast, setToast] = useState(null);
  const [busyModule, setBusyModule] = useState(null);
  const [tab, setTab] = usePersistentState('settings.tab', 'general');
  const { t, tx } = useT();
  const moduleLabel = useModuleLabels();
  // The one field that is typed rather than picked, so it needs somewhere to
  // live between keystrokes. Everything else on this page commits immediately.
  const [baseUrl, setBaseUrl] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const save = async (next) => {
    try {
      await persist(next);
      // Every AI-gated button on the site reads a cached `/llm/status` — a
      // toggle flipped here would otherwise stay invisible to them until the
      // next full page load.
      refreshLlmStatus();
      showToast(t('settings.saved'));
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

  const loadModels = async () => {
    try {
      const { models } = await api.getLlmModels();
      setModels(models);
      showToast(t('settings.llm.reachable', { count: models.length }));
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
          {t('settings.schedules.help')}
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
                  <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
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
                  t('settings.schedules.running')
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
          {t('settings.llm.help')}
        </p>
        <ol style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{tx('settings.llm.step1', { site: <span style={{ fontFamily: 'monospace' }}>ollama.com</span> })}</li>
          <li>{tx('settings.llm.step2', { command: <span style={{ fontFamily: 'monospace' }}>ollama pull llama3.2</span> })}</li>
          <li>{t('settings.llm.step3')}</li>
          <li>{t('settings.llm.step4')}</li>
        </ol>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Switch
            checked={!!settings.llm.enabled}
            onChange={(enabled) => save({ llm: { ...settings.llm, enabled } })}
            label={t('settings.llm.enable')}
          />
          <input
            value={baseUrl ?? settings.llm.baseUrl}
            disabled={!settings.llm.enabled}
            placeholder="http://localhost:11434"
            style={{ width: 220 }}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => {
              if (baseUrl === null || baseUrl === settings.llm.baseUrl) return setBaseUrl(null);
              save({ llm: { ...settings.llm, baseUrl } }).finally(() => setBaseUrl(null));
            }}
          />
          <select
            value={settings.llm.model}
            disabled={!settings.llm.enabled}
            onChange={(e) => save({ llm: { ...settings.llm, model: e.target.value } })}
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
          onChange={(enabled) => save({ quotes: { ...settings.quotes, enabled } })}
          label={t('settings.quotes.enable')}
        />
      </div>

      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="travel" size={16} />{t('nav.travel')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          {t('settings.travelOverlayHelp')}
        </p>
        <Switch
          checked={settings.analytics?.travelOverlay !== false}
          onChange={(travelOverlay) => save({ analytics: { ...settings.analytics, travelOverlay } })}
          label={t('settings.travelOverlay')}
        />
      </div>

      {/* The two guesses behind the financial-independence card. Plain number
          fields: they are ordinary form inputs, not inline editors. */}
      <div className="card" hidden={tab !== 'general'} style={{ maxWidth: 760 }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="flag" size={16} />{t('settings.planning.title')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 12px' }}>
          {t('settings.planning.help')}
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {['withdrawalRate', 'realReturn'].map((key) => (
            <label key={key} className="form-group" style={{ minWidth: 220 }}>
              <span>{t(`settings.planning.${key}`)}</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="20"
                defaultValue={settings.planning?.[key] ?? (key === 'withdrawalRate' ? 4 : 5)}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value) || value < 0 || value > 20) return;
                  if (value === settings.planning?.[key]) return;
                  save({ planning: { ...settings.planning, [key]: value } });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <CurrencyCard hidden={tab !== 'general'} onToast={showToast} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
