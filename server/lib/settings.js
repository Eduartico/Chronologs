import { existsSync, readFileSync, writeFileSync } from 'fs';
import { statePath } from './paths.js';

const DEFAULT_SETTINGS = {
  version: 1,
  schedules: {
    activobank: { enabled: false, preset: 'weekly', cron: '0 8 * * 1' },
    pricempire: { enabled: false, preset: 'every6h', cron: '0 */6 * * *' },
    correlations: { enabled: false, preset: 'daily', cron: '30 8 * * *' },
    rules: { enabled: false, preset: 'daily', cron: '0 9 * * *' },
  },
  llm: { enabled: false, baseUrl: 'http://localhost:11434', model: '' },
  // CS2 markets quote in USD while the bank side is EUR. The rate is entered by
  // hand rather than fetched, to keep the app free of network dependencies.
  currency: { display: 'both', usdToEur: 0.92 },
};

function file() {
  return statePath('settings.json');
}

export function loadSettings() {
  if (!existsSync(file())) return structuredClone(DEFAULT_SETTINGS);
  const stored = JSON.parse(readFileSync(file(), 'utf-8'));
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...stored,
    schedules: { ...structuredClone(DEFAULT_SETTINGS.schedules), ...(stored.schedules || {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored.llm || {}) },
    currency: { ...DEFAULT_SETTINGS.currency, ...(stored.currency || {}) },
  };
}

export function saveSettings(settings) {
  const merged = { ...loadSettings(), ...settings };
  writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
