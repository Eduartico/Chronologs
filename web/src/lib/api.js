import { t } from '../i18n/index.js';

const BASE = '/api';

/**
 * Turn a failed response into an Error the UI can show in the reader's language.
 *
 * The server puts a readable reason in `{ error }` — surfacing only
 * `res.statusText` turned every failure into an unhelpful "Bad Request". It now
 * also puts a translation key in `{ errorKey, errorParams }`, so the same failure
 * reads in Portuguese or English depending on the setting rather than on whichever
 * language the route happened to be written in.
 *
 * `error` is still English prose, and is still what gets thrown as the message, so
 * a route not yet carrying a key keeps working and anything logging `err.message`
 * keeps saying something true.
 */
async function unwrap(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.error || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.key = body?.errorKey;
    err.params = body?.errorParams;
    throw err;
  }
  return res.json();
}

/**
 * The text to put in a toast. Prefers the key; falls back to whatever the server
 * said, wrapped so the sentence still reads as a sentence in either language.
 *
 * Use this rather than concatenating a prefix onto `e.message`, which is how
 * every page used to do it — that prefix was itself an untranslated string,
 * written as "Erro: " in some files and "Error: " in others, seventy-nine times
 * over.
 */
export function errText(e) {
  if (e?.key) return t(e.key, e.params || {});
  return t('api.error.unexpected', { detail: e?.message || 'unknown' });
}

const get = (url) => fetch(`${BASE}${url}`).then(unwrap);

const post = (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(unwrap);

const put = (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(unwrap);

const del = (url) => fetch(`${BASE}${url}`, { method: 'DELETE' }).then(unwrap);

// Blank filters must not reach the server as empty query params — "category="
// would otherwise read as a category named "".
const clean = (params) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));

/** The same rule as `clean`, as a ready-to-append suffix. */
const qs = (params) => {
  const query = new URLSearchParams(clean(params || {})).toString();
  return query ? `?${query}` : '';
};

