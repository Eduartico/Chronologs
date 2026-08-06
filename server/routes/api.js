import { Router } from 'express';
import multer from 'multer';
import { ingestManualTransaction, ingestManualAsset } from '../ingestion/manual.js';
import { ingestActivobank, reprocessStoredDocuments } from '../ingestion/activobank/index.js';
import { loadSyncState } from '../ingestion/activobank/gmail.js';
import { ingestPricempire, syncPricempire, fetchPortfolioList } from '../ingestion/pricempire/index.js';
import { importPricempireCsv } from '../ingestion/pricempire/importer.js';
import {
  computePositions,
  computeSummary,
  computeByMarketplace,
  computeCashTimeline,
  computeValueTimeline,
} from '../engines/portfolio.js';
import {
  ensureSession as ensurePricempireSession,
  loadPricempireState,
  savePricempireState,
} from '../ingestion/pricempire/browser.js';
import {
  saveCredentials as saveGoogleCredentials,
  getAuthUrl as getGoogleAuthUrl,
  handleCallback as handleGoogleCallback,
  getStatus as getGoogleStatus,
} from '../lib/googleAuth.js';
import {
  applyCategorization,
  applyCategorizationBulk,
  applyManualOverride,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  countTransactionsInCategory,
  mergeCategories,
  ensureDefaultCategories,
} from '../engines/categorization.js';
import {
  buildSuggestionContext,
  suggestForTransaction,
  groupByMerchant,
  sortTransactions,
} from '../engines/suggest.js';
import { classifyMerchantGroups } from '../engines/llmClassify.js';
import {
  loadRules as getRulesV2,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  runRules,
  noteCorrection,
  suggestFromTemplates,
  suggestFromLlm,
  emitTagAssignment,
  emitTagRemoval,
} from '../engines/rules.js';
import { listModels as listLlmModels, testConnection as testLlm, llmEnabled } from '../lib/ollama.js';
import { reloadScheduler, runModule } from '../lib/scheduler.js';
import { loadTags, createTag, updateTag, deleteTag } from '../lib/tags.js';
import {
  loadCorrelationRules,
  createCorrelationRule,
  updateCorrelationRule,
  deleteCorrelationRule,
  runCorrelations,
  loadProposals,
  confirmProposal,
  rejectProposal,
} from '../engines/correlation.js';
import { computeAmortizedView } from '../engines/amortization.js';
import {
  computeSecurityPositions,
  computeSecuritySummary,
  matchOrders,
  linkSecurityOrders,
  loadSecurities,
  saveSecurities,
  recordManualPrice,
} from '../engines/securities.js';
import { refreshQuotes, quotesEnabled } from '../ingestion/quotes/yahoo.js';
import { analyzeAccounts, deriveSelfNames, DEFAULT_PROFILE } from '../engines/accounts.js';
import { refreshRate, currentRate } from '../ingestion/quotes/fx.js';
import {
  collapseCandidates,
  applyCollapse,
  anomalyCandidates,
  applyAnomalyInverse,
  ambiguousRoots,
  patternCandidates,
  applyPattern,
  shadowedRules,
  applyShadowedFix,
  compactLearnedRules,
  applyCompaction,
  askLlm,
  recordFeedback,
  loadFeedback,
} from '../engines/advisor.js';
import {
  loadTravels,
  createTravel,
  updateTravel,
  deleteTravel,
  detectTravels,
  transactionsInTravel,
  travelWindow,
  travelAnomalies,
  countryName,
  syncTravelTag,
  removeTravelTag,
  markTransactionAsTravel,
} from '../engines/travel.js';
import {
  findDuplicateCandidates,
  verifyAgainstDocument,
  voidTransactions,
  restoreTransactions,
  dismissGroup,
} from '../engines/duplicates.js';
import {
  computeMonthlyCashflow,
  computeCategoryBreakdown,
  computeCategoryShifts,
  projectCurrentMonth,
  computeNetWorthEvolution,
  computeAssetAllocation,
  computeROI,
  computeInsights,
  computeCategoryTrend,
  computeTopMerchants,
  computeCumulativeBalance,
  computeSavingsRate,
  filterTransactions,
  applyTransactionFilters,
} from '../engines/analytics.js';
import { getProjections, invalidateProjections } from '../projections/cache.js';
import { replayEvents } from '../ledger/eventStore.js';
import { listNotifications, markRead, markAllRead } from '../lib/notify.js';
import { loadSettings, saveSettings } from '../lib/settings.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- GOOGLE / GMAIL CONNECTION ----------

