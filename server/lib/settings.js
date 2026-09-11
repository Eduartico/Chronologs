import { existsSync, readFileSync, writeFileSync } from 'fs';
import { statePath } from './paths.js';
import { PIVOT } from '../../web/src/lib/currencies.js';

const DEFAULT_SETTINGS = {
  version: 1,
  /**
   * Schedules for the built-in engines. Source modules keep their schedule on
   * their own instance (see `modules` below) — a second bank needs its own
   * timing, not a share of one global entry keyed by module name.
   *
   * The two source entries stay here as well, because a settings.json written
   * before modules existed has them, and `migrateModules` reads them.
   */
  schedules: {
    activobank: { enabled: false, preset: 'weekly', cron: '0 8 * * 1' },
    pricempire: { enabled: false, preset: 'every6h', cron: '0 */6 * * *' },
    correlations: { enabled: false, preset: 'daily', cron: '30 8 * * *' },
    rules: { enabled: false, preset: 'daily', cron: '0 9 * * *' },
    quotes: { enabled: false, preset: 'daily', cron: '0 19 * * 1-5' },
    fx: { enabled: false, preset: 'daily', cron: '0 17 * * 1-5' },
  },
  /**
   * Configured instances of source modules, keyed by instance id.
   *
   * The key is the `source` string on every event that instance writes, so it
   * is permanent: renaming one orphans its history in an append-only ledger.
   * Two accounts at the same bank are two entries naming the same `module`.
   *
   * Empty by default. `migrateModules` below fills it in from the older
   * `schedules` and `internal` keys the first time a pre-modules settings.json
   * is read, so an existing installation gets exactly the configuration it
   * already had.
   */
  modules: {},
  llm: { enabled: false, baseUrl: 'http://localhost:11434', model: '' },
  // ETF market prices are the one thing the bank documents cannot supply, so
  // this is the single feature that reaches the internet — off by default, and
  // the positions screen still works at cost without it.
  quotes: { enabled: false, provider: 'yahoo' },
  // CS2 markets quote in USD while the bank side is EUR, and showing both at
  // once turned every screen into a currency puzzle. One currency is displayed
  // — the euro by default, since that is what the bank account is in — and the
  // amounts are still *stored* in whatever the market quoted, so they keep
  // matching Pricempire and Steam.
  //
  //  - base:   what everything is rendered in. Any code in web/src/lib/currencies.js.
  //  - rates:  euros per one unit, fetched. The euro is the pivot and is not in
  //            here: its rate against itself is 1, and storing that only invites
  //            someone to edit it.
  //  - manual: rates typed by hand. These win, and a refresh does not touch
  //            them — someone who typed a rate meant it.
  //  - usdToEur: the scalar this used to be, still written so that rolling the
  //            code back reads its own file. `loadSettings` migrates the other
  //            way for a file written before the table existed.
  currency: {
    base: PIVOT,
    // Empty on purpose. A default row here would be laid over a stored file by
    // the one-level merge below *before* `migrateCurrency` gets to look, so an
    // installation upgrading from the old scalar would silently keep the shipped
    // 0.92 instead of its own rate — every dollar amount wrong by whatever the
    // two differ by, with nothing on screen saying so. The scalar below is what
    // seeds the dollar row, for a fresh install and an upgrade alike.
    rates: {},
    manual: {},
    autoRate: false,
    rateFetchedAt: null,
    usdToEur: 0.92,
  },
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
  /*
   * How the aggregates read, as opposed to what the ledger says.
   *
   * `travelOverlay` folds everything a trip has claimed into one `travel`
   * category on the dashboard. It is on by default because the alternative is
   * worse for the question a dashboard is asked: a fortnight abroad puts a
   * month's worth of restaurants into one week, and a year of food read without
   * the fold looks like a change of habit that never happened.
   *
   * Nothing is written to the ledger either way — the transactions keep the
   * categories they were given, and the Travel page and the per-trip card always
   * show them. Turning this off is a reading choice, and a reversible one.
   */
  analytics: { travelOverlay: true },
  // How the app looks and reads.
  //
  // `theme` names an entry in web/src/styles/themes.js; the light/dark, sidebar
  // and chart-ramp flags that go with it are looked up from there and are
  // deliberately NOT stored, so a hand-edited settings.json cannot produce a
  // light background wearing dark-mode shadows.
  //
  // The shipped default is English. This user's own user-data/state/settings.json
  // says `pt`, which is a data fact rather than a special case in code.
  //
  // `locale` is also the only appearance value the *server* reads: it decides
  // which language the Ollama prompts are written in, because the language of a
  // prompt is the language of its answer, and the advisor's notes go on screen.
  appearance: {
    theme: 'guardian',
    locale: 'en',
    finance: 'standard',
    textures: false,
    tables: false,
  },
  // What the dashboard is made of, in the order it is drawn.
  //
  // Each entry is one card the reader placed. `id` is a handle, deliberately not
  // the widget name: two nodes may be the same widget — one drawn as a pie, one
  // as the same numbers in a table — and dragging or deleting one of them has to
  // be able to say which. `view` belongs to the node rather than to the widget
  // kind for the same reason, and that is also the whole of "remember how I like
  // to look at this": there is no second preference store, the preference is the
  // node.
  //
  // `size` is 1 (half a row), 2 (a full row) or 4 (a full row, twice as tall).
  // Height is derived from it rather than stored, so a node cannot exist at a
  // size its height contradicts.
  //
  // A sibling of `appearance` rather than part of it: appearance is mirrored to
  // localStorage and stamped onto <html> because the first paint needs it, and a
  // layout is only read once React is running.
  //
  // These six are the shipped default — a fair dashboard for a fresh install.
  // This user's own user-data/state/settings.json carries a longer list; that is
  // a data fact, not a default.
  dashboard: {
    nodes: [
      { id: 'cashflow', widget: 'cashflow', view: 'line', size: 'half' },
      { id: 'balance', widget: 'balance', view: 'area', size: 'half' },
      { id: 'trend', widget: 'trend', view: 'stacked', size: 'full' },
      { id: 'breakdown', widget: 'breakdown', view: 'pie', size: 'half' },
      { id: 'merchants', widget: 'merchants', view: 'bar', size: 'half' },
      { id: 'savings', widget: 'savings', view: 'line', size: 'full' },
    ],
  },
};