export const api = {
  // Ingestion
  ingestActivobank: () => post('/ingest/activobank'),
  reprocessActivobank: () => post('/ingest/activobank/reprocess'),
  uploadActivobankDocuments: (files) => {
    const form = new FormData();
    for (const f of files) form.append('documents', f);
    return fetch(`${BASE}/ingest/activobank/upload`, { method: 'POST', body: form }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    });
  },
  ingestPricempire: () => post('/ingest/pricempire'),
  ingestManual: (data) => post('/event/manual', data),

  // Google / Gmail connection
  getGoogleStatus: () => get('/google/status'),
  saveGoogleCredentials: (credentials) => post('/google/credentials', credentials),
  getGoogleAuthUrl: () => get('/google/auth-url'),

  // Pricempire connection
  getPricempireStatus: () => get('/pricempire/status'),
  connectPricempire: () => post('/pricempire/connect'),
  getPricempirePortfolios: (refresh = false) =>
    get(`/pricempire/portfolios${refresh ? '?refresh=true' : ''}`),
  savePricempirePortfolios: (selected) => put('/pricempire/portfolios', { selected }),

  // Transactions
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(clean(params)).toString();
    return get(`/transactions${qs ? '?' + qs : ''}`);
  },
  searchTransactions: (params = {}) => {
    const qs = new URLSearchParams(clean(params)).toString();
    return get(`/transactions/search${qs ? '?' + qs : ''}`);
  },
  getPending: ({ sort = 'date_desc', group } = {}) => {
    const qs = new URLSearchParams({ sort, ...(group ? { group } : {}) }).toString();
    return get(`/transactions/pending?${qs}`);
  },
  getSuggestions: (id) => get(`/suggestions/${id}`),

  // Categories
  getCategories: (withUsage = false) => get(`/categories${withUsage ? '?withUsage=true' : ''}`),
  createCategory: (name, parent, icon) => post('/categories', { name, parent, icon }),
  updateCategory: (id, patch) => put(`/categories/${id}`, patch),
  deleteCategory: (id) => del(`/categories/${id}`),
  getCategoryUsage: (name) => get(`/categories/${encodeURIComponent(name)}/usage`),
  mergeCategories: (target, source) => post('/categories/merge', { target, source }),
  categorize: (transactionId, category) => post('/categorize', { transactionId, category }),
  categorizeBulk: (transactionIds, category) =>
    post('/categorize/bulk', { transactionIds, category }),
  overrideCategory: (transactionId, newCategory) =>
    post('/categorize/override', { transactionId, newCategory }),

  // Tags
  getTags: () => get('/tags'),
  // Subcategories in the interface; still `tags` on the wire and in the ledger,
  // where renaming the event type would rewrite history for nothing.
  createTag: (name, { color, icon } = {}) => post('/tags', { name, color, icon }),
  updateTag: (id, data) => put(`/tags/${id}`, data),
  deleteTag: (id) => del(`/tags/${id}`),
  addTransactionTag: (transactionId, tagId) => post(`/transactions/${transactionId}/tags`, { tagId }),
  removeTransactionTag: (transactionId, tagId) => del(`/transactions/${transactionId}/tags/${tagId}`),
  tagBulk: (transactionIds, tagId, remove = false) =>
    post('/transactions/tags/bulk', { transactionIds, tagId, remove }),

  // Duplicates
  getAccounts: () => get('/accounts'),
  getInternalMovements: (vault) =>
    get(`/accounts/movements${vault ? `?vault=${encodeURIComponent(vault)}` : ''}`),
  setVaultAlias: (from, to) => post('/accounts/vaults/alias', { from, to }),

  getDuplicates: () => get('/duplicates'),
  // The ids ride along so the server can still find the group when its key has
  // shifted underneath us (the key is derived from the group's first member).
  verifyDuplicate: (key, transactionIds) => post('/duplicates/verify', { key, transactionIds }),
  voidDuplicates: (transactionIds, keepId) => post('/duplicates/void', { transactionIds, keepId }),
  restoreTransactions: (transactionIds) => post('/duplicates/restore', { transactionIds }),
  dismissDuplicate: (key) => post('/duplicates/dismiss', { key }),
  getVoidedTransactions: () => get('/duplicates/voided'),

  // Travel
  getTravels: () => get('/travels'),
  createTravel: (travel) => post('/travels', travel),
  updateTravel: (id, patch) => put(`/travels/${id}`, patch),
  deleteTravel: (id) => del(`/travels/${id}`),
  detectTravels: () => post('/travels/detect'),
  getTravelTransactions: (id) => get(`/travels/${id}/transactions`),
  // Category and subcategory in one call, because "this was part of the trip"
  // is one decision.
  markTravelTransaction: (id, txId, on) =>
    post(`/travels/${id}/transactions/${txId}`, { on }),
  applyTravel: (id, options) => post(`/travels/${id}/apply`, options || {}),
  getTravelAnomalies: () => get('/travels/anomalies'),

  // The two aggregates behind the experimental charts. Separate endpoints so
  // /analytics stays byte-identical for the snapshot baseline, and so a page
  // with the flag off never asks for them.
  getFlow: (params) => get(`/analytics/flow${qs(params)}`),
  getDailySpend: (params) => get(`/analytics/daily${qs(params)}`),

  getCurrencyRate: () => get('/currency/rate'),
  refreshCurrencyRate: (force) => post('/currency/rate/refresh', { force }),

  // The whole table. The two single-rate calls above are the dollar row of the
  // same data and are kept because the snapshot baseline records them.
  getCurrencyRates: () => get('/currency/rates'),
  refreshCurrencyRates: (force) => post('/currency/rates/refresh', { force }),
  /** `rate: null` clears a hand-typed rate and falls back to the fetched one. */
  setCurrencyRate: (code, rate) => put(`/currency/rates/${code}`, { rate }),

  // Institution profile: the five patterns that let a statement's own wording
  // for "money left this account" etc. be recognised, so the internal-transfer
  // logic is not permanently ActivoBank's alone.
  getInstitutionProfile: () => get('/accounts/profile'),
  saveInstitutionProfile: (profile) => put('/accounts/profile', { profile }),
  previewInstitutionProfile: (profile) => post('/accounts/profile/preview', { profile }),

  // Rule advisor
  getAdvisor: (useLlm = false) => get(`/advisor${useLlm ? '?llm=true' : ''}`),
  acceptCollapse: (id, force = false) => post('/advisor/collapse/accept', { id, force }),
  acceptAnomaly: (id, transactionId, category) =>
    post('/advisor/anomaly/accept', { id, transactionId, category }),
  inverseAnomaly: (id) => post('/advisor/anomaly/inverse', { id }),
  acceptPattern: (id) => post('/advisor/pattern/accept', { id }),
  rejectAdvice: (id, kind, subject, note) => post('/advisor/reject', { id, kind, subject, note }),
  resolveShadowed: (id, action) => post('/advisor/shadowed/resolve', { id, action }),
  previewCompaction: () => post('/advisor/compact/preview'),
  applyCompaction: () => post('/advisor/compact/apply'),

  // Securities (ETFs via ActivoBank)
  getSecurities: () => get('/securities'),
  saveSecurities: (list) => put('/securities', list),
  linkSecurities: () => post('/securities/link'),
  refreshQuotes: (force = false) => post('/securities/quotes/refresh', { force }),
  setSecurityPrice: (symbol, price, currency) => post('/securities/price', { symbol, price, currency }),

  // Rules
  getRules: () => get('/rules'),
  createRule: (rule) => post('/rules', rule),
  updateRule: (id, rule) => put(`/rules/${id}`, rule),
  deleteRule: (id) => del(`/rules/${id}`),
  reorderRules: (orderedIds) => post('/rules/reorder', { orderedIds }),
  runRules: () => post('/rules/run'),
  getRuleSuggestions: (useLlm = false) => get(`/rules/suggestions${useLlm ? '?llm=true' : ''}`),
  acceptRuleSuggestion: (suggestion) => post('/rules/suggestions/accept', suggestion),

  // Correlations
  getCorrelationRules: () => get('/correlation-rules'),
  createCorrelationRule: (rule) => post('/correlation-rules', rule),
  updateCorrelationRule: (id, rule) => put(`/correlation-rules/${id}`, rule),
  deleteCorrelationRule: (id) => del(`/correlation-rules/${id}`),
  runCorrelations: () => post('/correlations/run'),
  getCorrelations: (status) => get(`/correlations${status ? '?status=' + status : ''}`),
  confirmCorrelation: (id) => post(`/correlations/${id}/confirm`),
  rejectCorrelation: (id) => post(`/correlations/${id}/reject`),

  // Notifications
  getNotifications: (unread = false) => get(`/notifications${unread ? '?unread=true' : ''}`),
  markNotificationRead: (id) => post(`/notifications/${id}/read`),
  markAllNotificationsRead: () => post('/notifications/read-all'),

  // Settings
  getSettings: () => get('/settings'),
  saveSettings: (settings) => put('/settings', settings),

  // LLM (Ollama)
  getLlmModels: () => get('/llm/models'),
  getLlmStatus: () => get('/llm/status'),
  testLlm: () => post('/llm/test'),
  suggestWithLlm: () => post('/suggest/llm'),

  // Scheduler
  runScheduledModule: (module) => post(`/scheduler/run/${module}`),

  // Assets
  getAssets: () => get('/assets'),

  // Investments (CS2 / Pricempire)
  getInvestments: () => get('/investments'),
  getInvestmentTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/investments/transactions${qs ? '?' + qs : ''}`);
  },
  importInvestmentCsv: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${BASE}/investments/import`, { method: 'POST', body: form }).then(unwrap);
  },

  // Analytics
  getAnalytics: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    const qs = new URLSearchParams(clean).toString();
    return get(`/analytics${qs ? '?' + qs : ''}`);
  },
  getCashflow: () => get('/analytics/cashflow'),
  getInsights: () => get('/analytics/insights'),

  // Events
  getEvents: (type, limit) => get(`/events${type ? '?type=' + type + (limit ? '&limit=' + limit : '') : limit ? '?limit=' + limit : ''}`),
};
