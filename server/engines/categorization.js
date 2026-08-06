import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadCategories,
  saveCategories,
  loadRules as loadRawRules,
  saveRules as saveRawRules,
} from '../ledger/fileStore.js';
import {
  createEvent,
  appendIfNew,
  loadLedgerIndex,
  appendIfNewIndexed,
} from '../ledger/eventStore.js';
import { getProjections } from '../projections/cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATEGORIES_FILE = join(__dirname, '..', 'config', 'defaults', 'categories.json');

export const PROTECTED_CATEGORY = 'uncategorized';

/**
 * System categories carry meaning the engines rely on, so their names are
 * fixed: `internal_transfer` is what keeps money moved between the owner's own
 * accounts out of the spending totals, and renaming it would quietly turn that
 * off. Colour and icon stay editable — only the identity is locked.
 */
export const SYSTEM_CATEGORIES = ['internal_transfer', 'cash_withdrawal'];

export function isSystemCategory(cat) {
  return !!cat && (cat.system === true || cat.name === PROTECTED_CATEGORY);
}

/**
 * Seeds the built-in categories, matching on `id` rather than `name`.
 *
 * Matching on name would resurrect a default the moment the user renamed it —
 * renaming "education" to "Educação" would silently recreate "education" on the
 * next request. Deleted defaults leave a tombstone behind for the same reason.
 */
export function ensureDefaultCategories() {
  const defaults = JSON.parse(readFileSync(DEFAULT_CATEGORIES_FILE, 'utf-8'));
  const cats = loadCategories();
  let changed = false;
  for (const d of defaults) {
    const existing = cats.find((c) => c.id === d.id);
    if (!existing) {
      cats.push({ ...d, created: new Date().toISOString() });
      changed = true;
    } else {
      // Icons and system flags arrived after these categories were seeded;
      // backfill without touching anything the user has since edited.
      if (!existing.icon && d.icon) {
        existing.icon = d.icon;
        changed = true;
      }
      if (d.system && !existing.system) {
        existing.system = true;
        changed = true;
      }
      if (d.excludeFromSpending && !existing.excludeFromSpending) {
        existing.excludeFromSpending = true;
        changed = true;
      }
    }
  }
  if (changed) saveCategories(cats);
  return cats.filter((c) => !c.deleted);
}

export function getCategories() {
  return loadCategories().filter((c) => !c.deleted);
}

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'categoria';
}

export function createCategory(name, parent = null, icon = null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const cats = loadCategories();
  if (cats.some((c) => !c.deleted && c.name.toLowerCase() === trimmed.toLowerCase())) return null;

  let id = slugify(trimmed);
  while (cats.some((c) => c.id === id)) id = `${id}-2`;

  const cat = {
    id,
    name: trimmed,
    color: `hsl(${Math.floor(Math.random() * 360)}, 50%, 60%)`,
    icon: icon || 'tag',
    created: new Date().toISOString(),
    parent,
  };
  cats.push(cat);
  saveCategories(cats);
  return cat;
}

/**
 * Reassigns every transaction in `from` to `to` and repoints any rule that
 * targets it. Categories live in the ledger by name, so a rename is a batch of
 * new assignment events rather than an edit of old ones — the ledger stays
 * append-only.
 */
async function repointCategory(from, to) {
  const projections = await getProjections();
  const index = await loadLedgerIndex();
  let moved = 0;

  for (const tx of projections.transactions) {
    if (tx.category !== from) continue;
    const ev = createEvent('category_assignment', 'category-edit', {
      event_id: tx.id,
      category: to,
      confidence: 1,
      rule_id: null,
    });
    if (appendIfNewIndexed(ev, index)) moved++;
  }

  return { moved, rulesTouched: repointRules(from, to) };
}

/**
 * Repoints rules at the renamed category. A rule still targeting the old name
 * would simply re-apply it on the next run, silently undoing the rename.
 *
 * Reads the rules file directly rather than through the rules engine, which
 * imports this module — v1 (a bare array) and v2 are both handled so the file
 * is safe to touch before the engine has migrated it.
 */
function repointRules(from, to) {
  const raw = loadRawRules();
  const isV1 = Array.isArray(raw);
  const list = isV1 ? raw : raw.rules || [];
  let touched = 0;

  for (const rule of list) {
    if (isV1) {
      if (rule.category === from) {
        rule.category = to;
        touched++;
      }
    } else if (rule.actions?.setCategory === from) {
      rule.actions.setCategory = to;
      rule.updated = new Date().toISOString();
      touched++;
    }
  }

  if (touched > 0) saveRawRules(isV1 ? list : { ...raw, version: 2, rules: list });
  return touched;
}