function file() {
  return statePath('settings.json');
}

/**
 * Defaults, with whatever is on disk laid over them, one level deep.
 *
 * Every top-level object needs its own line below. Forgetting one is the quietest
 * failure in the whole file: the key survives a full write and vanishes on a
 * partial one, so a setting appears to save and is gone after a reload — and the
 * symptom ("my theme keeps resetting") points at the frontend, which is the wrong
 * file to go looking in. `settings.test.js` fails if a key is ever left out.
 */
export function loadSettings() {
  if (!existsSync(file())) return structuredClone(DEFAULT_SETTINGS);
  const stored = JSON.parse(readFileSync(file(), 'utf-8'));
  const merged = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...stored,
    schedules: { ...structuredClone(DEFAULT_SETTINGS.schedules), ...(stored.schedules || {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored.llm || {}) },
    quotes: { ...DEFAULT_SETTINGS.quotes, ...(stored.quotes || {}) },
    currency: { ...structuredClone(DEFAULT_SETTINGS.currency), ...(stored.currency || {}) },
    internal: { ...DEFAULT_SETTINGS.internal, ...(stored.internal || {}) },
    analytics: { ...DEFAULT_SETTINGS.analytics, ...(stored.analytics || {}) },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(stored.appearance || {}) },
    dashboard: { ...structuredClone(DEFAULT_SETTINGS.dashboard), ...(stored.dashboard || {}) },
    modules: { ...(stored.modules || {}) },
  };
  return migrateCurrency(merged);
}

/**
 * A settings file written before the rate table existed carries one scalar,
 * `usdToEur`. It is the same number in the same orientation — euros per dollar —
 * so it becomes the table's first row and nothing about the installation
 * changes.
 *
 * Runs after the merge rather than inside it, because the merge is one level
 * deep by design and `rates` is a level below that. The scalar keeps being
 * written alongside the table so that rolling the code back still reads its own
 * file; it is a mirror from here on, never the source.
 */
function migrateCurrency(settings) {
  const currency = settings.currency;
  if (!currency.rates || typeof currency.rates !== 'object') currency.rates = {};
  if (!currency.manual || typeof currency.manual !== 'object') currency.manual = {};
  if (currency.rates.USD == null && Number.isFinite(currency.usdToEur)) {
    currency.rates.USD = currency.usdToEur;
  }
  // The pivot is implicit. A stored EUR row could only ever be 1, and a hand-
  // edited one that is not would silently rescale the whole ledger.
  delete currency.rates[PIVOT];
  delete currency.manual[PIVOT];
  return settings;
}

/** The reader's language, for the one server-side decision that depends on it. */
export function currentLocale() {
  return loadSettings().appearance?.locale || DEFAULT_SETTINGS.appearance.locale;
}

export { DEFAULT_SETTINGS };

export function saveSettings(settings) {
  const merged = { ...loadSettings(), ...settings };
  writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
