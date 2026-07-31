import { v4 as uuidv4 } from 'uuid';
import { loadRules as loadRawRules, saveRules as saveRawRules } from '../ledger/fileStore.js';
import { createEvent, appendEvent } from '../ledger/eventStore.js';
import { getProjections } from '../projections/cache.js';
import { applyCategorization } from './categorization.js';
import { loadTemplates } from '../config/knowledge.js';
import { cleanDescription } from '../lib/merchant.js';

// ---------- storage & v1 -> v2 migration ----------

function migrateV1(v1Rules) {
  const sorted = [...v1Rules].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return sorted.map((r, i) => ({
    id: uuidv4(),
    name: r.pattern,
    order: (i + 1) * 10,
    enabled: true,
    stopProcessing: false,
    conditions: {
      text: [
        {
          field: r.field === 'merchant' || r.field === 'description' ? r.field : 'any',
          op: 'contains',
          value: r.pattern,
        },
      ],
    },
    actions: { setCategory: r.category, addTags: [] },
    origin: 'learned',
    confidence: r.confidence ?? 0.7,
    created: r.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
}

export function loadRules() {
  const raw = loadRawRules();
  if (Array.isArray(raw)) {
    // v1 format — migrate once and persist
    const rules = migrateV1(raw);
    saveRawRules({ version: 2, rules });
    return rules;
  }
  return raw.rules || [];
}

export function saveRules(rules) {
  saveRawRules({ version: 2, rules });
}

function nextOrder(rules) {
  return rules.reduce((max, r) => Math.max(max, r.order || 0), 0) + 10;
}

export function createRule(input) {
  const rules = loadRules();
  const rule = {
    id: uuidv4(),
    name: input.name || 'Unnamed rule',
    order: input.order ?? nextOrder(rules),
    enabled: input.enabled ?? true,
    stopProcessing: input.stopProcessing ?? false,
    conditions: input.conditions || {},
    actions: {
      setCategory: input.actions?.setCategory || null,
      addTags: input.actions?.addTags || [],
    },
    origin: input.origin || 'user',
    confidence: input.confidence ?? 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  rules.push(rule);
  saveRules(rules);
  return rule;
}

export function updateRule(id, patch) {
  const rules = loadRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  const { id: _ignore, created, ...rest } = patch;
  Object.assign(rule, rest, { updated: new Date().toISOString() });
  saveRules(rules);
  return rule;
}

export function deleteRule(id) {
  const rules = loadRules();
  const filtered = rules.filter((r) => r.id !== id);
  if (filtered.length === rules.length) return false;
  saveRules(filtered);
  return true;
}

export function reorderRules(orderedIds) {
  const rules = loadRules();
  const byId = new Map(rules.map((r) => [r.id, r]));
  let order = 10;
  for (const id of orderedIds) {
    const rule = byId.get(id);
    if (rule) {
      rule.order = order;
      order += 10;
    }
  }
  saveRules(rules);
  return rules.sort((a, b) => a.order - b.order);
}

// ---------- evaluation ----------

function matchText(tx, cond) {
  const fields =
    cond.field === 'merchant'
      ? [tx.merchant]
      : cond.field === 'description'
        ? [tx.description]
        : [tx.description, tx.merchant];
  const value = String(cond.value || '').toLowerCase();
  if (!value) return false;

  return fields.some((f) => {
    const text = String(f || '').toLowerCase();
    if (!text) return false;
    if (cond.op === 'equals') return text === value;
    if (cond.op === 'regex') {
      try {
        return new RegExp(cond.value, 'i').test(String(f || ''));
      } catch {
        return false;
      }
    }
    return text.includes(value); // default: contains
  });
}

/**
 * Evaluates one rule's conditions against a transaction. Condition groups AND
 * together; entries inside `text` OR together. Groups referencing fields the
 * pseudo-transaction lacks (date/amount/source = null) are skipped when
 * `lenient` — used for suggestion lookups where only text is known.
 */
export function ruleMatches(tx, rule, { lenient = false } = {}) {
  const c = rule.conditions || {};

  if (c.text && c.text.length > 0) {
    if (!c.text.some((cond) => matchText(tx, cond))) return false;
  }

  if (c.dateRange && (c.dateRange.from || c.dateRange.to)) {
    if (tx.date == null) {
      if (!lenient) return false;
    } else {
      const d = String(tx.date).slice(0, 10);
      if (c.dateRange.from && d < c.dateRange.from) return false;
      if (c.dateRange.to && d > c.dateRange.to) return false;
    }
  }

  if (c.amountRange && (c.amountRange.min != null || c.amountRange.max != null)) {
    if (tx.amount == null) {
      if (!lenient) return false;
    } else {
      const abs = Math.abs(tx.amount);
      if (c.amountRange.min != null && abs < c.amountRange.min) return false;
      if (c.amountRange.max != null && abs > c.amountRange.max) return false;
    }
  }

  if (c.direction && c.direction !== 'any') {
    if (tx.amount == null) {
      if (!lenient) return false;
    } else if (c.direction === 'debit' && tx.amount >= 0) return false;
    else if (c.direction === 'credit' && tx.amount < 0) return false;
  }

  if (c.sources && c.sources.length > 0) {
    if (tx.source == null) {
      if (!lenient) return false;
    } else if (!c.sources.includes(tx.source)) return false;
  }

  return true;
}

/**
 * Walks enabled rules in execution order, accumulating actions. A matching
 * rule with stopProcessing halts the walk (Outlook-style).
 */
export function evaluateRules(tx, rules = null) {
  const list = (rules || loadRules())
    .filter((r) => r.enabled)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const result = { category: null, categoryRuleId: null, tags: [], matchedRules: [] };

  for (const rule of list) {
    if (!ruleMatches(tx, rule)) continue;
    result.matchedRules.push(rule.id);
    if (rule.actions?.setCategory && result.category === null) {
      result.category = rule.actions.setCategory;
      result.categoryRuleId = rule.id;
    }
    for (const tagId of rule.actions?.addTags || []) {
      if (!result.tags.includes(tagId)) result.tags.push(tagId);
    }
    if (rule.stopProcessing) break;
  }

  return result;
}

// ---------- continuous execution ----------

export function emitTagAssignment(transactionId, tagId, source = 'rule', ruleId = null) {
  // `at` keeps each assignment event unique so a manual re-add after a removal
  // isn't swallowed by the ledger's content-hash dedup; idempotency is
  // enforced here by only emitting for tags the transaction doesn't have.
  const ev = createEvent('tag_assignment', source, {
    transaction_id: transactionId,
    tag_id: tagId,
    rule_id: ruleId,
    at: new Date().toISOString(),
  });
  appendEvent(ev);
  return ev;
}

export function emitTagRemoval(transactionId, tagId, source = 'manual') {
  const ev = createEvent('tag_removal', source, {
    transaction_id: transactionId,
    tag_id: tagId,
    at: new Date().toISOString(),
  });
  appendEvent(ev);
  return ev;
}

/**
 * Runs the rule engine over transactions (all, or just the given ids).
 * - Never touches transactions with a manual_override (manual always wins).
 * - Only emits events when something actually changes → idempotent.
 */
export async function runRules({ transactionIds = null } = {}) {
  const rules = loadRules();
  const projections = await getProjections();
  const targets = transactionIds
    ? projections.transactions.filter((t) => transactionIds.includes(t.id))
    : projections.transactions;

  const result = { evaluated: targets.length, categorized: 0, tagged: 0 };

  for (const tx of targets) {
    const outcome = evaluateRules(tx, rules);

    if (
      outcome.category &&
      !tx.overridden &&
      outcome.category !== tx.category
    ) {
      await applyCategorization(tx.id, outcome.category, 1, outcome.categoryRuleId, 'rules-engine');
      result.categorized++;
    }

    const currentTags = tx.tags || [];
    const blocked = tx.removedTags || [];
    for (const tagId of outcome.tags) {
      if (!currentTags.includes(tagId) && !blocked.includes(tagId)) {
        emitTagAssignment(tx.id, tagId, 'rule', outcome.matchedRules[0] || null);
        result.tagged++;
      }
    }
  }

  return result;
}

// ---------- suggestions ----------

/**
 * Turns a user correction into a rule.
 *
 * The pattern comes from the *cleaned* merchant name, not the raw description:
 * learning "compra 3465 sp esl shop eu koln de" produces a rule that only ever
 * matches purchases made on that one card, whereas "sp esl shop" matches the
 * merchant however the bank formats it next time.
 */
export function learnFromCorrection(description, merchant, category) {
  const pattern = cleanDescription(description || merchant || '').toLowerCase().trim();
  if (!pattern || pattern.length < 3) return null;
  const field = 'any';

  const rules = loadRules();
  const existing = rules.find(
    (r) =>
      r.actions?.setCategory === category &&
      (r.conditions?.text || []).some((c) => c.value === pattern)
  );
  if (existing) {
    existing.confidence = Math.min(1, (existing.confidence || 0.5) + 0.1);
    existing.updated = new Date().toISOString();
    saveRules(rules);
    return existing;
  }

  return createRule({
    name: pattern,
    conditions: { text: [{ field, op: 'contains', value: pattern }] },
    actions: { setCategory: category, addTags: [] },
    origin: 'learned',
    confidence: 0.7,
    stopProcessing: false,
  });
}

/**
 * Static baseline suggestions from rule-templates.json, filtered to patterns not
 * already covered by an existing rule.
 *
 * Templates are grouped by target category so accepting "education" creates one
 * rule covering universidade + escola + propinas, instead of a separate rule per
 * merchant — a list of 29 near-identical suggestions was unreadable.
 */
export function suggestFromTemplates() {
  const templates = loadTemplates();
  const existingPatterns = new Set(
    loadRules().flatMap((r) =>
      (r.conditions?.text || []).map((c) => String(c.value).toLowerCase())
    )
  );

  const byCategory = new Map();
  for (const t of templates) {
    const fresh = t.patterns.filter((p) => !existingPatterns.has(p.toLowerCase()));
    if (fresh.length === 0) continue;
    const entry = byCategory.get(t.category) || { patterns: [], names: [] };
    for (const p of fresh) if (!entry.patterns.includes(p)) entry.patterns.push(p);
    entry.names.push(t.name);
    byCategory.set(t.category, entry);
  }

  return [...byCategory.entries()].map(([category, entry]) => ({
    name: `${category} — ${entry.patterns.slice(0, 4).join(', ')}${entry.patterns.length > 4 ? `, +${entry.patterns.length - 4}` : ''}`,
    origin: 'suggested-static',
    conditions: {
      text: entry.patterns.map((p) => ({ field: 'any', op: 'contains', value: p })),
    },
    actions: { setCategory: category, addTags: [] },
    stopProcessing: false,
    confidence: 0.9,
    coversMerchants: entry.names.length,
  }));
}

/**
 * Optional Ollama-backed suggestions: samples uncategorized transactions and
 * asks the local model for at most 5 high-confidence rules (quality over
 * quantity). Malformed output is discarded; failures surface as an empty list.
 */
export async function suggestFromLlm() {
  const { generateJSON, llmEnabled } = await import('../lib/ollama.js');
  if (!llmEnabled()) return [];

  const { loadCategories } = await import('../ledger/fileStore.js');
  const projections = await getProjections();
  const categories = loadCategories().map((c) => c.name);

  const samples = projections.transactions
    .filter((t) => t.category === 'uncategorized')
    .slice(0, 50)
    .map((t) => ({ description: t.description, merchant: t.merchant, amount: t.amount }));

  const prompt = `You are helping categorize personal-finance transactions.
Available categories: ${categories.join(', ')}.
Sample uncategorized transactions (Portuguese bank data):
${JSON.stringify(samples, null, 1)}

Propose AT MOST 5 high-confidence categorization rules — quality over quantity.
Only suggest a rule when the merchant/keyword is unambiguous. You may also
include well-known Portuguese merchants that are missing from the samples.
Reply with STRICT JSON: {"rules": [{"name": "...", "patterns": ["keyword"], "category": "one of the categories"}]}`;

  let parsed;
  try {
    parsed = await generateJSON(prompt);
  } catch {
    return [];
  }

  const rulesList = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(rulesList)) return [];

  const existing = new Set(
    loadRules().flatMap((r) => (r.conditions?.text || []).map((c) => String(c.value).toLowerCase()))
  );

  return rulesList
    .filter(
      (r) =>
        r &&
        typeof r.name === 'string' &&
        Array.isArray(r.patterns) &&
        r.patterns.length > 0 &&
        r.patterns.every((p) => typeof p === 'string' && p.trim()) &&
        categories.includes(r.category) &&
        !r.patterns.every((p) => existing.has(p.toLowerCase()))
    )
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      origin: 'suggested-llm',
      conditions: { text: r.patterns.map((p) => ({ field: 'any', op: 'contains', value: p })) },
      actions: { setCategory: r.category, addTags: [] },
      stopProcessing: false,
      confidence: 0.7,
    }));
}