export async function updateCategory(id, patch = {}) {
  const cats = loadCategories();
  const cat = cats.find((c) => c.id === id && !c.deleted);
  if (!cat) return { error: 'not_found' };

  const result = { category: cat, moved: 0, rulesTouched: 0 };
  const newName = patch.name != null ? String(patch.name).trim() : null;

  if (newName && newName !== cat.name) {
    if (isSystemCategory(cat)) return { error: 'protected' };
    if (cats.some((c) => !c.deleted && c.id !== id && c.name.toLowerCase() === newName.toLowerCase())) {
      return { error: 'duplicate' };
    }
    const repointed = await repointCategory(cat.name, newName);
    result.moved = repointed.moved;
    result.rulesTouched = repointed.rulesTouched;
    cat.name = newName;
  }

  if (patch.color) cat.color = patch.color;
  if (patch.icon !== undefined) cat.icon = patch.icon || null;
  if (patch.parent !== undefined) cat.parent = patch.parent;

  cat.updated = new Date().toISOString();
  saveCategories(cats);
  return result;
}

export async function deleteCategory(id) {
  const cats = loadCategories();
  const cat = cats.find((c) => c.id === id && !c.deleted);
  if (!cat) return { error: 'not_found' };
  if (isSystemCategory(cat)) return { error: 'protected' };

  const { moved, rulesTouched } = await repointCategory(cat.name, PROTECTED_CATEGORY);

  const defaults = JSON.parse(readFileSync(DEFAULT_CATEGORIES_FILE, 'utf-8'));
  if (defaults.some((d) => d.id === cat.id)) {
    // Tombstone, so ensureDefaultCategories does not seed it back.
    cat.deleted = true;
    cat.updated = new Date().toISOString();
  } else {
    cats.splice(cats.indexOf(cat), 1);
  }
  saveCategories(cats);

  return { moved, rulesTouched };
}

/** How many transactions a category currently holds — shown before deleting. */
export async function countTransactionsInCategory(name) {
  const projections = await getProjections();
  return projections.transactions.filter((t) => t.category === name).length;
}

export async function mergeCategories(target, source) {
  let cats = loadCategories();
  const sourceCat = cats.find((c) => c.name === source);
  const targetCat = cats.find((c) => c.name === target);
  if (!sourceCat || !targetCat) return false;

  // Reassign every transaction currently in the source category before it
  // disappears, otherwise they would point at a nonexistent category.
  const projections = await getProjections();
  for (const tx of projections.transactions) {
    if (tx.category === source) {
      const ev = createEvent('category_assignment', 'merge', {
        event_id: tx.id,
        category: target,
        confidence: 1,
        rule_id: null,
      });
      await appendIfNew(ev);
    }
  }

  cats = cats.filter((c) => c.name !== source);
  saveCategories(cats);
  return true;
}

export async function applyCategorization(transactionId, category, confidence = 1, ruleId = null, source = 'engine') {
  const ev = createEvent('category_assignment', source, {
    event_id: transactionId,
    category,
    confidence,
    rule_id: ruleId,
  });
  await appendIfNew(ev);
  return ev;
}

/**
 * Categorizes many transactions in one pass. `appendIfNew` rescans the whole
 * ledger per event, which turns accepting a 100-transaction merchant group into
 * a 100x replay; the batch index is loaded once instead.
 *
 * Transactions the user has manually overridden are left alone — a manual
 * decision always outranks a bulk action.
 */
export async function applyCategorizationBulk(transactionIds, category, source = 'bulk') {
  const projections = await getProjections();
  const byId = new Map(projections.transactions.map((t) => [t.id, t]));
  const index = await loadLedgerIndex();

  const result = { applied: 0, skipped: 0, unchanged: 0 };

  for (const id of transactionIds) {
    const tx = byId.get(id);
    if (!tx) {
      result.skipped++;
      continue;
    }
    if (tx.overridden) {
      result.skipped++;
      continue;
    }
    if (tx.category === category) {
      result.unchanged++;
      continue;
    }
    const ev = createEvent('category_assignment', source, {
      event_id: id,
      category,
      confidence: 1,
      rule_id: null,
    });
    if (appendIfNewIndexed(ev, index)) result.applied++;
    else result.unchanged++;
  }

  return result;
}

export async function applyManualOverride(transactionId, originalCategory, newCategory) {
  const ev = createEvent('manual_override', 'manual', {
    event_id: transactionId,
    original_category: originalCategory,
    new_category: newCategory,
  });
  await appendIfNew(ev);
  return ev;
}

