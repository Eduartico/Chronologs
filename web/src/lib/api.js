const BASE = '/api';

// The server puts a readable reason in { error }; surfacing only res.statusText
// turned every failure into an unhelpful "Bad Request".
async function unwrap(res) {
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => b?.error)
      .catch(() => null);
    throw new Error(detail || res.statusText || `HTTP ${res.status}`);
  }
  return res.json();
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
    const qs = new URLSearchParams(params).toString();
    return get(`/transactions${qs ? '?' + qs : ''}`);
  },
  getPending: ({ sort = 'date_desc', group } = {}) => {
    const qs = new URLSearchParams({ sort, ...(group ? { group } : {}) }).toString();
    return get(`/transactions/pending?${qs}`);
  },
  getSuggestions: (id) => get(`/suggestions/${id}`),

  // Categories
  getCategories: () => get('/categories'),
  createCategory: (name, parent) => post('/categories', { name, parent }),
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
  createTag: (name, color) => post('/tags', { name, color }),
  updateTag: (id, data) => put(`/tags/${id}`, data),
  deleteTag: (id) => del(`/tags/${id}`),
  addTransactionTag: (transactionId, tagId) => post(`/transactions/${transactionId}/tags`, { tagId }),
  removeTransactionTag: (transactionId, tagId) => del(`/transactions/${transactionId}/tags/${tagId}`),

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
