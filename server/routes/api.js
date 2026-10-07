import { Router } from 'express';
import { fail, failFrom } from '../lib/httpError.js';
import multer from 'multer';
import { ingestManualTransaction, ingestManualAsset } from '../ingestion/manual.js';
import {
  invoke as invokeModule,
  invokeAction as moduleAction,
  instancesOfFamily,
  sourceInstances,
} from '../framework/registry.js';
import {
  computePositions,
  computeSummary,
  computeByMarketplace,
  computeCashTimeline,
  computeValueTimeline,
} from '../engines/portfolio.js';
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
  defaultCorrelationSources,
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
import { refreshRate, currentRate, refreshRates, currentRates } from '../ingestion/quotes/fx.js';
import { currencyCodes, isKnownCurrency } from '../../web/src/lib/currencies.js';
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
  reviewWindow,
  lateSignals,
  dismissFromTravel,
  travelAnomalies,
  countryName,
  syncTravelTag,
  removeTravelTag,
  markTransactionAsTravel,
  travelOverlay,
  tripSpending,
  tripDetail,
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
  computeFlow,
  computeDailySpend,
  splitFlows,
  resolveGranularity,
  priorSpan,
  computePace,
  typicalMonth,
} from '../engines/analytics.js';
import { getProjections, invalidateProjections } from '../projections/cache.js';
import { replayEvents } from '../ledger/eventStore.js';
import { listNotifications, markRead, markAllRead } from '../lib/notify.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { computeNetWorth } from '../engines/netWorth.js';
import { derivedCategoryNames } from '../lib/derivedCategories.js';
import { detectRecurring, occurrences, loadRecurringState, setIgnored } from '../engines/recurring.js';
import { forecastCash } from '../engines/forecast.js';
import { budgetReport, loadGoals, setGoal } from '../engines/budgets.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- GOOGLE / GMAIL CONNECTION ----------

router.post('/google/credentials', (req, res) => {
  try {
    saveGoogleCredentials(req.body);
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err, 400);
  }
});

