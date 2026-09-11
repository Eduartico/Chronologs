/**
 * Rule advisor: proposes collapsing redundant rules and flags categorizations
 * that look wrong.
 *
 * The problem it exists for: every correction writes a `learned` rule with one
 * literal pattern, so a real ledger ends up with hundreds of rules that each
 * match exactly one merchant. They are not wrong, they are unreadable — and
 * ninety of them say "this Continente is food".
 *
 * Everything here is deterministic first. Clustering rules by their shared
 * merchant root and spotting a category that disagrees with its own merchant
 * group needs no model at all; Ollama only adds an opinion on top when it is
 * enabled, and its opinions are labelled as guesses.
 *
 * Anomaly detection is travel-aware on purpose. A supermarket tagged `travel`
 * is odd at home and entirely normal mid-trip, so the travel calendar is
 * consulted before anything is called strange.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { httpError } from '../lib/httpError.js';
import { createHash } from 'crypto';
import { statePath } from '../lib/paths.js';
import { cleanDescription } from '../lib/merchant.js';
import { loadRules, saveRules, evaluateRules, ruleMatches } from './rules.js';
import { buildTravelIndex, loadTravels } from './travel.js';
import { applyCategorizationBulk } from './categorization.js';

const FEEDBACK_FILE = 'advisor-feedback.json';

// A merged rule needs enough members to be worth the churn.
const MIN_CLUSTER_SIZE = 3;
// Collapsing a whole category into one rule is a bigger change, so it is only
// offered where the saving is substantial.
const MIN_CATEGORY_CLUSTER = 8;
// Shared prefix length that counts as "the same merchant".
const ROOT_TOKENS = 2;
// A merchant group has to be this lopsided before a stray category is odd.
const MAJORITY_RATIO = 0.75;
const MIN_GROUP_FOR_ANOMALY = 4;

// Deliberately below every deterministic source, matching llmClassify.js: small
// local models report high confidence for answers they invented.
const LLM_CONFIDENCE = 0.55;

// ---------- feedback memory ----------

function feedbackFile() {
  return statePath(FEEDBACK_FILE);
}

export function loadFeedback() {
  if (!existsSync(feedbackFile())) return [];
  try {
    return JSON.parse(readFileSync(feedbackFile(), 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Records a verdict. Rejections are the valuable half: they stop a suggestion
 * coming back, and they are replayed into the model prompt so the next round
 * knows what was already turned down and why.
 */
export function recordFeedback({ id, kind, subject, verdict, note = null }) {
  const feedback = loadFeedback();
  const existing = feedback.find((f) => f.id === id);
  const entry = {
    id,
    kind,
    subject,
    verdict,
    note: note || null,
    at: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, entry);
  else feedback.push(entry);
  writeFileSync(feedbackFile(), JSON.stringify(feedback, null, 2), 'utf-8');
  return entry;
}

function rejectedIds(feedback = loadFeedback()) {
  return new Set(feedback.filter((f) => f.verdict === 'rejected').map((f) => f.id));
}

function stableId(kind, subject) {
  const digest = createHash('sha1').update(`${kind}|${subject}`).digest('hex').slice(0, 10);
  return `${kind}-${digest}`;
}

// ---------- collapsing rules ----------

/** The first couple of words of a pattern — what makes two rules siblings. */
function rootOf(pattern) {
  return cleanDescription(pattern)
    .split(' ')
    .filter(Boolean)
    .slice(0, ROOT_TOKENS)
    .join(' ')
    .trim();
}

function patternsOf(rule) {
  return (rule.conditions?.text || []).map((c) => String(c.value || '')).filter(Boolean);
}

/** Rules a pattern list can faithfully reproduce. */
function isSimpleRule(r) {
  return (
    r.enabled !== false &&
    r.actions?.setCategory &&
    !r.stopProcessing &&
    (r.actions.addTags || []).length === 0 &&
    Object.keys(r.conditions || {}).every((k) => k === 'text') &&
    patternsOf(r).length > 0 &&
    (r.conditions.text || []).every((c) => c.op === 'contains' || !c.op)
  );
}

