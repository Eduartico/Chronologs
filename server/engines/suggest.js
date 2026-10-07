/**
 * Unified categorization suggestions.
 *
 * The previous implementation only matched against rules the user had already
 * accepted, so a fresh ledger produced zero suggestions for every transaction.
 * This engine draws on four sources, strongest first:
 *
 *   history   — the same merchant was already categorized by the user
 *   travel    — the date falls inside a trip on the calendar
 *   rules     — the user's own rules (rules.js)
 *   templates — merchant templates, applied directly instead of only being
 *               offered as rules to accept
 *   keywords  — a Portuguese lexicon ("universidade" -> education)
 *
 * Building the context is the expensive part (it indexes the whole ledger), so
 * callers build it once and reuse it across a batch.
 */
import { loadTemplates, loadKeywords, matchesPattern } from '../config/knowledge.js';
import { cleanDescription, normalizeMerchantKey, stripAccents } from '../lib/merchant.js';
import { loadRules, ruleMatches } from './rules.js';
import { loadTravels, travelWindow } from './travel.js';
import { loadCategories } from '../ledger/fileStore.js';
import { derivedCategoryNames } from '../lib/derivedCategories.js';

export { cleanDescription, normalizeMerchantKey };

const CONFIDENCE = {
  historyManual: 0.95,
  historyAuto: 0.88,
  template: 0.85,
  // Being abroad on a trip is strong evidence, but weaker than having filed the
  // same merchant by hand: a supermarket run during a holiday is still
  // groceries if that is what you called it last time.
  travel: 0.82,
};

function haystackFor(tx) {
  return stripAccents(`${tx.description || ''} ${tx.merchant || ''}`).toLowerCase();
}

/**
 * Indexes everything the per-transaction lookups need. `transactions` should be
 * the full projection so already-categorized history can inform pending ones.
 */
export function buildSuggestionContext(transactions = [], { travels = loadTravels() } = {}) {
  const history = new Map();

  for (const tx of transactions) {
    if (!tx.category || tx.category === 'uncategorized') continue;
    if (tx.status !== 'categorized' && tx.status !== 'overridden') continue;
    const { key } = normalizeMerchantKey(tx);
    const entry = history.get(key) || { counts: new Map(), manual: new Set() };
    entry.counts.set(tx.category, (entry.counts.get(tx.category) || 0) + 1);
    if (tx.overridden) entry.manual.add(tx.category);
    history.set(key, entry);
  }

  return {
    history,
    rules: loadRules()
      .filter((r) => r.enabled && r.actions?.setCategory)
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    templates: loadTemplates(),
    keywords: loadKeywords(),
    // Windows rather than a per-transaction index, so the context stays useful
    // for a transaction that was not in the list it was built from.
    travelWindows: travels
      .filter((t) => t.status !== 'rejected')
      .map((t) => ({ travel: t, ...travelWindow(t) })),
    llmByKey: new Map(),
    derived: derivedCategoryNames(loadCategories()),
  };
}

export function suggestForTransaction(tx, ctx) {
  const found = new Map();
  const add = (category, confidence, source, reason) => {
    if (!category || category === 'uncategorized') return;
    // Never offered: a trip is recorded by the Travel page, not by a category.
    if (ctx.derived?.has(category)) return;
    const existing = found.get(category);
    if (!existing || existing.confidence < confidence) {
      found.set(category, { category, confidence, source, reason });
    }
  };

  const { key } = normalizeMerchantKey(tx);
  const haystack = haystackFor(tx);

  const hist = ctx.history.get(key);
  if (hist) {
    for (const [category, count] of hist.counts) {
      const manual = hist.manual.has(category);
      add(
        category,
        manual ? CONFIDENCE.historyManual : CONFIDENCE.historyAuto,
        'history',
        `já categorizaste ${count}x como ${category}`
      );
    }
  }

  /*
   * A trip no longer suggests a category, and deliberately does not.
   *
   * It used to suggest `travel` at a confidence high enough to outrank a rule or
   * a keyword, on the reasoning that the calendar was the user's own answer
   * about those dates. The calendar *is* their answer — about the dates. It says
   * nothing about what the money bought, and letting it win meant the one period
   * where the keywords had the most to offer, a fortnight of unfamiliar foreign
   * merchants, was the one period where they were silenced. Every hotel, taxi
   * and restaurant abroad came back as "travel" and the trip's own breakdown
   * became a single bar.
   *
   * The trip is still recorded, as a tag, by the Travel page. Here it is simply
   * not evidence about the category.
   */

  const llm = ctx.llmByKey.get(key);
  if (llm) add(llm.category, llm.confidence ?? 0.8, 'llm', 'sugestão do modelo local');

  for (const rule of ctx.rules) {
    if (!ruleMatches(tx, rule, { lenient: true })) continue;
    add(rule.actions.setCategory, rule.confidence ?? 0.7, 'rule', `regra "${rule.name}"`);
  }

  for (const tpl of ctx.templates) {
    const hit = tpl.patterns.find((p) => matchesPattern(haystack, p));
    if (hit) add(tpl.category, CONFIDENCE.template, 'template', `${tpl.name} ("${hit}")`);
  }

  for (const group of ctx.keywords) {
    const hit = group.patterns.find((p) => matchesPattern(haystack, p));
    if (hit) add(group.category, group.weight, 'keyword', `palavra-chave "${hit.trim()}"`);
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

/** The trip covering this transaction's date, if the calendar knows of one. */
function tripFor(tx, ctx) {
  if (!ctx.travelWindows?.length) return null;
  const date = String(tx.date || '').slice(0, 10);
  if (!date) return null;
  return ctx.travelWindows.find((w) => date >= w.from && date <= w.to)?.travel || null;
}

const SORTERS = {
  date_desc: (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
  date_asc: (a, b) => String(a.date || '').localeCompare(String(b.date || '')),
  amount_desc: (a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0),
  amount_asc: (a, b) => Math.abs(a.amount || 0) - Math.abs(b.amount || 0),
};

export function sortTransactions(transactions, sort = 'date_desc') {
  return [...transactions].sort(SORTERS[sort] || SORTERS.date_desc);
}

/**
 * Collapses pending transactions into one card per merchant so a few hundred
 * rows can be cleared in a handful of clicks. Groups are ordered by the sort
 * key applied to their most recent transaction, so `date_desc` surfaces what
 * the user actually remembers spending.
 */
export function groupByMerchant(transactions, ctx, sort = 'date_desc') {
  const groups = new Map();

  for (const tx of transactions) {
    const { key, label } = normalizeMerchantKey(tx);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label,
        count: 0,
        total: 0,
        dateFrom: tx.date,
        dateTo: tx.date,
        transactionIds: [],
        sample: tx,
        suggestions: suggestForTransaction(tx, ctx),
      };
      groups.set(key, group);
    }
    group.count++;
    group.total += typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0;
    group.transactionIds.push(tx.id);
    if (tx.date && (!group.dateFrom || tx.date < group.dateFrom)) group.dateFrom = tx.date;
    if (tx.date && (!group.dateTo || tx.date > group.dateTo)) group.dateTo = tx.date;
  }

  const sorter = SORTERS[sort] || SORTERS.date_desc;
  return [...groups.values()]
    .map((g) => ({ ...g, sample: { ...g.sample, date: g.dateTo } }))
    .sort((a, b) => {
      if (sort.startsWith('amount')) {
        return sorter({ amount: a.total }, { amount: b.total });
      }
      return sorter({ date: a.dateTo }, { date: b.dateTo });
    });
}
