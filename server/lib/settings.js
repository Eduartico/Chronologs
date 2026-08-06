import { existsSync, readFileSync, writeFileSync } from 'fs';
import { statePath } from './paths.js';

const DEFAULT_SETTINGS = {
  version: 1,
  schedules: {
    activobank: { enabled: false, preset: 'weekly', cron: '0 8 * * 1' },
    pricempire: { enabled: false, preset: 'every6h', cron: '0 */6 * * *' },
    correlations: { enabled: false, preset: 'daily', cron: '30 8 * * *' },
    rules: { enabled: false, preset: 'daily', cron: '0 9 * * *' },
    quotes: { enabled: false, preset: 'daily', cron: '0 19 * * 1-5' },
  },
  llm: { enabled: false, baseUrl: 'http://localhost:11434', model: '' },
  // ETF market prices are the one thing the bank documents cannot supply, so
  // this is the single feature that reaches the internet — off by default, and
  // the positions screen still works at cost without it.
  quotes: { enabled: false, provider: 'yahoo' },
  // CS2 markets quote in USD while the bank side is EUR, and showing both at
  // once turned every screen into a currency puzzle. One currency is displayed
  // — the euro, since that is what the bank account is in — and the amounts are
  // still *stored* in whatever the market quoted, so they keep matching
  // Pricempire and Steam.
  //
  // The rate can be fetched from the same place as the ETF quotes, or typed in.
  // `usdToEur` is what gets used either way; `rateFetchedAt` says how old it is,
  // and is null when it was entered by hand.
  currency: { base: 'EUR', usdToEur: 0.92, autoRate: false, rateFetchedAt: null },
  // Moving money between the owner's own accounts is not spending. The bank
  // books both legs of such a move, so both have to be recognised.
  //
  //  - selfNames: names the bank uses for the owner when the *other* account is
  //    the counterparty. Read off the advice notes automatically; listed here
  //    only to add names the paperwork never spelled out.
  //  - vaultAliases: which real vault an unnamed savings pool belongs to. The
  //    bank started naming vaults partway through, so early deposits carry no
  //    name and only the owner knows where they went.
  //  - profile: how *this* bank spells "money left this account", "this is
  //    the savings product", "this was cash from an ATM" — five regular
  //    expressions, editable from Regras, so recognising internal transfers is
  //    not baked in as ActivoBank's own wording. `null` means "use the
  //    ActivoBank default" (`DEFAULT_PROFILE` in engines/accounts.js); nothing
  //    here duplicates that default, which is the one place it is allowed to
  //    live.
  internal: { selfNames: [], vaultAliases: {}, windowDays: 3, profile: null },
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
    quotes: { ...DEFAULT_SETTINGS.quotes, ...(stored.quotes || {}) },
    currency: { ...DEFAULT_SETTINGS.currency, ...(stored.currency || {}) },
    internal: { ...DEFAULT_SETTINGS.internal, ...(stored.internal || {}) },
  };
}

export function saveSettings(settings) {
  const merged = { ...loadSettings(), ...settings };
  writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