/** The rule list as it would be after a merge, in evaluation order. */
function rulesAfterMerge(rules, members, merged) {
  const replacedIds = new Set(members.map((r) => r.id));
  const order = Math.min(...members.map((r) => r.order || 0));
  return [
    ...rules.filter((r) => !replacedIds.has(r.id)),
    { ...merged, id: 'merged-preview', order, enabled: true },
  ].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * The only check that matters: does anything actually end up categorized
 * differently?
 *
 * Comparing pattern coverage is not enough. A merged rule inherits the earliest
 * order of the rules it replaces, so it can now win against an unrelated rule
 * that used to run first — which would silently recategorize real transactions.
 * Running the engine before and after over the whole ledger is the only honest
 * way to know, and it is fast enough to do per candidate.
 */
function simulateMerge(rules, members, merged, transactions) {
  const after = rulesAfterMerge(rules, members, merged);
  const changes = [];

  for (const tx of transactions) {
    const before = evaluateRules(tx, rules).category;
    const now = evaluateRules(tx, after).category;
    if (before !== now) {
      changes.push({
        id: tx.id,
        description: tx.description,
        before: before || 'uncategorized',
        after: now || 'uncategorized',
      });
    }
  }

  return { changed: changes.length, changes: changes.slice(0, 10) };
}

/**
 * Rules that could become one.
 *
 * Two granularities are offered, because they answer different complaints.
 * Per-root merges bundle the nine "TRF MB WAY P/ <name>" rules into one and
 * read naturally afterwards. Per-category merges collapse every simple learned
 * rule pointing at one category into a single rule — a much bigger reduction,
 * and the direct answer to a rule list four hundred entries long.
 */
export function collapseCandidates(rules = loadRules(), transactions = []) {
  const rejected = rejectedIds();
  const simple = rules.filter(isSimpleRule);
  const candidates = [];

  const build = (level, key, label, members, extra = {}) => {
    const id = stableId('collapse', key);
    if (rejected.has(id)) return;

    const patterns = [...new Set(members.flatMap(patternsOf))];
    const category = members[0].actions.setCategory;
    const merged = {
      name: label,
      conditions: { text: patterns.map((p) => ({ field: 'any', op: 'contains', value: p })) },
      actions: { setCategory: category, addTags: [] },
      origin: 'collapsed',
      stopProcessing: false,
      confidence: 0.9,
    };

    const simulation = simulateMerge(rules, members, merged, transactions);

    candidates.push({
      id,
      kind: 'collapse',
      level,
      subject: key,
      category,
      label,
      replaces: members.map((r) => ({ id: r.id, name: r.name })),
      patterns,
      merged,
      changed: simulation.changed,
      changes: simulation.changes,
      lossless: simulation.changed === 0,
      ...extra,
    });
  };

  // Roots the data itself says cannot carry a single rule. A merge over one of
  // these would be technically lossless today and wrong tomorrow.
  const ambiguous = new Map(ambiguousRoots(transactions).map((a) => [a.root, a]));

  // --- per merchant root ---
  const byRoot = new Map();
  for (const rule of simple) {
    const root = rootOf(patternsOf(rule)[0]);
    if (!root || root.length < 3) continue;
    const key = `${rule.actions.setCategory}::${root}`;
    if (!byRoot.has(key)) byRoot.set(key, []);
    byRoot.get(key).push(rule);
  }
  for (const [key, members] of byRoot) {
    if (members.length < MIN_CLUSTER_SIZE) continue;
    const [category, root] = key.split('::');
    const spread = ambiguous.get(root);
    build('root', key, `${category} — ${root.toLowerCase()}`, members, {
      root,
      merchants: members.map((r) => patternsOf(r)[0]).filter(Boolean),
      ambiguous: spread || null,
      // The prose is kept so already-fetched findings still read; the key is what
      // the client prefers, so the same finding is explained in either language.
      rationaleKey: spread ? 'advisorReason.collapseAmbiguous' : 'advisorReason.collapseClean',
      rationaleParams: spread
        ? { rules: members.length, root, categories: spread.categories.length, summary: spread.summary, category }
        : { rules: members.length, root, category },
      rationale: spread
        ? `${members.length} regras diferentes começam por «${root}», mas no histórico essa raiz aparece em ${spread.categories.length} categorias — ${spread.summary}. Fundi-las numa só regra «${root} → ${category}» classificaria mal a maior parte delas.`
        : `${members.length} regras dizem a mesma coisa por palavras diferentes: tudo o que contém «${root}» é ${category}. Uma regra só faz o mesmo trabalho e deixa a lista legível.`,
    });
  }

  // --- per category ---
  const byCategory = new Map();
  for (const rule of simple) {
    const key = rule.actions.setCategory;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(rule);
  }
  for (const [category, members] of byCategory) {
    if (members.length < MIN_CATEGORY_CLUSTER) continue;
    build(
      'category',
      `category::${category}`,
      `${category} — ${members.length} comerciantes aprendidos`,
      members,
      {
        merchants: members.map((r) => patternsOf(r)[0]).filter(Boolean),
        rationaleKey: 'advisorReason.patternCollapse',
        rationaleParams: { rules: members.length, category },
        rationale: `Cada correcção tua escreveu uma regra nova, e ${members.length} delas apontam para ${category} — uma por comerciante. Juntas numa lista de padrões dentro de uma única regra, ${category} passa a ocupar uma linha em vez de ${members.length}.`,
      }
    );
  }

  return candidates.sort(
    (a, b) =>
      Number(!a.ambiguous) - Number(!b.ambiguous) ||
      Number(b.lossless) - Number(a.lossless) ||
      b.replaces.length - a.replaces.length
  );
}

// ---------- roots that cannot carry one rule ----------

/**
 * Merchant roots whose transactions genuinely belong to several categories.
 *
 * "TRF MB WAY P/" is a payment method, not a shop: one is dinner, the next is
 * rent, the next is a friend paying you back. A single rule over that root is
 * wrong for most of what it catches, and there is no need to know what MB WAY
 * *is* to see it — the spread in the data says so. The same reasoning finds
 * Bizum for a Spanish user, or Swish for a Swedish one, with nothing hard-coded.
 */
export function ambiguousRoots(transactions, { minGroup = 8 } = {}) {
  const groups = new Map();
  for (const tx of transactions) {
    if (tx.status === 'pending' || !tx.category || tx.category === 'uncategorized') continue;
    const root = rootOf(tx.description || tx.merchant || '');
    if (!root || root.length < 3) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(tx);
  }

  const findings = [];
  for (const [root, members] of groups) {
    if (members.length < minGroup) continue;

    const counts = new Map();
    for (const tx of members) counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [, topCount] = ranked[0];
    if (ranked.length < 2 || topCount / members.length >= MAJORITY_RATIO) continue;

    findings.push({
      id: stableId('ambiguous', root),
      kind: 'ambiguous',
      subject: root,
      root,
      total: members.length,
      categories: ranked.map(([category, count]) => ({
        category,
        count,
        share: Math.round((count / members.length) * 100),
      })),
      summary: ranked
        .slice(0, 4)
        .map(([category, count]) => `${category} ${Math.round((count / members.length) * 100)}%`)
        .join(', '),
      sample: members.slice(0, 5).map((t) => t.description),
    });
  }

  return findings.sort((a, b) => b.total - a.total);
}

// ---------- patterns worth a rule ----------

// Fewer than this and it could be coincidence rather than a habit.
const PATTERN_MIN_GROUP = 3;

/**
 * Merchant roots the user has, by hand, categorized the same way three or
 * more times — with no rule yet covering them.
 *
 * This is the other half of `noteCorrection` no longer writing a rule per
 * click: a correction now only ever *notes* a pattern, and this is what
 * turns a noted pattern into a proposal, once there is enough of it to be
 * a pattern rather than a one-off. "Enough" is the same bar `ambiguousRoots`
 * uses for the opposite question — is this root even the same thing every
 * time — just inverted: three or more decisions, at least three in four
 * agreeing.
 */
export function patternCandidates(rules = loadRules(), transactions = []) {
  const rejected = rejectedIds();
  const ambiguous = new Set(ambiguousRoots(transactions).map((a) => a.root));

  const groups = new Map();
  for (const tx of transactions) {
    if (tx.status === 'pending' || !tx.category || tx.category === 'uncategorized') continue;
    const root = rootOf(tx.description || tx.merchant || '');
    if (!root || root.length < 3 || ambiguous.has(root)) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(tx);
  }

  const findings = [];
  for (const [root, members] of groups) {
    if (members.length < PATTERN_MIN_GROUP) continue;

    const counts = new Map();
    for (const tx of members) counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
    const [majority, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (majorityCount / members.length < MAJORITY_RATIO) continue;

    // Already has a rule doing this job — nothing to propose.
    const covered = rules.some(
      (r) =>
        r.enabled !== false &&
        r.actions?.setCategory === majority &&
        members.some((tx) => ruleMatches(tx, r))
    );
    if (covered) continue;

    const id = stableId('pattern', root);
    if (rejected.has(id)) continue;

    findings.push({
      id,
      kind: 'pattern',
      subject: root,
      root,
      total: members.length,
      category: majority,
      share: Math.round((majorityCount / members.length) * 100),
      sample: members.slice(0, 5).map((t) => t.description),
      rationaleKey: 'advisorReason.pattern',
      rationaleParams: { root, total: members.length, majorityCount, majority },
      rationale: `«${root}» aparece em ${members.length} transacções, ${majorityCount} delas classificadas como ${majority} por ti. Não há regra nenhuma a cobrir isto.`,
    });
  }

  return findings.sort((a, b) => b.total - a.total);
}

/** Turns a noted pattern into the one rule it deserved from the start. */
export function applyPattern(finding) {
  if (!finding?.root || !finding?.category) throw httpError(400, 'api.error.invalidFinding');
  const rules = loadRules();
  const rule = {
    id: stableId('rule', `pattern::${finding.root}`),
    name: `${finding.root} — padrão observado`,
    order: rules.reduce((max, r) => Math.max(max, r.order || 0), 0) + 10,
    enabled: true,
    stopProcessing: false,
    conditions: { text: [{ field: 'any', op: 'contains', value: finding.root }] },
    actions: { setCategory: finding.category, addTags: [] },
    origin: 'learned',
    confidence: 0.85,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  saveRules([...rules, rule].sort((a, b) => (a.order || 0) - (b.order || 0)));
  return { created: rule.id, category: finding.category };
}

// ---------- rules that never get their turn ----------

/**
 * Rules that match transactions but never decide one.
 *
 * Rules run in order and the first category wins, so a broad rule sitting above
 * a specific one silently swallows it. The specific rule is not wrong and not
 * unused — it just never gets asked, which is invisible in a list of four
 * hundred entries. Nothing here needs a model: the engine is run over the real
 * ledger and asked who actually decided each row.
 */
export function shadowedRules(rules = loadRules(), transactions = []) {
  const rejected = rejectedIds();
  const active = rules.filter((r) => r.enabled !== false && r.actions?.setCategory);
  if (active.length < 2 || transactions.length === 0) return [];

  const matches = new Map(active.map((r) => [r.id, 0]));
  const wins = new Map(active.map((r) => [r.id, 0]));
  const stolenBy = new Map();

  for (const tx of transactions) {
    const winner = evaluateRules(tx, rules).categoryRuleId;
    if (winner) wins.set(winner, (wins.get(winner) || 0) + 1);
    for (const rule of active) {
      if (!ruleMatches(tx, rule)) continue;
      matches.set(rule.id, (matches.get(rule.id) || 0) + 1);
      if (winner && winner !== rule.id) {
        if (!stolenBy.has(rule.id)) stolenBy.set(rule.id, new Map());
        const thieves = stolenBy.get(rule.id);
        thieves.set(winner, (thieves.get(winner) || 0) + 1);
      }
    }
  }

  const byId = new Map(rules.map((r) => [r.id, r]));
  const findings = [];

  for (const rule of active) {
    const matched = matches.get(rule.id) || 0;
    if (matched === 0 || (wins.get(rule.id) || 0) > 0) continue;

    const thieves = [...(stolenBy.get(rule.id) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
    if (thieves.length === 0) continue;
    const [topId, topCount] = thieves[0];
    const thief = byId.get(topId);
    if (!thief) continue;

    const id = stableId('shadowed', rule.id);
    if (rejected.has(id)) continue;

    const sameOutcome = thief.actions?.setCategory === rule.actions.setCategory;

    // The second fix, alongside "promote": maybe the *general* rule is the
    // wrong one, not merely first — a supermarket rule that says travel
    // because it was written from one trip's receipt is wrong for the errand
    // next door. What the thief's own matches mostly resolve to today (via
    // manual corrections, other rules, whatever actually decided them) is
    // computed straight from the ledger, the same way `anomalyCandidates`
    // finds a majority — no guessing at what the merchant "really" is.
    const retarget = !sameOutcome ? majorityCategoryFor(thief, transactions) : null;

    findings.push({
      id,
      kind: 'shadowed',
      subject: rule.id,
      rule: { id: rule.id, name: rule.name, order: rule.order, category: rule.actions.setCategory },
      shadowedBy: {
        id: thief.id,
        name: thief.name,
        order: thief.order,
        category: thief.actions?.setCategory || null,
        origin: thief.origin || null,
      },
      matched,
      stolen: topCount,
      // Two different problems wearing the same shape.
      redundant: sameOutcome,
      retargetTo: retarget && retarget !== thief.actions?.setCategory ? retarget : null,
      // Deleting the general rule is only offered when it is itself a
      // one-correction `learned` rule — a hand-written broad rule usually
      // covers far more than the pair the advisor is comparing here.
      canDeleteGeneral: thief.origin === 'learned',
      rationaleKey: sameOutcome ? 'advisorReason.shadowedSame' : 'advisorReason.shadowedDifferent',
      rationaleParams: {
        rule: rule.name,
        matched,
        thief: thief.name,
        category: rule.actions.setCategory,
        thiefCategory: thief.actions?.setCategory,
      },
      rationale: sameOutcome
        ? `A regra «${rule.name}» apanha ${matched} transacções mas nunca decide nenhuma: «${thief.name}» corre antes e já lhes dá a mesma categoria (${rule.actions.setCategory}). É uma regra a mais.`
        : `A regra «${rule.name}» apanha ${matched} transacções e nunca decide nenhuma: «${thief.name}» corre antes e classifica-as como ${thief.actions?.setCategory}. Se querias ${rule.actions.setCategory} nestas, a regra tem de subir na ordem — ou, se «${thief.name}» é que está a apontar para a categoria errada na maior parte das vezes, pode ser essa a mudar.`,
      suggestion: sameOutcome ? 'apagar' : 'subir',
    });
  }

  return findings.sort((a, b) => b.matched - a.matched);
}

/** The category real transactions matching this rule mostly ended up in. */
function majorityCategoryFor(rule, transactions) {
  const counts = new Map();
  for (const tx of transactions) {
    if (!ruleMatches(tx, rule)) continue;
    if (!tx.category || tx.category === 'uncategorized') continue;
    counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || null;
}

/**
 * Category output before and after a rule-set mutation, over the same
 * transactions — the honest way to say "this changes N things" instead of
 * guessing from matches alone. Optional: called only when the caller handed
 * in transactions, since generating a finding does not need this, only
 * acting on one does.
 */
function diffCategorization(before, after, transactions) {
  if (!transactions?.length) return null;
  const changes = [];
  for (const tx of transactions) {
    const b = evaluateRules(tx, before).category || 'uncategorized';
    const a = evaluateRules(tx, after).category || 'uncategorized';
    if (a !== b) {
      changes.push({ id: tx.id, description: tx.description, before: b, after: a });
    }
  }
  return { affected: changes.length, changes: changes.slice(0, 10) };
}

/**
 * The ways to fix a rule that never gets to decide anything. A single path
 * used to force a diagnosis into whichever one of "delete" or "promote" the
 * code guessed was right — real ledgers turned up cases neither covered: two
 * rules with the same name and different categories, or a specific rule that
 * should just go even though the general one shares its verdict.
 *
 * `delete` removes the shadowed rule outright. It never wins today by
 * definition — that is what "shadowed" means — so this can never change a
 * single existing categorization; it only stops the rule existing for future
 * transactions. No longer gated on `redundant`: that flag says whether the
 * two rules *agree*, not whether deleting the specific one is ever safe.
 *
 * `deleteGeneral` is the mirror case — the rule sitting on top is the wrong
 * one, not merely first, and the honest fix is removing it rather than
 * teaching it a new category. Restricted to `learned` rules: a hand-written
 * rule earns more benefit of the doubt than one a single correction produced.
 *
 * `promote` moves the shadowed rule directly above the one stealing its
 * transactions, so its own category wins from now on — the general rule
 * stays exactly as it was, for whatever else it correctly catches.
 *
 * `retarget` is for when the *general* rule is the one that is wrong: it
 * rewrites its category to whatever real transactions matching it mostly
 * resolve to, computed by `majorityCategoryFor` and already handed to the
 * client as `retargetTo`.
 *
 * `transactions`, when passed, turns every branch into a real before/after
 * simulation instead of a description of the intent — the same `affected`
 * count a merge preview already gives, here for a single-rule change.
 */
export function applyShadowedFix(finding, action, transactions = []) {
  const rules = loadRules();
  const before = transactions.length ? structuredClone(rules) : null;
  const rule = rules.find((r) => r.id === finding.rule.id);
  const thief = rules.find((r) => r.id === finding.shadowedBy.id);
  if (!rule) throw httpError(400, 'api.error.ruleGone');

  const impact = (after) => {
    const diff = diffCategorization(before, after, transactions);
    return diff ? { impact: diff } : {};
  };

  if (action === 'delete') {
    const after = rules.filter((r) => r.id !== rule.id);
    const result = { action: 'delete', removed: rule.id, ...impact(after) };
    saveRules(after);
    return result;
  }

  if (action === 'deleteGeneral') {
    if (!thief) throw httpError(400, 'api.error.shadowingRuleGone');
    if (thief.origin !== 'learned') {
      throw httpError(400, 'api.error.ruleNotLearned');
    }
    const after = rules.filter((r) => r.id !== thief.id);
    const result = { action: 'deleteGeneral', removed: thief.id, ...impact(after) };
    saveRules(after);
    return result;
  }

  if (action === 'promote') {
    if (!thief) throw httpError(400, 'api.error.shadowingRuleGone');
    // Fractional order: it only has to sort between the thief and whatever ran
    // immediately before it, so there is no need to renumber the whole list.
    rule.order = (thief.order ?? 0) - 0.5;
    const result = { action: 'promote', order: rule.order, ...impact(rules) };
    saveRules(rules);
    return result;
  }

  if (action === 'retarget') {
    if (!thief) throw httpError(400, 'api.error.generalRuleGone');
    if (!finding.retargetTo) throw httpError(400, 'api.error.noMajorityCategory');
    thief.actions = { ...thief.actions, setCategory: finding.retargetTo };
    thief.updated = new Date().toISOString();
    const result = { action: 'retarget', category: finding.retargetTo, ...impact(rules) };
    saveRules(rules);
    return result;
  }

  throw httpError(400, 'api.error.unknownAction');
}

/**
 * Applies a collapse: creates the merged rule, then deletes the ones it
 * replaces. Refuses when the merge would stop matching transactions the old
 * rules covered — a lossy merge silently un-categorizes real spending.
 */
export function applyCollapse(candidate, { force = false } = {}) {
  if (!candidate?.merged) throw httpError(400, 'api.error.invalidCandidate');
  if (!candidate.lossless && !force) {
    throw new Error(`A fusão mudaria a categoria de ${candidate.changed} transacções`);
  }

  const rules = loadRules();
  const replacedIds = new Set((candidate.replaces || []).map((r) => r.id));
  const replaced = rules.filter((r) => replacedIds.has(r.id));
  // Keep the merged rule where the originals ran, so evaluation order holds.
  const order = replaced.length
    ? Math.min(...replaced.map((r) => r.order || 0))
    : rules.reduce((max, r) => Math.max(max, r.order || 0), 0) + 10;

  const kept = rules.filter((r) => !replacedIds.has(r.id));
  kept.push({
    ...candidate.merged,
    id: stableId('rule', candidate.subject),
    order,
    enabled: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  });

  saveRules(kept.sort((a, b) => (a.order || 0) - (b.order || 0)));
  return { created: 1, removed: replaced.length };
}

// ---------- compacting learned rules ----------

// A root needs at least this many learned rules pointing at it before
// compacting is worth the churn — a lone rule has nothing to merge with.
const MIN_ROOT_SIZE_FOR_COMPACTION = 2;

/**
 * What every correction was supposed to produce in the first place: one rule
 * per merchant root, not one rule per correction.
 *
 * `learnFromCorrection` used to write a new `learned` rule from the *whole*
 * cleaned description every time a category was fixed, so a real ledger
 * fills up with hundreds of rules that each match one transaction — the
 * "spar supermarket", "spar cais do sodré", "spar li" family, every one of
 * them a different rule. Grouping by the shared root and keeping only the
 * category the real ledger mostly agrees on turns that family into one rule,
 * the way it should have been from the first correction: a rule is evidence
 * of a pattern, not a receipt for a single click.
 *
 * Roots `ambiguousRoots` already flags — a payment method, not a shop — are
 * left alone entirely: forcing one category onto MB WAY would be wrong more
 * often than the mess it replaces.
 */
export function compactLearnedRules(rules = loadRules(), transactions = []) {
  const ambiguous = new Set(ambiguousRoots(transactions).map((a) => a.root));
  const learned = rules.filter((r) => r.origin === 'learned' && isSimpleRule(r));

  const byRoot = new Map();
  for (const rule of learned) {
    const root = rootOf(patternsOf(rule)[0]);
    if (!root || root.length < 3 || ambiguous.has(root)) continue;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(rule);
  }

  const replacedIds = new Set();
  const groups = [];
  for (const [root, members] of byRoot) {
    if (members.length < MIN_ROOT_SIZE_FOR_COMPACTION) continue;

    const patterns = [...new Set(members.flatMap(patternsOf))];
    const probe = { conditions: { text: patterns.map((p) => ({ field: 'any', op: 'contains', value: p })) } };
    // What the real ledger mostly agrees this root is — not the category the
    // first correction happened to pick.
    const category = majorityCategoryFor(probe, transactions) || members[0].actions.setCategory;

    const mergedRule = {
      id: stableId('rule', `compact::${root}`),
      name: `${root} — ${members.length} regras compactadas`,
      order: Math.min(...members.map((r) => r.order || 0)),
      enabled: true,
      stopProcessing: false,
      conditions: probe.conditions,
      actions: { setCategory: category, addTags: [] },
      origin: 'collapsed',
      confidence: 0.85,
    };

    members.forEach((r) => replacedIds.add(r.id));
    groups.push({
      root,
      category,
      replaces: members.map((r) => ({ id: r.id, name: r.name, category: r.actions.setCategory })),
      replacesIds: members.map((r) => r.id),
      merged: mergedRule,
    });
  }

  if (groups.length === 0) {
    return { before: rules.length, after: rules.length, removed: 0, created: 0, groups: [], changed: 0, changes: [] };
  }

  const after = [...rules.filter((r) => !replacedIds.has(r.id)), ...groups.map((g) => g.merged)].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  const changes = [];
  for (const tx of transactions) {
    const before = evaluateRules(tx, rules).category || 'uncategorized';
    const now = evaluateRules(tx, after).category || 'uncategorized';
    if (before !== now) changes.push({ id: tx.id, description: tx.description, before, after: now });
  }

  return {
    before: rules.length,
    after: after.length,
    removed: replacedIds.size,
    created: groups.length,
    groups,
    changed: changes.length,
    changes: changes.slice(0, 30),
  };
}

/**
 * Applies a compaction preview exactly as computed — nothing here re-derives
 * the groups, so what was shown before the click is what happens on it.
 */
export function applyCompaction(preview) {
  if (!preview?.groups?.length) throw httpError(400, 'api.error.nothingToCompact');

  const rules = loadRules();
  const replacedIds = new Set(preview.groups.flatMap((g) => g.replacesIds));
  const kept = rules.filter((r) => !replacedIds.has(r.id));
  const now = new Date().toISOString();
  const merged = preview.groups.map((g) => ({ ...g.merged, created: now, updated: now }));

  saveRules([...kept, ...merged].sort((a, b) => (a.order || 0) - (b.order || 0)));
  return { removed: replacedIds.size, created: merged.length };
}

// ---------- anomalies ----------

/**
 * Categorizations that disagree with their own merchant group.
 *
 * Ninety Continente purchases in `food` and one in `travel` is worth a look —
 * unless that one falls inside a detected trip, in which case it is exactly
 * right and saying otherwise would be noise.
 */
export function anomalyCandidates(transactions, travels = loadTravels()) {
  const rejected = rejectedIds();
  const travelIndex = buildTravelIndex(transactions, travels);

  const groups = new Map();
  for (const tx of transactions) {
    if (tx.status === 'pending') continue;
    const root = cleanDescription(tx.description || tx.merchant || '');
    if (!root || root.length < 3) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(tx);
  }

  const findings = [];

  for (const [root, members] of groups) {
    if (members.length < MIN_GROUP_FOR_ANOMALY) continue;

    const counts = new Map();
    for (const tx of members) counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
    const [majority, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (majorityCount / members.length < MAJORITY_RATIO) continue;

    for (const tx of members) {
      if (tx.category === majority) continue;

      // The travel exception, stated explicitly: a trip explains the odd one
      // out. Being *inside* a trip is the whole of the exception now — the
      // category used to be half of it, back when claiming a transaction for a
      // trip overwrote it, and reading it here would now exempt a line for
      // carrying a word left over from that behaviour.
      if (travelIndex.get(tx.id)) continue;

      const id = stableId('anomaly', tx.id);
      if (rejected.has(id)) continue;

      findings.push({
        id,
        kind: 'anomaly',
        subject: tx.id,
        transaction: {
          id: tx.id,
          date: String(tx.date).slice(0, 10),
          description: tx.description,
          amount: tx.amount,
          category: tx.category,
        },
        group: root,
        groupSize: members.length,
        expected: majority,
        expectedShare: Math.round((majorityCount / members.length) * 100),
        /* No `travel` field and no during-a-trip wording: a transaction inside a
           trip is skipped above and can no longer reach this point, so a branch
           for it here would be a branch that never runs. The exception used to
           be conditional — inside a trip *and* categorized as travel — because
           claiming a transaction for a trip overwrote its category; now the trip
           alone is the whole of it. */
        reasonKey: 'advisorReason.anomaly',
        reasonParams: {
          category: tx.category,
          majorityCount,
          total: members.length,
          majority,
        },
        reason: `Está em "${tx.category}" enquanto ${majorityCount} de ${members.length} deste comerciante estão em "${majority}".`,
      });
    }
  }

  return findings.sort((a, b) => b.groupSize - a.groupSize);
}

/**
 * The other direction of an anomaly fix: not "this one transaction is wrong,
 * move it to the majority" but "the majority is wrong, and this one was
 * right all along" — the case the accept button never covered. Every other
 * member of the same merchant group currently sitting in the finding's
 * `expected` category is moved to match the transaction that triggered the
 * finding instead.
 */
export async function applyAnomalyInverse(finding, transactions) {
  if (!finding?.expected || !finding?.group) throw httpError(400, 'api.error.invalidFinding');
  const toCategory = finding.transaction?.category;
  if (!toCategory) throw httpError(400, 'api.error.invalidFinding');

  const ids = transactions
    .filter(
      (tx) =>
        tx.category === finding.expected &&
        cleanDescription(tx.description || tx.merchant || '') === finding.group
    )
    .map((tx) => tx.id);

  if (ids.length === 0) throw httpError(400, 'api.error.noMajorityTransactions');

  const result = await applyCategorizationBulk(ids, toCategory, 'advisor-inverse');
  return { action: 'inverse', category: toCategory, moved: result.applied, ...result };
}

// ---------- optional model pass ----------

/**
 * Asks the local model to explain what the deterministic passes found.
 *
 * What it used to send was a list of ids, a category, and `c.root` — a field the
 * candidates never had, so the model was reading `undefined` and answering about
 * nothing. It came back with one word and one vague sentence, which is exactly
 * how it looked on screen.
 *
 * Now it gets the merchants, the sample descriptors, the current rule order and
 * the spread of categories per root, and is asked for the reasoning rather than
 * a verdict. The target register is a colleague pointing at the screen: "you
 * have fourteen rules for Continente, it's a supermarket, they all say food —
 * make it one rule."
 *
 * Past rejections go into the prompt so the model stops re-proposing what the
 * user already refused — this is the feedback loop, and it is the only reason
 * the notes are stored.
 */
export async function askLlm({
  collapses = [],
  anomalies = [],
  ambiguous = [],
  shadowed = [],
  categories = [],
} = {}) {
  const { generateJSON, llmEnabled } = await import('../lib/ollama.js');
  if (!llmEnabled()) return { enabled: false, findings: [] };

  const rejections = loadFeedback()
    .filter((f) => f.verdict === 'rejected')
    .slice(-25)
    .map((f) => `- ${f.kind}: ${f.subject}${f.note ? ` (motivo: ${f.note})` : ''}`);

  // The prompt lives in server/engines/prompts/, one file per language, because
  // the model answers in the language it is asked in and these notes go straight
  // onto the screen. What does *not* move with the language is the wire format:
  // the Portuguese JSON keys and the "concordo"/"discordo" verdicts are the parse
  // contract, and the English prompt keeps them verbatim.
  const { pick, normaliseVerdict } = await import('./prompts/index.js');
  const { currentLocale } = await import('../lib/settings.js');
  const buildPrompt = pick('advisor', currentLocale());

  const prompt = buildPrompt({
    categories,
    rejections,
    collapses: collapses.slice(0, 12).map((c) => ({
      id: c.id,
      nivel: c.level,
      raiz: c.root || null,
      categoria: c.category,
      numeroDeRegras: c.replaces.length,
      comerciantes: (c.merchants || []).slice(0, 12),
      mudariaCategoriaA: c.changed,
    })),
    ambiguous: ambiguous.slice(0, 10).map((a) => ({
      id: a.id,
      raiz: a.root,
      transaccoes: a.total,
      'reparti\u00e7\u00e3o': a.summary,
      exemplos: a.sample.slice(0, 3),
    })),
    shadowed: shadowed.slice(0, 10).map((sh) => ({
      id: sh.id,
      regra: sh.rule.name,
      categoriaQueQueria: sh.rule.category,
      tapadaPor: sh.shadowedBy.name,
      categoriaQueGanha: sh.shadowedBy.category,
      transaccoesAfectadas: sh.matched,
      mesmoResultado: sh.redundant,
    })),
    anomalies: anomalies.slice(0, 20).map((a) => ({
      id: a.id,
      descricao: a.transaction.description,
      actual: a.transaction.category,
      maioria: a.expected,
      duranteViagem: !!a.travel,
    })),
  });

  let parsed;
  try {
    parsed = await generateJSON(prompt);
  } catch {
    return { enabled: true, findings: [], errorKey: 'api.error.llmNoAnswer' };
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.findings;
  if (!Array.isArray(list)) return { enabled: true, findings: [] };

  const known = new Set([...collapses, ...anomalies, ...ambiguous, ...shadowed].map((c) => c.id));

  return {
    enabled: true,
    findings: list
      .filter((f) => f && known.has(f.id) && typeof f.note === 'string')
      .slice(0, 20)
      .map((f) => ({
        id: f.id,
        // A model reading an English prompt is quite capable of answering
        // "agree" however plainly it was told to copy the Portuguese literal.
        // The old code read anything that was not exactly "discordo" as
        // agreement, so a translated "disagree" silently became a yes.
        verdict: normaliseVerdict(f.verdict) ?? 'concordo',
        note: f.note,
        confidence: LLM_CONFIDENCE,
        source: 'llm',
      })),
  };
}