router.get('/google/auth-url', (req, res) => {
  try {
    res.json({ url: getGoogleAuthUrl() });
  } catch (err) {
    failFrom(res, err, 400);
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

router.get('/google/status', async (req, res) => {
  try {
    const status = await invokeModule('activobank', 'status');
    res.json({ ...getGoogleStatus(), lastSyncAt: status.lastSyncAt });
  } catch (err) {
    failFrom(res, err);
  }
});

/* ---------- INGESTION ENDPOINTS ------------------------------------------
   Named after the two providers this app was built around, and kept that way:
   every one of them is a two-line delegation to /api/modules/:instance/…, which
   is where a third provider is reached without anything being added here.

   They exist for the interface that already calls them and for anyone's
   bookmarks and scripts. New work should use the generic routes. */

router.post('/ingest/activobank', async (req, res) => {
  try {
    res.json(await invokeModule('activobank', 'sync'));
  } catch (err) {
    failFrom(res, err);
  }
});

// Re-parses documents already downloaded, without touching Gmail. Needed after
// a parser change, since each message is fetched only once.
router.post('/ingest/activobank/reprocess', async (req, res) => {
  try {
    res.json(await invokeModule('activobank', 'reprocess'));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/ingest/activobank/upload', upload.array('documents', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return fail(res, 400, 'api.error.noFiles');
    }
    const files = req.files.map((f) => ({ filename: f.originalname, buffer: f.buffer }));
    res.json(await invokeModule('activobank', 'upload', files));
  } catch (err) {
    failFrom(res, err);
  }
});

// Resync = download each selected portfolio's CSV export and import it. The
// old scraper stays reachable for debugging via ?method=scrape.
router.post('/ingest/pricempire', async (req, res) => {
  try {
    res.json(
      req.query.method === 'scrape'
        ? await moduleAction('pricempire', 'scrape')
        : await invokeModule('pricempire', 'sync')
    );
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- PRICEMPIRE CONNECTION ----------

router.post('/pricempire/connect', async (req, res) => {
  try {
    res.json(await invokeModule('pricempire', 'connect'));
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/pricempire/status', async (req, res) => {
  try {
    res.json(await invokeModule('pricempire', 'status'));
  } catch (err) {
    failFrom(res, err);
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
    res.json(await moduleAction('pricempire', 'portfolios', { refresh: req.query.refresh === 'true' }));
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/pricempire/portfolios', async (req, res) => {
  try {
    const { selected } = req.body;
    if (!Array.isArray(selected)) return fail(res, 400, 'api.error.selectedMustBeArray');
    res.json(await moduleAction('pricempire', 'selectPortfolios', { selected }));
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

// ---------- NOTIFICATIONS ----------

router.get('/notifications', (req, res) => {
  try {
    res.json(listNotifications({ unread: req.query.unread === 'true' }));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/notifications/:id/read', (req, res) => {
  try {
    const ok = markRead(req.params.id);
    if (!ok) return fail(res, 404, 'api.error.notificationNotFound');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/notifications/read-all', (req, res) => {
  try {
    res.json({ marked: markAllRead() });
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- SETTINGS ----------

router.get('/settings', (req, res) => {
  try {
    res.json(loadSettings());
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/settings', async (req, res) => {
  try {
    // The scheduler is torn down and rebuilt only when the schedules actually
    // moved. This used to run unconditionally, which was harmless while the only
    // things on this page were cron settings — but picking a theme now writes
    // here too, and rebuilding five cron jobs because someone tried Jacarina is
    // both wasteful and, if a job happens to be mid-run, worse than wasteful.
    //
    // A source instance carries its own schedule, so `modules` counts as well:
    // watching only `schedules` would silently ignore a second bank's cron.
    const before = loadSettings();
    const merged = saveSettings(req.body);
    const moved = (key) => JSON.stringify(before[key]) !== JSON.stringify(merged[key]);
    if (moved('schedules') || moved('modules')) await reloadScheduler();
    res.json(merged);
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- SCHEDULER / LLM ----------

router.post('/scheduler/run/:module', async (req, res) => {
  try {
    res.json(await runModule(req.params.module));
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/llm/models', async (req, res) => {
  try {
    res.json({ models: await listLlmModels() });
  } catch (err) {
    failFrom(res, err, 400);
  }
});

router.post('/llm/test', async (req, res) => {
  try {
    res.json(await testLlm());
  } catch (err) {
    failFrom(res, err, 400);
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
    // What left the accounts under each category, by its real category: the
    // Categories page used to borrow the dashboard's breakdown, which reads
    // trips as "travel" and — since investing left spending — would have shown
    // the investments category as €0. Internal moves stay out, as everywhere.
    const expense = new Map();
    for (const tx of projections.spendingTransactions) {
      const amount = Number(tx.amount) || 0;
      if (amount >= 0) continue;
      const name = tx.category || 'uncategorized';
      expense.set(name, (expense.get(name) || 0) + Math.abs(amount));
    }

    res.json(
      cats
        .map((c) => ({
          ...c,
          count: counts.get(c.name) || 0,
          expense: Math.round((expense.get(c.name) || 0) * 100) / 100,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    );
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, parent, icon } = req.body;
    const cat = createCategory(name, parent, icon);
    if (!cat) return fail(res, 409, 'api.error.categoryExists');
    res.json(cat);
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const result = await updateCategory(req.params.id, req.body || {});
    if (result.error === 'not_found') return fail(res, 404, 'api.error.categoryNotFound');
    if (result.error === 'protected') {
      return fail(res, 400, 'api.error.categoryProtectedRename');
    }
    if (result.error === 'duplicate') return fail(res, 409, 'api.error.categoryExists');
    // The projection reads the investing flag, so every total moves with it.
    if (result.flowChanged) invalidateProjections();
    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const result = await deleteCategory(req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'api.error.categoryNotFound');
    if (result.error === 'protected') {
      return fail(res, 400, 'api.error.categoryProtectedDelete');
    }
    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

// Impact preview for the delete confirmation.
router.get('/categories/:name/usage', async (req, res) => {
  try {
    res.json({ count: await countTransactionsInCategory(req.params.name) });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/categories/merge', async (req, res) => {
  try {
    const { target, source } = req.body;
    const ok = await mergeCategories(target, source);
    if (!ok) return fail(res, 404, 'api.error.sourceOrTargetNotFound');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/suggestions/:transactionId', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.transactionId);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');
    const ctx = buildSuggestionContext(projections.transactions);
    res.json({ transactionId: tx.id, suggestions: suggestForTransaction(tx, ctx) });
  } catch (err) {
    failFrom(res, err);
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
      return fail(res, 400, 'api.error.transactionIdsRequired');
    }
    if (!category) return fail(res, 400, 'api.error.categoryRequired');

    const projections = await getProjections();
    const sample = projections.transactions.find((t) => t.id === transactionIds[0]);

    const result = await applyCategorizationBulk(transactionIds, category);

    if (learn && sample && transactionIds.length >= 2) {
      noteCorrection(sample.description, sample.merchant, category);
    }

    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * Asks the local model about merchant groups nothing else could identify.
 * Returns suggestions for review — it never writes categories on its own.
 */
router.post('/suggest/llm', async (req, res) => {
  try {
    if (!llmEnabled()) {
      return fail(res, 400, 'api.error.llmDisabled');
    }
    const projections = await getProjections();
    const ctx = buildSuggestionContext(projections.transactions);
    const pending = projections.transactions.filter((t) => t.status === 'pending');
    const groups = groupByMerchant(pending, ctx, 'date_desc');

    const unknown = groups.filter((g) => (g.suggestions[0]?.confidence ?? 0) < 0.75);
    // Never a computed category: the model would be asked to guess a trip.
    const derived = derivedCategoryNames(getCategories());
    const categories = getCategories()
      .map((c) => c.name)
      .filter((n) => n !== 'uncategorized' && !derived.has(n));

    const classified = await classifyMerchantGroups(unknown, categories);
    res.json({
      asked: unknown.length,
      classified: classified.size,
      results: [...classified.entries()].map(([key, v]) => ({ key, ...v })),
    });
  } catch (err) {
    failFrom(res, err);
  }
});

// Lets the UI show whether the local model is usable before the user goes
// hunting through Settings for it.
router.get('/llm/status', (req, res) => {
  try {
    const { llm } = loadSettings();
    res.json({ enabled: !!llm?.enabled, model: llm?.model || '', baseUrl: llm?.baseUrl || '' });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/categorize', async (req, res) => {
  try {
    const { transactionId, category, confidence, ruleId } = req.body;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');

    const result = await applyCategorization(tx.id, category, confidence, ruleId);

    if (tx.status === 'pending' || tx.status === 'categorized') {
      noteCorrection(tx.description, tx.merchant, category);
    }

    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/categorize/override', async (req, res) => {
  try {
    const { transactionId, newCategory } = req.body;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');

    const result = await applyManualOverride(tx.id, tx.category, newCategory);
    noteCorrection(tx.description, tx.merchant, newCategory);

    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- RULES (v2) ENDPOINTS ----------

router.get('/rules', (req, res) => {
  try {
    res.json(getRulesV2().sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/rules', (req, res) => {
  try {
    res.json(createRule(req.body));
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/rules/:id', (req, res) => {
  try {
    const rule = updateRule(req.params.id, req.body);
    if (!rule) return fail(res, 404, 'api.error.ruleNotFound');
    res.json(rule);
  } catch (err) {
    failFrom(res, err);
  }
});

router.delete('/rules/:id', (req, res) => {
  try {
    const ok = deleteRule(req.params.id);
    if (!ok) return fail(res, 404, 'api.error.ruleNotFound');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/rules/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return fail(res, 400, 'api.error.orderedIdsMustBeArray');
    res.json(reorderRules(orderedIds));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/rules/run', async (req, res) => {
  try {
    const result = await runRules({ transactionIds: req.body?.transactionIds || null });
    res.json(result);
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

router.post('/rules/suggestions/accept', (req, res) => {
  try {
    res.json(createRule(req.body));
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

router.post('/advisor/pattern/accept', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'api.error.idRequired');

    const projections = await getProjections();
    const finding = patternCandidates(getRulesV2(), projections.transactions).find((f) => f.id === id);
    if (!finding) return fail(res, 404, 'api.error.patternNotFound');

    const result = applyPattern(finding);
    recordFeedback({ id: finding.id, kind: 'pattern', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    failFrom(res, err, 400);
  }
});

router.post('/advisor/collapse/accept', async (req, res) => {
  try {
    const projections = await getProjections();
    const candidate = collapseCandidates(getRulesV2(), projections.transactions).find(
      (c) => c.id === req.body?.id
    );
    if (!candidate) return fail(res, 404, 'api.error.suggestionNotFound');

    const result = applyCollapse(candidate, { force: req.body?.force === true });
    recordFeedback({
      id: candidate.id,
      kind: 'collapse',
      subject: candidate.subject,
      verdict: 'accepted',
    });
    res.json(result);
  } catch (err) {
    failFrom(res, err, 400);
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
    if (!id || !action) return fail(res, 400, 'api.error.idAndActionRequired');

    const projections = await getProjections();
    const finding = shadowedRules(getRulesV2(), projections.transactions).find((f) => f.id === id);
    if (!finding) return fail(res, 404, 'api.error.suggestionNotFound');

    const result = applyShadowedFix(finding, action, projections.transactions);
    recordFeedback({ id: finding.id, kind: 'shadowed', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    failFrom(res, err, 400);
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
    failFrom(res, err);
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
    failFrom(res, err, 400);
  }
});

router.post('/advisor/reject', (req, res) => {
  try {
    const { id, kind, subject, note } = req.body || {};
    if (!id) return fail(res, 400, 'api.error.idRequired');
    res.json(recordFeedback({ id, kind: kind || 'unknown', subject: subject || id, verdict: 'rejected', note }));
  } catch (err) {
    failFrom(res, err);
  }
});

// Accepting an anomaly means the majority category was right — recategorize.
router.post('/advisor/anomaly/accept', async (req, res) => {
  try {
    const { id, transactionId, category } = req.body || {};
    if (!transactionId || !category) {
      return fail(res, 400, 'api.error.transactionAndCategoryRequired');
    }
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === transactionId);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');

    const result = await applyManualOverride(tx.id, tx.category, category);
    if (id) recordFeedback({ id, kind: 'anomaly', subject: transactionId, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

// The other direction: the flagged transaction was right, the majority of its
// merchant group was wrong — move the group to match it instead.
router.post('/advisor/anomaly/inverse', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return fail(res, 400, 'api.error.idRequired');

    const projections = await getProjections();
    const finding = anomalyCandidates(projections.transactions).find((f) => f.id === id);
    if (!finding) return fail(res, 404, 'api.error.findingNotFound');

    const result = await applyAnomalyInverse(finding, projections.transactions);
    recordFeedback({ id: finding.id, kind: 'anomaly', subject: finding.subject, verdict: 'accepted' });
    res.json(result);
  } catch (err) {
    failFrom(res, err, 400);
  }
});

router.get('/advisor/feedback', (req, res) => {
  try {
    res.json(loadFeedback());
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- TAGS ENDPOINTS ----------

router.get('/tags', (req, res) => {
  try {
    res.json(loadTags());
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/tags', (req, res) => {
  try {
    const tag = createTag(req.body.name, { color: req.body.color, icon: req.body.icon });
    if (!tag) return fail(res, 409, 'api.error.subcategoryExists');
    res.json(tag);
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/tags/:id', (req, res) => {
  try {
    const tag = updateTag(req.params.id, req.body);
    if (!tag) return fail(res, 404, 'api.error.tagNotFound');
    res.json(tag);
  } catch (err) {
    failFrom(res, err);
  }
});

router.delete('/tags/:id', (req, res) => {
  try {
    const ok = deleteTag(req.params.id);
    if (!ok) return fail(res, 404, 'api.error.tagNotFound');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/transactions/:id/tags', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.id);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');
    if (tx.tags.includes(req.body.tagId)) return res.json({ success: true, alreadyTagged: true });
    emitTagAssignment(tx.id, req.body.tagId, 'manual');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
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
      return fail(res, 400, 'api.error.transactionIdsRequired');
    }
    if (!tagId) return fail(res, 400, 'api.error.tagIdRequired');
    if (!loadTags().some((t) => t.id === tagId)) {
      return fail(res, 404, 'api.error.tagNotFound');
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
    failFrom(res, err);
  }
});

router.delete('/transactions/:id/tags/:tagId', async (req, res) => {
  try {
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.id);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');
    emitTagRemoval(tx.id, req.params.tagId, 'manual');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- CORRELATIONS ----------

router.get('/correlation-rules', (req, res) => {
  try {
    res.json(loadCorrelationRules());
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/correlation-rules', async (req, res) => {
  try {
    // Which two sources a new rule joins by default is read from what is
    // installed, not from two provider names written into the engine.
    const defaults = defaultCorrelationSources(await sourceInstances({ includeDisabled: true }));
    res.json(createCorrelationRule(req.body, defaults));
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/correlation-rules/:id', (req, res) => {
  try {
    const rule = updateCorrelationRule(req.params.id, req.body);
    if (!rule) return fail(res, 404, 'api.error.ruleNotFound');
    res.json(rule);
  } catch (err) {
    failFrom(res, err);
  }
});

router.delete('/correlation-rules/:id', (req, res) => {
  try {
    const ok = deleteCorrelationRule(req.params.id);
    if (!ok) return fail(res, 404, 'api.error.ruleNotFound');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/correlations/run', async (req, res) => {
  try {
    res.json(await runCorrelations());
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/correlations', (req, res) => {
  try {
    let proposals = loadProposals();
    if (req.query.status) proposals = proposals.filter((p) => p.status === req.query.status);
    res.json(proposals);
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/correlations/:id/confirm', (req, res) => {
  try {
    const result = confirmProposal(req.params.id);
    if (!result) return fail(res, 404, 'api.error.proposalNotFound');
    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/correlations/:id/reject', (req, res) => {
  try {
    const proposal = rejectProposal(req.params.id);
    if (!proposal) return fail(res, 404, 'api.error.proposalNotFound');
    res.json(proposal);
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
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
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

/**
 * The category map every dashboard aggregate reads, trips folded in or not.
 *
 * `settings.analytics.travelOverlay` is the only switch, and it changes nothing
 * on disk: the transactions keep the categories they were given, the Travel page
 * and the per-trip card always show them, and turning the overlay off brings
 * them straight back.
 */
function analyticsCategoryMap(projections) {
  const settings = loadSettings();
  if (settings.analytics?.travelOverlay === false) return projections.categoryMap;
  return travelOverlay(projections.transactions, projections.categoryMap);
}

// ---------- TRAVEL ----------

router.get('/travels', async (req, res) => {
  try {
    const travels = loadTravels();
    const projections = await getProjections();
    // Each trip carries its own totals: a calendar entry with no money attached
    // to it is not worth confirming.
    //
    // What the trip *claimed*, not everything that happened between its dates.
    // Claims have been made by hand since the trip stopped stamping a category,
    // and a total of the whole window counted the rent, the salary and the gym
    // that happened to fall that week — a figure that described the calendar,
    // not the trip. `toReview` is what is left to decide on the trip's own
    // screen, late tail included, which is where a charge that posted four days
    // after coming home is found.
    res.json(
      travels.map((t) => {
        const claimed = t.tagId
          ? projections.transactions.filter((tx) => (tx.tags || []).includes(t.tagId))
          : [];
        const toReview = transactionsInTravel(t, projections.transactions, { includeLate: true }).filter(
          (tx) => !(tx.tags || []).includes(t.tagId) && Number(tx.amount) < 0,
        );
        return {
          ...t,
          countryName: countryName(t.country),
          window: travelWindow(t),
          reviewWindow: reviewWindow(t),
          transactionCount: claimed.length,
          total: claimed.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0),
          toReview: toReview.length,
        };
      })
    );
  } catch (err) {
    failFrom(res, err);
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
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');
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
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');
    // Untag before deleting: once the trip is gone there is nothing left that
    // knows which tag was its own.
    const { transactions } = await getProjections();
    const { untagged } = removeTravelTag(travel, transactions);
    deleteTravel(req.params.id);
    if (untagged) invalidateProjections();
    res.json({ success: true, untagged });
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

/**
 * One trip in detail — per day, per category, before/during/after — for the
 * dashboard's trip card. Real categories, never the overlay: this is the
 * screen that says what the trip was spent on.
 */
router.get('/travels/:id/summary', async (req, res) => {
  try {
    const travels = loadTravels();
    const travel = travels.find((t) => t.id === req.params.id);
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');
    const projections = await getProjections();
    res.json(tripDetail(travel, projections.spendingTransactions, projections.categoryMap, travels));
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/travels/:id/transactions', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');
    const projections = await getProjections();
    // The late tail is listed too, each row saying whether it falls after the
    // trip and, when it does, what makes it look like part of it.
    const signals = lateSignals(travel, projections.transactions);
    res.json(
      transactionsInTravel(travel, projections.transactions, { includeLate: true })
        // Past the margin only money going out is offered: the salary that
        // landed the week after a holiday is never part of it.
        .filter((tx) => String(tx.date).slice(0, 10) <= travelWindow(travel).to || Number(tx.amount) < 0)
        .map((tx) => {
          const after = String(tx.date).slice(0, 10) > travel.endDate;
          if (!after) return tx;
          return { ...tx, afterTrip: true, lateReason: signals.get(tx.id) || null };
        }),
    );
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * One transaction in or out of a trip.
 *
 * The trip only. This used to write the category too — `travel` on the way in,
 * `uncategorized` on the way out — which is why a fortnight abroad came back as
 * one undifferentiated number and why un-marking a mis-claimed rent payment left
 * it with no category at all. A trip is when and where money was spent; the
 * category is what it bought. Both fit on one transaction because tags have
 * always accumulated.
 */
router.post('/travels/:id/transactions/:txId', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');

    const on = req.body?.on !== false;
    const projections = await getProjections();
    const tx = projections.transactions.find((t) => t.id === req.params.txId);
    if (!tx) return fail(res, 404, 'api.error.transactionNotFound');

    const { tagId, changed } = markTransactionAsTravel(travel, tx, on);
    if (changed) invalidateProjections();

    res.json({ success: true, tagId, marked: on });
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * Claims everything inside a trip's window in one go — the shortcut for a trip
 * where nearly everything really did belong to it.
 *
 * It claims and never categorizes. `onlyUncategorized` used to mean "only touch
 * what has no category yet", which was the guard that stopped a bulk apply from
 * flattening decisions already made; with the category left alone there is
 * nothing to flatten, so the default is now the whole window. A line the trip
 * should not have claimed is one click to unclaim, and it keeps its category
 * either way.
 */
router.post('/travels/:id/apply', async (req, res) => {
  try {
    const travel = loadTravels().find((t) => t.id === req.params.id);
    if (!travel) return fail(res, 404, 'api.error.travelNotFound');

    const { onlyUncategorized = false } = req.body || {};
    // The trip may never have been opened, in which case its subcategory does
    // not exist yet. Ask for it rather than reading a field that can be null.
    const tagId = req.body?.tagId ?? syncTravelTag(travel).tagId;

    const projections = await getProjections();
    let targets = transactionsInTravel(travel, projections.transactions);
    if (onlyUncategorized) targets = targets.filter((t) => t.status === 'pending');

    const result = { matched: targets.length, categorized: 0, tagged: 0 };

    if (tagId) {
      for (const tx of targets) {
        if (!(tx.tags || []).includes(tagId)) {
          emitTagAssignment(tx.id, tagId, 'travel');
          result.tagged++;
        }
      }
      if (result.tagged) invalidateProjections();
    }

    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * What each trip cost, broken down by what it was actually spent on.
 *
 * Its own route rather than another field on `/analytics`: that response is in
 * the snapshot baseline, and it is also the one place that must *not* see the
 * real categories once the overlay is on. This is the other half of the trade —
 * the dashboard reads a holiday as travel so a year of food is still legible,
 * and this says the holiday was €1,000 of hotels, €600 of food and €400 of
 * transport.
 */
router.get('/travels/spending', async (req, res) => {
  try {
    const { from, to } = req.query;
    const projections = await getProjections();
    const transactions = filterTransactions(projections.spendingTransactions, {
      from,
      to,
      categoryMap: projections.categoryMap,
    });
    res.json({ trips: tripSpending(transactions, projections.categoryMap) });
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/travels/anomalies', async (req, res) => {
  try {
    const projections = await getProjections();
    const { missing, stray, legacy, late } = travelAnomalies(projections.transactions);
    res.json({
      missing: missing.slice(0, 200).map((m) => ({
        transaction: m.transaction,
        travelId: m.travel.id,
        travelName: m.travel.name,
      })),
      stray: stray.slice(0, 200).map((s) => s.transaction),
      // Charges after a trip that look like they came from it.
      late: late.slice(0, 200).map((l) => ({
        transaction: l.transaction,
        travelId: l.travel.id,
        travelName: l.travel.name,
        reason: l.reason,
      })),
      // Filed under the old "travel" category and claimed by no trip.
      legacy: legacy.slice(0, 200).map((l) => ({
        transaction: l.transaction,
        travelId: l.suggestion?.travel.id || null,
        travelName: l.suggestion?.travel.name || null,
        reason: l.suggestion?.reason || null,
      })),
      missingTotal: missing.length,
      strayTotal: stray.length,
      lateTotal: late.length,
      legacyTotal: legacy.length,
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/** "Nothing to do with any trip" — takes a movement off the late and legacy
    lists for good, without touching the movement itself. */
router.post('/travels/dismiss', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return fail(res, 400, 'api.error.transactionIdsRequired');
    res.json({ dismissed: dismissFromTravel(ids) });
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
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
    if (!group) return fail(res, 404, 'api.error.groupNotFound');
    res.json(await verifyAgainstDocument(group));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/duplicates/void', async (req, res) => {
  try {
    const { transactionIds, keepId } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return fail(res, 400, 'api.error.transactionIdsRequired');
    }
    const toVoid = [...new Set(transactionIds)].filter((id) => id !== keepId);
    // Nothing left to void is not an error: the group had already collapsed to a
    // single movement, which is exactly the state the user was asking for. Say
    // so and let the screen refresh rather than showing them a red failure.
    if (toVoid.length === 0) return res.json({ voided: 0, collapsed: true });
    res.json(await voidTransactions(toVoid, { reason: 'duplicate', duplicateOf: keepId || null }));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/duplicates/restore', async (req, res) => {
  try {
    const { transactionIds } = req.body || {};
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return fail(res, 400, 'api.error.transactionIdsRequired');
    }
    res.json(await restoreTransactions(transactionIds));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/duplicates/dismiss', (req, res) => {
  try {
    if (!req.body?.key) return fail(res, 400, 'api.error.keyRequired');
    dismissGroup(req.body.key);
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/duplicates/voided', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(projections.voidedTransactions);
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- INVESTMENTS (CS2 / Pricempire) ----------

router.post('/investments/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'api.error.noFiles');
    const files = [{ filename: req.file.originalname, buffer: req.file.buffer }];
    res.json(await invokeModule('pricempire', 'upload', files));
  } catch (err) {
    failFrom(res, err, 400);
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
    failFrom(res, err);
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
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

router.put('/securities', (req, res) => {
  try {
    if (!Array.isArray(req.body)) return fail(res, 400, 'api.error.expectedArray');
    res.json(saveSecurities(req.body));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/securities/link', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(await linkSecurityOrders(projections.securityOrders || [], projections.transactions));
  } catch (err) {
    failFrom(res, err);
  }
});

router.post('/securities/quotes/refresh', async (req, res) => {
  try {
    res.json(await refreshQuotes({ force: req.body?.force === true }));
  } catch (err) {
    failFrom(res, err, 400);
  }
});

/** What the app is converting with, and how old it is. The single-pair pair of
    routes is kept byte-for-byte: it is in the snapshot baseline, and the table
    below is additive rather than a replacement. */
router.get('/currency/rate', (req, res) => {
  res.json(currentRate());
});

router.post('/currency/rate/refresh', async (req, res) => {
  try {
    res.json(await refreshRate({ force: req.body?.force === true }));
  } catch (err) {
    failFrom(res, err, 400);
  }
});

/** The whole table: what is fetched, what was typed by hand, and how old it is. */
router.get('/currency/rates', (req, res) => {
  res.json({ ...currentRates(), base: loadSettings().currency?.base || 'EUR', currencies: currencyCodes() });
});

router.post('/currency/rates/refresh', async (req, res) => {
  try {
    res.json(await refreshRates({ force: req.body?.force === true }));
  } catch (err) {
    failFrom(res, err, 400);
  }
});

/**
 * Type a rate, or clear one back to the fetched value.
 *
 * A manual rate is a separate map rather than a write into `rates`, so a refresh
 * can leave it alone without having to remember which rows a person touched.
 */
router.put('/currency/rates/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!isKnownCurrency(code) || code === 'EUR') return fail(res, 400, 'api.error.unknownCurrency');

  const settings = loadSettings();
  const manual = { ...settings.currency.manual };
  const value = req.body?.rate;

  if (value == null || value === '') delete manual[code];
  else if (!Number.isFinite(Number(value)) || Number(value) <= 0) return fail(res, 400, 'api.error.badRate');
  else manual[code] = Number(value);

  saveSettings({ currency: { ...settings.currency, manual } });
  res.json(currentRates());
});

router.post('/securities/price', async (req, res) => {
  try {
    const { symbol, price, currency } = req.body || {};
    if (!symbol || price == null) return fail(res, 400, 'api.error.symbolAndPriceRequired');
    await recordManualPrice(symbol, price, currency || 'EUR');
    res.json({ success: true });
  } catch (err) {
    failFrom(res, err);
  }
});

// ---------- ASSETS ENDPOINTS ----------

router.get('/assets', async (req, res) => {
  try {
    const projections = await getProjections();
    res.json(projections.assets);
  } catch (err) {
    failFrom(res, err);
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
  const { priorFrom, priorTo } = priorSpan(from, to);
  return all.filter((t) => {
    const d = String(t.date).slice(0, 10);
    return d >= priorFrom && d <= priorTo;
  });
}

router.get('/analytics', async (req, res) => {
  try {
    const { from, to } = req.query;
    const categories = req.query.categories ? String(req.query.categories).split(',') : null;

    const projections = await getProjections();
    /* The overlay, applied once here and nowhere else.
     *
     * Every aggregate below resolves a category the same way — the map first,
     * the transaction's own second — so folding the trips into the map is the
     * whole of the feature. There is no branch in `computeCategoryBreakdown`, no
     * second one in `computeCategoryTrend`, and therefore no fifth copy of the
     * rule to drift out of agreement with the other four. */
    const categorizedMap = analyticsCategoryMap(projections);
    const all = projections.spendingTransactions;
    const transactions = filterTransactions(all, {
      from,
      to,
      categories,
      categoryMap: categorizedMap,
    });
    // Everything that describes *spending* is drawn from what was consumed;
    // only the cashflow sees both halves, and keeps investing in its own column.
    const { consumption } = splitFlows(transactions);

    const dates = all.map((t) => (t.date || '').slice(0, 10)).filter(Boolean).sort();
    const earliest = dates[0] || null;
    const latest = dates[dates.length - 1] || null;
    const today = new Date().toISOString().slice(0, 10);

    // `auto` picks the bucket from the length of the range; anything else is the
    // reader's own choice. A request with no granularity at all still means
    // monthly, which is what it always meant.
    const granularity = resolveGranularity(req.query.granularity || 'month', { from, to, earliest, latest, today });
    // The holes in a fine-grained range are filled up to today, never into the
    // future: the rest of this month is not a fortnight of zero spending.
    const bounds = {
      from: from || earliest,
      to: [to || today, today].sort()[0],
    };

    const monthlyCashflow = computeMonthlyCashflow(transactions, granularity, bounds);
    // The projection and the insights are about calendar months whatever the
    // chart is bucketed by: "this month, projected" cannot be read off a weekly
    // series, and a daily one would make every quiet Sunday an anomaly.
    const calendarMonths =
      granularity === 'month' ? monthlyCashflow : computeMonthlyCashflow(transactions, 'month');
    const categoryBreakdown = computeCategoryBreakdown(consumption, categorizedMap);
    const amortized = computeAmortizedView(consumption);
    const netWorth = computeNetWorthEvolution(projections.assetSnapshots);
    const allocation = computeAssetAllocation(projections.assets);
    const roi = computeROI(projections.assets);
    const insights = computeInsights(consumption, categorizedMap, calendarMonths);

    // The same span again, immediately before this one, so every figure can be
    // shown against what it was rather than on its own.
    const previousAll = previousPeriod(transactions, all, { from, to });
    const previous = splitFlows(previousAll).consumption;
    const shifts = computeCategoryShifts(consumption, previous, categorizedMap);
    // The headline tiles' "against the period before", measured on the period
    // before rather than guessed from the two halves of this one — which, over
    // a month drawn by day, compared the half with the salary in it to the half
    // without and called the difference "−100%".
    // Not offered when the period before reaches back past the first movement on
    // file: a span the history does not cover is not a span of zero spending,
    // and "+300% against the period before" over a ledger that starts halfway
    // through it is a comparison with nothing.
    const prior =
      from && to && earliest && priorSpan(from, to).priorFrom >= earliest
        ? computeMonthlyCashflow(
            filterTransactions(previousAll, { categories, categoryMap: categorizedMap }),
            'year',
          ).reduce(
            (sum, row) => ({
              income: sum.income + row.income,
              expense: sum.expense + row.expense,
              invested: sum.invested + row.invested,
            }),
            { income: 0, expense: 0, invested: 0 },
          )
        : null;
    const projection = projectCurrentMonth(calendarMonths);
    const fine = granularity === 'day' || granularity === 'week';

    res.json({
      range: {
        from: from || null,
        to: to || null,
        granularity,
        earliest,
        latest,
        matched: transactions.length,
        total: all.length,
      },
      monthlyCashflow,
      cumulative: computeCumulativeBalance(monthlyCashflow),
      savingsRate: computeSavingsRate(monthlyCashflow, { cumulative: fine }),
      categoryTrend: computeCategoryTrend(consumption, categorizedMap, granularity, 8, bounds),
      topMerchants: computeTopMerchants(consumption),
      categoryBreakdown,
      amortized,
      netWorth,
      allocation,
      roi,
      insights,
      shifts,
      previous: prior && { ...priorSpan(from, to), ...prior },
      projection,
      vaults: projections.vaults,
      vaultTotal: projections.vaultTotal,
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * The two aggregates the Money flow and Spending calendar cards need.
 *
 * Separate routes rather than two more fields on `/analytics`, deliberately.
 * That response is in the snapshot baseline, and every read-only endpoint being
 * byte-identical after a refactor is what makes `npm run snapshot:verify` a
 * signal rather than a diff to skim. New endpoints sit outside the baseline the
 * way `/api/modules/*` already does, and neither of these is wanted by a page
 * that has the flag switched off.
 */
router.get('/analytics/flow', async (req, res) => {
  try {
    const { from, to } = req.query;
    const projections = await getProjections();
    const categoryMap = analyticsCategoryMap(projections);
    const transactions = filterTransactions(projections.spendingTransactions, {
      from,
      to,
      categoryMap,
    });
    res.json(computeFlow(transactions, categoryMap));
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/analytics/daily', async (req, res) => {
  try {
    const { from, to } = req.query;
    const projections = await getProjections();
    const categoryMap = analyticsCategoryMap(projections);
    const transactions = filterTransactions(projections.spendingTransactions, {
      from,
      to,
      categoryMap,
    });
    res.json({ days: computeDailySpend(transactions, categoryMap), from: from || null, to: to || null });
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * Spending pace: one month built up day by day, against the month before it
 * and a typical month. Its own route for the same reason as the two above.
 * `month` defaults to the current one; `categories` narrows it the way the
 * dashboard's category filter narrows everything else.
 */
router.get('/analytics/pace', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : today.slice(0, 7);
    const categories = req.query.categories ? String(req.query.categories).split(',') : null;
    const projections = await getProjections();
    const categoryMap = analyticsCategoryMap(projections);
    const all = projections.spendingTransactions;
    const transactions = filterTransactions(all, { categories, categoryMap });
    const earliest = all.map((t) => String(t.date || '').slice(0, 10)).filter(Boolean).sort()[0] || null;
    res.json(computePace(transactions, month, { today, earliest }));
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * Recurring money, inferred from the ledger: the bills calendar and the
 * forecast both read it. `days` is how far ahead the upcoming list runs.
 */
router.get('/recurring', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const days = Math.min(Math.max(Number(req.query.days) || 35, 1), 366);
    const projections = await getProjections();
    const { ignored } = loadRecurringState();
    const all = detectRecurring(projections.spendingTransactions, { today });
    const ignoredSet = new Set(ignored);
    const series = all.filter((s) => !ignoredSet.has(s.id));
    const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    res.json({
      today,
      to: horizon,
      series,
      upcoming: occurrences(series, today, horizon),
      ignored: all.filter((s) => ignoredSet.has(s.id)),
      monthlyIn: Math.round(series.filter((s) => s.amount > 0).reduce((sum, s) => sum + s.monthly, 0) * 100) / 100,
      monthlyOut: Math.round(-series.filter((s) => s.amount < 0).reduce((sum, s) => sum + s.monthly, 0) * 100) / 100,
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/** "Not a bill" — and back. Reversible, and touches nothing in the ledger. */
router.post('/recurring/:id/ignore', (req, res) => {
  try {
    res.json(setIgnored(req.params.id, req.body?.ignored !== false));
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * The typical month over the last twelve complete ones, and the planning
 * assumptions, for the runway and financial-independence card. Holdings come
 * from /networth on the client, which is where currencies are converted.
 */
router.get('/analytics/runway', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const projections = await getProjections();
    res.json({
      ...typicalMonth(projections.spendingTransactions, { today }),
      planning: loadSettings().planning,
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * Monthly goals per category: how this month (or `month`) stands against each,
 * and a suggested goal for every category from its usual month.
 */
router.get('/budgets', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : today.slice(0, 7);
    const projections = await getProjections();
    const { ignored } = loadRecurringState();
    const series = detectRecurring(projections.spendingTransactions, { today, ignored });
    res.json(
      budgetReport(projections.spendingTransactions, getCategories(), loadGoals(), { month, today, series }),
    );
  } catch (err) {
    failFrom(res, err);
  }
});

router.put('/budgets/:categoryId', (req, res) => {
  try {
    if (!getCategories().some((c) => c.id === req.params.categoryId)) {
      return fail(res, 404, 'api.error.categoryNotFound');
    }
    res.json({ goals: setGoal(req.params.categoryId, req.body?.amount) });
  } catch (err) {
    failFrom(res, err);
  }
});

/*
 * The cash forecast: today's balance, the last thirty days behind it, and the
 * next `days` ahead from recurring items plus everyday spending.
 */
router.get('/analytics/forecast', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 365);
    const projections = await getProjections();
    const { ignored } = loadRecurringState();
    const series = detectRecurring(projections.spendingTransactions, { today, ignored });
    res.json(
      forecastCash({
        accounts: projections.accounts,
        transactions: projections.transactions,
        spending: projections.spendingTransactions,
        series,
        today,
        days,
      }),
    );
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/analytics/cashflow', async (req, res) => {
  try {
    const projections = await getProjections();
    const result = computeMonthlyCashflow(projections.spendingTransactions);
    res.json(result);
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/analytics/insights', async (req, res) => {
  try {
    const projections = await getProjections();
    const cashflow = computeMonthlyCashflow(projections.spendingTransactions);
    const insights = computeInsights(
      splitFlows(projections.spendingTransactions).consumption,
      projections.categoryMap,
      cashflow
    );
    res.json(insights);
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

/**
 * Everything the ledger knows is held, by kind.
 *
 * Its own route rather than a field on `/accounts`: that response is in the
 * snapshot baseline, and this is a different question anyway — `/accounts` is
 * about the bank, and half of what this returns is not in one.
 */
router.get('/networth', async (req, res) => {
  try {
    const projections = await getProjections();
    const settings = loadSettings();
    res.json(computeNetWorth(projections, settings, settings.currency?.base || 'EUR'));
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

router.put('/accounts/profile', (req, res) => {
  try {
    const settings = loadSettings();
    const merged = saveSettings({ internal: { ...settings.internal, profile: req.body?.profile || null } });
    invalidateProjections();
    res.json({ profile: merged.internal.profile });
  } catch (err) {
    failFrom(res, err);
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
    // Previewing a candidate profile applies it to one institution and leaves
    // the others reading their own wording — otherwise the preview for a second
    // bank would report every movement at the first one as unrecognised, which
    // is a scary and completely false answer.
    const instance = req.body?.instance ?? null;
    const profiles = {};
    if (instance) {
      for (const other of await instancesOfFamily('bank', { includeDisabled: true })) {
        profiles[other.id] = other.config?.profile ?? null;
      }
      profiles[instance] = req.body?.profile || null;
    }

    const result = analyzeAccounts(projections.transactions, {
      selfNames,
      windowDays: settings.internal?.windowDays ?? 3,
      profile: req.body?.profile || null,
      profiles: instance ? profiles : null,
    });
    res.json({
      internalMovements: result.movements.length,
      vaults: result.vaults.map((v) => ({ vault: v.vault, balance: v.balance })),
      accountsFound: result.accounts.length,
      reconciled: result.reconciliation?.balanced ?? null,
    });
  } catch (err) {
    failFrom(res, err, 400);
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
    if (!from) return fail(res, 400, 'api.error.fromRequired');

    const settings = loadSettings();
    const vaultAliases = { ...(settings.internal?.vaultAliases || {}) };
    if (to) vaultAliases[from] = to;
    else delete vaultAliases[from];

    saveSettings({ internal: { ...settings.internal, vaultAliases } });
    invalidateProjections();

    const projections = await getProjections();
    res.json({ vaultAliases, vaults: projections.vaults, vaultTotal: projections.vaultTotal });
  } catch (err) {
    failFrom(res, err);
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
    failFrom(res, err);
  }
});

export default router;