router.post('/google/credentials', (req, res) => {
  try {
    saveGoogleCredentials(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/google/auth-url', (req, res) => {
  try {
    res.json({ url: getGoogleAuthUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    await handleGoogleCallback(req.query.code);
    res.send(
      '<html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh"><div><h2>Google account connected ✓</h2><p>You can close this tab and return to Chronologs.</p></div></body></html>'
    );
  } catch (err) {
    res.status(400).send(`OAuth error: ${err.message}`);
  }
});

router.get('/google/status', (req, res) => {
  try {
    res.json({ ...getGoogleStatus(), lastSyncAt: loadSyncState().lastSyncAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- INGESTION ENDPOINTS ----------

router.post('/ingest/activobank', async (req, res) => {
  try {
    const result = await ingestActivobank({ origin: 'gmail' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-parses documents already downloaded, without touching Gmail. Needed after
// a parser change, since each message is fetched only once.
router.post('/ingest/activobank/reprocess', async (req, res) => {
  try {
    const result = await reprocessStoredDocuments();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ingest/activobank/upload', upload.array('documents', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const files = req.files.map((f) => ({ filename: f.originalname, buffer: f.buffer }));
    const result = await ingestActivobank({ origin: 'upload', files });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resync = download each selected portfolio's CSV export and import it. The
// old scraper stays reachable for debugging via ?method=scrape.
router.post('/ingest/pricempire', async (req, res) => {
  try {
    const result =
      req.query.method === 'scrape' ? await ingestPricempire() : await syncPricempire();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- PRICEMPIRE CONNECTION ----------

router.post('/pricempire/connect', async (req, res) => {
  try {
    await ensurePricempireSession({ interactive: true });
    res.json({ sessionOk: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pricempire/status', (req, res) => {
  try {
    res.json(loadPricempireState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Fetching the list drives a real browser through a Cloudflare check and a
 * `networkidle` wait — around ten seconds. Doing that on every page visit made
 * choosing a portfolio feel broken, so the result is cached and only refreshed
 * on request.
 */
router.get('/pricempire/portfolios', async (req, res) => {
  try {
    const state = loadPricempireState();
    if (req.query.refresh !== 'true' && Array.isArray(state.portfolios)) {
      return res.json({
        portfolios: state.portfolios,
        fetchedAt: state.portfoliosFetchedAt || null,
        cached: true,
      });
    }

    const portfolios = await fetchPortfolioList();
    const fetchedAt = new Date().toISOString();
    savePricempireState({ portfolios, portfoliosFetchedAt: fetchedAt });
    res.json({ portfolios, fetchedAt, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/pricempire/portfolios', (req, res) => {
  try {
    const { selected } = req.body;
    if (!Array.isArray(selected)) return res.status(400).json({ error: 'selected must be an array' });
    res.json(savePricempireState({ selectedPortfolios: selected }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/event/manual', async (req, res) => {
  try {
    const { type, ...payload } = req.body;
    if (type === 'asset' || type === 'manual_asset') {
      const result = await ingestManualAsset(payload);
      res.json(result);
    } else {
      const result = await ingestManualTransaction(payload);
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- NOTIFICATIONS ----------

router.get('/notifications', (req, res) => {
  try {
    res.json(listNotifications({ unread: req.query.unread === 'true' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/:id/read', (req, res) => {
  try {
    const ok = markRead(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/read-all', (req, res) => {
  try {
    res.json({ marked: markAllRead() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SETTINGS ----------

router.get('/settings', (req, res) => {
  try {
    res.json(loadSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const merged = saveSettings(req.body);
    reloadScheduler();
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SCHEDULER / LLM ----------

router.post('/scheduler/run/:module', async (req, res) => {
  try {
    res.json(await runModule(req.params.module));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/llm/models', async (req, res) => {
  try {
    res.json({ models: await listLlmModels() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/llm/test', async (req, res) => {
  try {
    res.json(await testLlm());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- CATEGORIZATION ENDPOINTS ----------

/**
 * `?withUsage=true` adds a transaction count per category and sorts by it.
 * The review queue picks the category list up in that order — after a thousand
 * transactions, the six categories actually in use should not be buried
 * alphabetically among fifteen.
 */
router.get('/categories', async (req, res) => {
  try {
    ensureDefaultCategories();
    const cats = getCategories();

    if (req.query.withUsage !== 'true') return res.json(cats);

    const projections = await getProjections();
    const counts = new Map();
    for (const tx of projections.transactions) {
      const name = tx.category || 'uncategorized';
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    res.json(
      cats
        .map((c) => ({ ...c, count: counts.get(c.name) || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, parent, icon } = req.body;
    const cat = createCategory(name, parent, icon);
    if (!cat) return res.status(409).json({ error: 'Category already exists' });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const result = await updateCategory(req.params.id, req.body || {});
    if (result.error === 'not_found') return res.status(404).json({ error: 'Categoria não encontrada' });
    if (result.error === 'protected') {
      return res.status(400).json({ error: 'A categoria "uncategorized" não pode ser renomeada' });
    }
    if (result.error === 'duplicate') return res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const result = await deleteCategory(req.params.id);
    if (result.error === 'not_found') return res.status(404).json({ error: 'Categoria não encontrada' });
    if (result.error === 'protected') {
      return res.status(400).json({ error: 'A categoria "uncategorized" não pode ser apagada' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Impact preview for the delete confirmation.
router.get('/categories/:name/usage', async (req, res) => {
  try {
    res.json({ count: await countTransactionsInCategory(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories/merge', async (req, res) => {
  try {
    const { target, source } = req.body;
    const ok = await mergeCategories(target, source);
    if (!ok) return res.status(404).json({ error: 'Source or target not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/suggestions/:transactionId', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.transactionId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    const ctx = buildSuggestionContext(projections.transactions);
    res.json({ transactionId: tx.id, suggestions: suggestForTransaction(tx, ctx) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Categorizes a whole merchant group at once. Learning happens once per group
 * rather than once per transaction — accepting 47 Continente purchases should
 * create one rule, not 47.
 */
router.post('/categorize/bulk', async (req, res) => {
  try {
    const { transactionIds, category, learn = true } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: 'transactionIds must be a non-empty array' });
    }
    if (!category) return res.status(400).json({ error: 'category is required' });

    const projections = await getProjections();
    const sample = projections.transactions.find((t) => t.id === transactionIds[0]);

    const result = await applyCategorizationBulk(transactionIds, category);

    if (learn && sample && transactionIds.length >= 2) {
      noteCorrection(sample.description, sample.merchant, category);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Asks the local model about merchant groups nothing else could identify.
 * Returns suggestions for review — it never writes categories on its own.
 */
router.post('/suggest/llm', async (req, res) => {
  try {
    if (!llmEnabled()) {
      return res.status(400).json({ error: 'Ollama está desligado — activa-o em Settings' });
    }
    const projections = await getProjections();
    const ctx = buildSuggestionContext(projections.transactions);
    const pending = projections.transactions.filter((t) => t.status === 'pending');
    const groups = groupByMerchant(pending, ctx, 'date_desc');

    const unknown = groups.filter((g) => (g.suggestions[0]?.confidence ?? 0) < 0.75);
    const categories = getCategories()
      .map((c) => c.name)
      .filter((n) => n !== 'uncategorized');

    const classified = await classifyMerchantGroups(unknown, categories);
    res.json({
      asked: unknown.length,
      classified: classified.size,
      results: [...classified.entries()].map(([key, v]) => ({ key, ...v })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lets the UI show whether the local model is usable before the user goes
// hunting through Settings for it.
router.get('/llm/status', (req, res) => {
  try {
    const { llm } = loadSettings();
    res.json({ enabled: !!llm?.enabled, model: llm?.model || '', baseUrl: llm?.baseUrl || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categorize', async (req, res) => {
  try {
    const { transactionId, category, confidence, ruleId } = req.body;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const result = await applyCategorization(tx.id, category, confidence, ruleId);

    if (tx.status === 'pending' || tx.status === 'categorized') {
      noteCorrection(tx.description, tx.merchant, category);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categorize/override', async (req, res) => {
  try {
    const { transactionId, newCategory } = req.body;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const result = await applyManualOverride(tx.id, tx.category, newCategory);
    noteCorrection(tx.description, tx.merchant, newCategory);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- RULES (v2) ENDPOINTS ----------

router.get('/rules', (req, res) => {
  try {
    res.json(getRulesV2().sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules', (req, res) => {
  try {
    res.json(createRule(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/rules/:id', (req, res) => {
  try {
    const rule = updateRule(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rules/:id', (req, res) => {
  try {
    const ok = deleteRule(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be an array' });
    res.json(reorderRules(orderedIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/run', async (req, res) => {
  try {
    const result = await runRules({ transactionIds: req.body?.transactionIds || null });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rules/suggestions', async (req, res) => {
  try {
    const statics = suggestFromTemplates();
    let llm = [];
    if (req.query.llm === 'true') {
      llm = await suggestFromLlm();
    }
    res.json({ static: statics, llm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/suggestions/accept', (req, res) => {
  try {
    res.json(createRule(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- RULE ADVISOR ----------

/**
 * Both passes run deterministically; `?llm=true` adds the local model's opinion
 * on top of what was already found, never as a source of its own.
 */
router.get('/advisor', async (req, res) => {
  try {
    const projections = await getProjections();
    const collapses = collapseCandidates(getRulesV2(), projections.transactions);
    const anomalies = anomalyCandidates(projections.transactions);
    const ambiguous = ambiguousRoots(projections.transactions);
    const shadowed = shadowedRules(getRulesV2(), projections.transactions);
    const patterns = patternCandidates(getRulesV2(), projections.transactions);

    let llm = { enabled: false, findings: [] };
    if (req.query.llm === 'true') {
      llm = await askLlm({
        collapses,
        anomalies,
        ambiguous,
        shadowed,
        categories: getCategories().map((c) => c.name),
      });
    }

    res.json({
      collapses,
      anomalies,
      ambiguous,
      shadowed,
      patterns,
      llm,
      totalRules: getRulesV2().length,
      feedback: loadFeedback().length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/advisor/pattern/accept', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const projections = await getProjections();
    const finding = patternCandidates(getRulesV2(), projections.transactions).find((f) => f.id === id);
    if (!finding) return res.status(404).json({ error: 'Padrão não encontrado — pode já ter sido resolvido' });

    const result = applyPattern(finding);
    recordFeedback({ id: finding.id, kind: 'pattern', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/advisor/collapse/accept', async (req, res) => {
  try {
    const projections = await getProjections();
    const candidate = collapseCandidates(getRulesV2(), projections.transactions).find(
      (c) => c.id === req.body?.id
    );
    if (!candidate) return res.status(404).json({ error: 'Sugestão não encontrada' });

    const result = applyCollapse(candidate, { force: req.body?.force === true });
    recordFeedback({
      id: candidate.id,
      kind: 'collapse',
      subject: candidate.subject,
      verdict: 'accepted',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Fixes a rule that never gets to decide anything — by promoting it above
 * whichever rule is stealing its transactions, by redirecting that general
 * rule to the category its own matches mostly resolve to, or by deleting the
 * shadowed rule outright when the two already agree and it is pure clutter.
 */
router.post('/advisor/shadowed/resolve', async (req, res) => {
  try {
    const { id, action } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id e action são obrigatórios' });

    const projections = await getProjections();
    const finding = shadowedRules(getRulesV2(), projections.transactions).find((f) => f.id === id);
    if (!finding) return res.status(404).json({ error: 'Sugestão não encontrada — pode já ter sido resolvida' });

    const result = applyShadowedFix(finding, action, projections.transactions);
    recordFeedback({ id: finding.id, kind: 'shadowed', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Preview and apply are the same computation — the route never trusts a
// client-supplied group list, so what was shown before the click is exactly
// what happens on it.
router.post('/advisor/compact/preview', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(compactLearnedRules(getRulesV2(), projections.transactions));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/advisor/compact/apply', async (req, res) => {
  try {
    const projections = await getProjections();
    const preview = compactLearnedRules(getRulesV2(), projections.transactions);
    const result = applyCompaction(preview);
    recordFeedback({
      id: 'compact-' + Date.now(),
      kind: 'compact',
      subject: `${result.removed} regras`,
      verdict: 'accepted',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/advisor/reject', (req, res) => {
  try {
    const { id, kind, subject, note } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    res.json(recordFeedback({ id, kind: kind || 'unknown', subject: subject || id, verdict: 'rejected', note }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accepting an anomaly means the majority category was right — recategorize.
router.post('/advisor/anomaly/accept', async (req, res) => {
  try {
    const { id, transactionId, category } = req.body || {};
    if (!transactionId || !category) {
      return res.status(400).json({ error: 'transactionId e category são obrigatórios' });
    }
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const result = await applyManualOverride(tx.id, tx.category, category);
    if (id) recordFeedback({ id, kind: 'anomaly', subject: transactionId, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The other direction: the flagged transaction was right, the majority of its
// merchant group was wrong — move the group to match it instead.
router.post('/advisor/anomaly/inverse', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const projections = await getProjections();
    const finding = anomalyCandidates(projections.transactions).find((f) => f.id === id);
    if (!finding) return res.status(404).json({ error: 'Achado não encontrado — pode já ter sido resolvido' });

    const result = await applyAnomalyInverse(finding, projections.transactions);
    recordFeedback({ id: finding.id, kind: 'anomaly', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/advisor/feedback', (req, res) => {
  try {
    res.json(loadFeedback());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- TAGS ENDPOINTS ----------

router.get('/tags', (req, res) => {
  try {
    res.json(loadTags());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tags', (req, res) => {
  try {
    const tag = createTag(req.body.name, { color: req.body.color, icon: req.body.icon });
    if (!tag) return res.status(409).json({ error: 'Já existe uma subcategoria com esse nome' });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tags/:id', (req, res) => {
  try {
    const tag = updateTag(req.params.id, req.body);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tags/:id', (req, res) => {
  try {
    const ok = deleteTag(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Tag not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transactions/:id/tags', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.tags.includes(req.body.tagId)) return res.json({ success: true, alreadyTagged: true });
    emitTagAssignment(tx.id, req.body.tagId, 'manual');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Tags many transactions at once. Accepting a merchant group in the review
 * queue and then tagging it one row at a time was the only way to do this.
 * Transactions that already carry the tag are counted, not re-emitted.
 */
router.post('/transactions/tags/bulk', async (req, res) => {
  try {
    const { transactionIds, tagId, remove = false } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: 'transactionIds must be a non-empty array' });
    }
    if (!tagId) return res.status(400).json({ error: 'tagId is required' });
    if (!loadTags().some((t) => t.id === tagId)) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    const projections = await getProjections();
    const byId = new Map(projections.transactions.map((t) => [t.id, t]));
    const result = { applied: 0, unchanged: 0, skipped: 0 };

    for (const id of transactionIds) {
      const tx = byId.get(id);
      if (!tx) {
        result.skipped++;
        continue;
      }
      const has = (tx.tags || []).includes(tagId);
      if (remove ? !has : has) {
        result.unchanged++;
        continue;
      }
      if (remove) emitTagRemoval(tx.id, tagId, 'manual');
      else emitTagAssignment(tx.id, tagId, 'manual');
      result.applied++;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/transactions/:id/tags/:tagId', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    emitTagRemoval(tx.id, req.params.tagId, 'manual');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- CORRELATIONS ----------

router.get('/correlation-rules', (req, res) => {
  try {
    res.json(loadCorrelationRules());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/correlation-rules', (req, res) => {
  try {
    res.json(createCorrelationRule(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/correlation-rules/:id', (req, res) => {
  try {
    const rule = updateCorrelationRule(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/correlation-rules/:id', (req, res) => {
  try {
    const ok = deleteCorrelationRule(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/correlations/run', async (req, res) => {
  try {
    res.json(await runCorrelations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/correlations', (req, res) => {
  try {
    let proposals = loadProposals();
    if (req.query.status) proposals = proposals.filter((p) => p.status === req.query.status);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/correlations/:id/confirm', (req, res) => {
  try {
    const result = confirmProposal(req.params.id);
    if (!result) return res.status(404).json({ error: 'Pending proposal not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/correlations/:id/reject', (req, res) => {
  try {
    const proposal = rejectProposal(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Pending proposal not found' });
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- TRANSACTIONS ENDPOINTS ----------

/**
 * Every filter the transactions page offers is applied here, in one place.
 *
 * Category and tag used to be filtered in the browser over whatever the last
 * request happened to return, while status and search were filtered here. The
 * two halves disagreed constantly — picking a category while the status filter
 * still said "pending" could only ever return nothing, because a pending
 * transaction has no category yet. `total` comes back alongside the rows so the
 * UI can say "0 of 1417" instead of showing a blank table.
 */
router.get('/transactions', async (req, res) => {
  try {
    const projections = await getProjections();
    const transactions = applyTransactionFilters(projections.transactions, req.query);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Same filters, but with the unfiltered totals and date bounds the filter bar
// needs to render presets and counts.
router.get('/transactions/search', async (req, res) => {
  try {
    const projections = await getProjections();
    const all = projections.transactions;
    const matched = applyTransactionFilters(all, req.query);
    const dates = all.map((t) => (t.date || '').slice(0, 10)).filter(Boolean).sort();
    res.json({
      transactions: matched,
      matched: matched.length,
      total: all.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Pending review queue. Defaults to newest-first — the queue used to arrive in
 * ledger order, which meant the first thing shown was a purchase from 2020 that
 * nobody could remember. `group=merchant` collapses repeats into one card each,
 * which is what makes a 1300-row backlog clearable.
 */
router.get('/transactions/pending', async (req, res) => {
  try {
    const { sort = 'date_desc', group } = req.query;
    const projections = await getProjections();
    const ctx = buildSuggestionContext(projections.transactions);
    const pending = projections.transactions.filter((t) => t.status === 'pending');

    if (group === 'merchant') {
      return res.json({
        mode: 'grouped',
        totalPending: pending.length,
        groups: groupByMerchant(pending, ctx, sort),
      });
    }

    res.json({
      mode: 'flat',
      totalPending: pending.length,
      transactions: sortTransactions(pending, sort).map((t) => ({
        ...t,
        suggestions: suggestForTransaction(t, ctx),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- TRAVEL ----------

router.get('/travels', async (req, res) => {
  try {
    const travels = loadTravels();
    const projections = await getProjections();
    // Each trip carries its own totals: a calendar entry with no money attached
    // to it is not worth confirming.
    res.json(
      travels.map((t) => {
        const inWindow = transactionsInTravel(t, projections.transactions);
        return {
          ...t,
          countryName: countryName(t.country),
          window: travelWindow(t),
          transactionCount: inWindow.length,
          total: inWindow.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0),
        };
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/travels', async (req, res) => {
  try {
    const travel = createTravel(req.body || {});
    const sync = await syncTravelTagFromLedger(travel);
    res.json({ ...travel, ...sync });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/travels/:id', async (req, res) => {
  try {
    const travel = updateTravel(req.params.id, req.body || {});
    if (!travel) return res.status(404).json({ error: 'Viagem não encontrada' });
    // Dates or name may have moved, so the tag has to follow.
    const sync = await syncTravelTagFromLedger(travel);
    res.json({ ...travel, ...sync });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/travels/:id', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return res.status(404).json({ error: 'Viagem não encontrada' });
    // Untag before deleting: once the trip is gone there is nothing left that
    // knows which tag was its own.
    const { transactions } = await getProjections();
    const { untagged } = removeTravelTag(travel, transactions);
    deleteTravel(req.params.id);
    if (untagged) invalidateProjections();
    res.json({ success: true, untagged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Makes sure the trip has its subcategory, and that its name still matches.
 *
 * It does not touch a single transaction: which ones belong to the trip is the
 * owner's call, made row by row on the trip's own screen.
 */
async function syncTravelTagFromLedger(travel) {
  return syncTravelTag(travel);
}

router.post('/travels/detect', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json({ proposals: detectTravels(projections.transactions) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/travels/:id/transactions', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return res.status(404).json({ error: 'Viagem não encontrada' });
    const projections = await getProjections();
    res.json(transactionsInTravel(travel, projections.transactions));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * One transaction in or out of a trip.
 *
 * Category and subcategory move together because they are the same decision:
 * "this was part of the trip". Taking it out sends the category back to
 * `uncategorized` rather than guessing what it was before the trip claimed it.
 */
router.post('/travels/:id/transactions/:txId', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return res.status(404).json({ error: 'Viagem não encontrada' });

    const on = req.body?.on !== false;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transacção não encontrada' });

    const { tagId, changed } = markTransactionAsTravel(travel, tx, on);
    await applyCategorizationBulk([tx.id], on ? travel.category || 'travel' : 'uncategorized', 'manual');
    if (changed) invalidateProjections();

    res.json({ success: true, tagId, marked: on });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Labels everything inside a trip's window in one go — the shortcut for a trip
 * where nearly everything really was travel. It is deliberately opt-in and
 * defaults to only touching what is still unclassified; the row-by-row route
 * above is the normal way in. Manual overrides are respected by
 * applyCategorizationBulk, so a decision made by hand is never undone here.
 */
router.post('/travels/:id/apply', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return res.status(404).json({ error: 'Viagem não encontrada' });

    const { category = travel.category || 'travel', onlyUncategorized = true } = req.body || {};
    // The trip may never have been opened, in which case its subcategory does
    // not exist yet. Ask for it rather than reading a field that can be null.
    const tagId = req.body?.tagId ?? syncTravelTag(travel).tagId;

    const projections = await getProjections();
    let targets = transactionsInTravel(travel, projections.transactions);
    if (onlyUncategorized) targets = targets.filter((t) => t.status === 'pending');

    const ids = targets.map((t) => t.id);
    const result = { matched: ids.length, categorized: 0, tagged: 0 };

    if (category && ids.length > 0) {
      const applied = await applyCategorizationBulk(ids, category, 'travel');
      result.categorized = applied.applied;
    }
    if (tagId) {
      for (const tx of targets) {
        if (!(tx.tags || []).includes(tagId)) {
          emitTagAssignment(tx.id, tagId, 'travel');
          result.tagged++;
        }
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/travels/anomalies', async (req, res) => {
  try {
    const projections = await getProjections();
    const { missing, stray } = travelAnomalies(projections.transactions);
    res.json({
      missing: missing.slice(0, 200).map((m) => ({
        transaction: m.transaction,
        travelId: m.travel.id,
        travelName: m.travel.name,
      })),
      stray: stray.slice(0, 200).map((s) => s.transaction),
      missingTotal: missing.length,
      strayTotal: stray.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- DUPLICATES ----------

router.get('/duplicates', async (req, res) => {
  try {
    const projections = await getProjections();
    const groups = findDuplicateCandidates(projections.transactions);
    res.json({
      groups,
      totalGroups: groups.length,
      // What would actually disappear if every group were reduced to one row.
      surplus: groups.reduce((sum, g) => sum + g.count - 1, 0),
      voided: projections.voidedTransactions.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-reads the source PDF so the decision rests on the document, not a guess.
router.post('/duplicates/verify', async (req, res) => {
  try {
    const projections = await getProjections();
    const groups = findDuplicateCandidates(projections.transactions);
    // The key is derived from the group's first member, so anything that shifts
    // membership — an earlier void, a dismissal, a fresh ingest — renames the
    // group out from under the card the user is still looking at. Falling back
    // to the ids the client sent finds it again instead of 404ing at them.
    const wanted = new Set(req.body?.transactionIds || []);
    const group =
      groups.find((g) => g.key === req.body?.key) ||
      (wanted.size ? groups.find((g) => g.transactions.some((t) => wanted.has(t.id))) : null);
    if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json(await verifyAgainstDocument(group));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/duplicates/void', async (req, res) => {
  try {
    const { transactionIds, keepId } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: 'transactionIds must be a non-empty array' });
    }
    const toVoid = [...new Set(transactionIds)].filter((id) => id !== keepId);
    // Nothing left to void is not an error: the group had already collapsed to a
    // single movement, which is exactly the state the user was asking for. Say
    // so and let the screen refresh rather than showing them a red failure.
    if (toVoid.length === 0) return res.json({ voided: 0, collapsed: true });
    res.json(await voidTransactions(toVoid, { reason: 'duplicate', duplicateOf: keepId || null }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/duplicates/restore', async (req, res) => {
  try {
    const { transactionIds } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: 'transactionIds must be a non-empty array' });
    }
    res.json(await restoreTransactions(transactionIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/duplicates/dismiss', (req, res) => {
  try {
    if (!req.body?.key) return res.status(400).json({ error: 'key is required' });
    dismissGroup(req.body.key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/duplicates/voided', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(projections.voidedTransactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- INVESTMENTS (CS2 / Pricempire) ----------

router.post('/investments/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const result = await importPricempireCsv(req.file.buffer, { filename: req.file.originalname });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Positions, summary and breakdowns are all derived from the same event list,
// so they are served together — the page needs them at once anyway.
router.get('/investments', async (req, res) => {
  try {
    const projections = await getProjections();
    const investments = projections.investments || [];
    const prices = Object.entries(projections.priceMap).map(([name, p]) => ({
      name,
      price: p.price,
      currency: p.currency || 'USD',
    }));

    const positions = computePositions(investments, prices);

    // ETFs bought at the bank live alongside the CS2 holdings: same page, two
    // sections, because they are answers to the same question.
    const securityPositions = computeSecurityPositions(
      projections.securityOrders || [],
      projections.transactions,
      projections.priceMap
    );

    res.json({
      summary: computeSummary(positions),
      positions,
      byMarketplace: computeByMarketplace(investments),
      cashTimeline: computeCashTimeline(investments),
      valueTimeline: computeValueTimeline(projections.assetSnapshots),
      transactionCount: investments.length,
      securities: {
        positions: securityPositions,
        summary: computeSecuritySummary(securityPositions, projections.transactions),
        registry: loadSecurities(),
        quotesEnabled: quotesEnabled(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/investments/transactions', async (req, res) => {
  try {
    const projections = await getProjections();
    let list = projections.investments || [];
    const { search, type, marketplace } = req.query;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => (t.name || '').toLowerCase().includes(q));
    }
    if (type) list = list.filter((t) => t.type === type);
    if (marketplace) list = list.filter((t) => t.marketplace === marketplace);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SECURITIES (ETFs via ActivoBank) ----------

router.get('/securities', async (req, res) => {
  try {
    const projections = await getProjections();
    const orders = projections.securityOrders || [];
    const { matches, unmatchedOrders, orphanTransactions } = matchOrders(
      orders,
      projections.transactions
    );
    res.json({
      registry: loadSecurities(),
      orders,
      positions: computeSecurityPositions(orders, projections.transactions, projections.priceMap),
      // Surfaced rather than hidden: an unmatched order or an orphan statement
      // line is exactly what a wrong entry in the registry looks like.
      matched: matches.length,
      unmatchedOrders,
      orphanTransactions: orphanTransactions.map((o) => ({ ...o.tx, parsed: o.parsed })),
      quotesEnabled: quotesEnabled(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/securities', (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Esperado um array' });
    res.json(saveSecurities(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/securities/link', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(await linkSecurityOrders(projections.securityOrders || [], projections.transactions));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/securities/quotes/refresh', async (req, res) => {
  try {
    res.json(await refreshQuotes({ force: req.body?.force === true }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** What the app is converting with, and how old it is. */
router.get('/currency/rate', (req, res) => {
  res.json(currentRate());
});

router.post('/currency/rate/refresh', async (req, res) => {
  try {
    res.json(await refreshRate({ force: req.body?.force === true }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/securities/price', async (req, res) => {
  try {
    const { symbol, price, currency } = req.body || {};
    if (!symbol || price == null) return res.status(400).json({ error: 'symbol e price são obrigatórios' });
    await recordManualPrice(symbol, price, currency || 'EUR');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ASSETS ENDPOINTS ----------

router.get('/assets', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(projections.assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ANALYTICS ENDPOINTS ----------

/**
 * Dashboard data. `from`, `to`, `granularity` and `categories` drive every
 * series in one request, so changing the range updates the whole page at once.
 * The unfiltered date bounds come back too, so the UI can offer sensible
 * presets without a second round trip.
 */
/**
 * The span immediately before the one being shown, of the same length.
 *
 * With no explicit range the whole history is on screen and there is nothing
 * before it, so the comparison is simply skipped rather than faked.
 */
function previousPeriod(current, all, { from, to }) {
  if (!from || !to) return [];
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const priorTo = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const priorFrom = new Date(Date.parse(priorTo) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return all.filter((t) => {
    const d = String(t.date).slice(0, 10);
    return d >= priorFrom && d <= priorTo;
  });
}
router.get('/analytics', async (req, res) => {
  try {
    const { from, to, granularity = 'month' } = req.query;
    const categories = req.query.categories ? String(req.query.categories).split(',') : null;

    const projections = await getProjections();
    const categorizedMap = projections.categoryMap;
    const all = projections.spendingTransactions;
    const transactions = filterTransactions(all, {
      from,
      to,
      categories,
      categoryMap: categorizedMap,
    });

    const monthlyCashflow = computeMonthlyCashflow(transactions, granularity);
    const categoryBreakdown = computeCategoryBreakdown(transactions, categorizedMap);
    const amortized = computeAmortizedView(transactions);
    const netWorth = computeNetWorthEvolution(projections.assetSnapshots);
    const allocation = computeAssetAllocation(projections.assets);
    const roi = computeROI(projections.assets);
    const insights = computeInsights(transactions, categorizedMap, monthlyCashflow);

    // The same span again, immediately before this one, so every figure can be
    // shown against what it was rather than on its own.
    const previous = previousPeriod(transactions, all, { from, to });
    const shifts = computeCategoryShifts(transactions, previous, categorizedMap);
    const projection = projectCurrentMonth(monthlyCashflow);

    const dates = all.map((t) => (t.date || '').slice(0, 10)).filter(Boolean).sort();

    res.json({
      range: {
        from: from || null,
        to: to || null,
        granularity,
        earliest: dates[0] || null,
        latest: dates[dates.length - 1] || null,
        matched: transactions.length,
        total: all.length,
      },
      monthlyCashflow,
      cumulative: computeCumulativeBalance(monthlyCashflow),
      savingsRate: computeSavingsRate(monthlyCashflow),
      categoryTrend: computeCategoryTrend(transactions, categorizedMap, granularity),
      topMerchants: computeTopMerchants(transactions),
      categoryBreakdown,
      amortized,
      netWorth,
      allocation,
      roi,
      insights,
      shifts,
      projection,
      vaults: projections.vaults,
      vaultTotal: projections.vaultTotal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/cashflow', async (req, res) => {
  try {
    const projections = await getProjections();
    const result = computeMonthlyCashflow(projections.spendingTransactions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/insights', async (req, res) => {
  try {
    const projections = await getProjections();
    const cashflow = computeMonthlyCashflow(projections.spendingTransactions);
    const insights = computeInsights(
      projections.spendingTransactions,
      projections.categoryMap,
      cashflow
    );
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ACCOUNTS & VAULTS ----------

/**
 * Where the money actually sits.
 *
 * Both the accounts and the savings vaults inside them are discovered from the
 * documents, never configured, so a newly opened vault shows up on its own.
 */
router.get('/accounts', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json({
      accounts: projections.accounts,
      holders: projections.accountHolders,
      vaults: projections.vaults,
      vaultTotal: projections.vaultTotal,
      needsAttribution: projections.vaultsNeedAttribution,
      reconciliation: projections.vaultReconciliation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** The paired-up internal movements, newest first, with both legs named. */
router.get('/accounts/movements', async (req, res) => {
  try {
    const projections = await getProjections();
    const { vault } = req.query;
    let movements = [...projections.internalMovements].reverse();
    if (vault) movements = movements.filter((m) => m.vault === vault);
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * How this institution spells "money left the account", "this is the savings
 * product", "this was cash from an ATM" — the five patterns that let internal
 * transfers be recognised. `null` in the response means the ActivoBank
 * default is in effect; the shape either way is `DEFAULT_PROFILE`'s.
 */
router.get('/accounts/profile', (req, res) => {
  try {
    res.json({ profile: loadSettings().internal?.profile || null, default: DEFAULT_PROFILE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/profile', (req, res) => {
  try {
    const settings = loadSettings();
    const merged = saveSettings({ internal: { ...settings.internal, profile: req.body?.profile || null } });
    invalidateProjections();
    res.json({ profile: merged.internal.profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Tries a candidate profile against the real ledger without saving it —
 * how many internal movements and vaults it would recognise, so a typo in a
 * hand-edited regex shows up as "0 movimentos reconhecidos" before it is ever
 * applied, rather than after.
 */
router.post('/accounts/profile/preview', async (req, res) => {
  try {
    const projections = await getProjections();
    const settings = loadSettings();
    const selfNames = [
      ...new Set([...deriveSelfNames(projections.transactions), ...(settings.internal?.selfNames || [])]),
    ];
    const result = analyzeAccounts(projections.transactions, {
      selfNames,
      windowDays: settings.internal?.windowDays ?? 3,
      profile: req.body?.profile || null,
    });
    res.json({
      internalMovements: result.movements.length,
      vaults: result.vaults.map((v) => ({ vault: v.vault, balance: v.balance })),
      accountsFound: result.accounts.length,
      reconciled: result.reconciliation?.balanced ?? null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Points an unnamed savings pool at the vault it really belonged to.
 *
 * The bank only began naming vaults partway through, so early deposits carry no
 * name and only the owner knows where they went. Stored as a setting rather
 * than rewritten into the ledger: it is an interpretation, not a new fact.
 */
router.post('/accounts/vaults/alias', async (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from) return res.status(400).json({ error: 'from is required' });

    const settings = loadSettings();
    const vaultAliases = { ...(settings.internal?.vaultAliases || {}) };
    if (to) vaultAliases[from] = to;
    else delete vaultAliases[from];

    saveSettings({ internal: { ...settings.internal, vaultAliases } });
    invalidateProjections();

    const projections = await getProjections();
    res.json({ vaultAliases, vaults: projections.vaults, vaultTotal: projections.vaultTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- AUDIT / EVENTS ----------

router.get('/events', async (req, res) => {
  try {
    const events = await replayEvents();
    const { type, limit } = req.query;
    let filtered = events;
    if (type) filtered = filtered.filter((e) => e.type === type);
    if (limit) filtered = filtered.slice(-parseInt(limit));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
