import { Router } from 'express';
import multer from 'multer';
import { ingestManualTransaction, ingestManualAsset } from '../ingestion/manual.js';
import { ingestActivobank, reprocessStoredDocuments } from '../ingestion/activobank/index.js';
import { loadSyncState } from '../ingestion/activobank/gmail.js';
import { ingestPricempire, fetchPortfolioList } from '../ingestion/pricempire/index.js';
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
  learnFromCorrection,
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
  computeMonthlyCashflow,
  computeCategoryBreakdown,
  computeNetWorthEvolution,
  computeAssetAllocation,
  computeROI,
  computeInsights,
  computeCategoryTrend,
  computeTopMerchants,
  computeCumulativeBalance,
  computeSavingsRate,
  filterTransactions,
} from '../engines/analytics.js';
import { getProjections } from '../projections/cache.js';
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

router.post('/ingest/pricempire', async (req, res) => {
  try {
    const result = await ingestPricempire();
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

router.get('/categories', (req, res) => {
  try {
    ensureDefaultCategories();
    const cats = getCategories();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, parent } = req.body;
    const cat = createCategory(name, parent);
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
      learnFromCorrection(sample.description, sample.merchant, category);
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
      learnFromCorrection(tx.description, tx.merchant, category);
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
    learnFromCorrection(tx.description, tx.merchant, newCategory);

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
    const tag = createTag(req.body.name, req.body.color);
    if (!tag) return res.status(409).json({ error: 'Tag already exists' });
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

router.get('/transactions', async (req, res) => {
  try {
    const projections = await getProjections();
    let transactions = projections.transactions;

    const { status, search, startDate, endDate } = req.query;

    if (status) {
      transactions = transactions.filter((t) => t.status === status);
    }
    if (search) {
      const q = search.toLowerCase();
      transactions = transactions.filter(
        (t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q)
      );
    }
    if (startDate) {
      transactions = transactions.filter((t) => (t.date || '') >= startDate);
    }
    if (endDate) {
      transactions = transactions.filter((t) => (t.date || '') <= endDate);
    }

    res.json(transactions);
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
    res.json({
      summary: computeSummary(positions),
      positions,
      byMarketplace: computeByMarketplace(investments),
      cashTimeline: computeCashTimeline(investments),
      valueTimeline: computeValueTimeline(projections.assetSnapshots),
      transactionCount: investments.length,
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
router.get('/analytics', async (req, res) => {
  try {
    const { from, to, granularity = 'month' } = req.query;
    const categories = req.query.categories ? String(req.query.categories).split(',') : null;

    const projections = await getProjections();
    const categorizedMap = projections.categoryMap;
    const all = projections.transactions;
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/cashflow', async (req, res) => {
  try {
    const projections = await getProjections();
    const result = computeMonthlyCashflow(projections.transactions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/insights', async (req, res) => {
  try {
    const projections = await getProjections();
    const cashflow = computeMonthlyCashflow(projections.transactions);
    const insights = computeInsights(
      projections.transactions,
      projections.categoryMap,
      cashflow
    );
    res.json(insights);
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
