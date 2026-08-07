import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { statePath } from '../lib/paths.js';
import { notify } from '../lib/notify.js';
import { getProjections } from '../projections/cache.js';
import { createEvent, appendEvent } from '../ledger/eventStore.js';

// ---------- storage ----------

function rulesFile() {
  return statePath('correlation-rules.json');
}

function proposalsFile() {
  return statePath('correlations.json');
}

export function loadCorrelationRules() {
  if (!existsSync(rulesFile())) return [];
  return JSON.parse(readFileSync(rulesFile(), 'utf-8'));
}

function saveCorrelationRules(rules) {
  writeFileSync(rulesFile(), JSON.stringify(rules, null, 2), 'utf-8');
}

export function createCorrelationRule(input) {
  const rules = loadCorrelationRules();
  const rule = {
    id: uuidv4(),
    name: input.name || 'Correlation rule',
    enabled: input.enabled ?? true,
    sourceA: input.sourceA || 'activobank',
    sourceB: input.sourceB || 'pricempire',
    directionA: input.directionA || 'debit',
    textHint: input.textHint || '',
    dateWindowDays: input.dateWindowDays ?? 4,
    amountTolerancePct: input.amountTolerancePct ?? 10,
    amountToleranceAbs: input.amountToleranceAbs ?? 5,
    allowAggregate: input.allowAggregate ?? true,
    maxAggregateSize: input.maxAggregateSize ?? 4,
    created: new Date().toISOString(),
  };
  rules.push(rule);
  saveCorrelationRules(rules);
  return rule;
}

export function updateCorrelationRule(id, patch) {
  const rules = loadCorrelationRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  const { id: _id, created, ...rest } = patch;
  Object.assign(rule, rest);
  saveCorrelationRules(rules);
  return rule;
}

export function deleteCorrelationRule(id) {
  const rules = loadCorrelationRules();
  const filtered = rules.filter((r) => r.id !== id);
  if (filtered.length === rules.length) return false;
  saveCorrelationRules(filtered);
  return true;
}

export function loadProposals() {
  if (!existsSync(proposalsFile())) return [];
  return JSON.parse(readFileSync(proposalsFile(), 'utf-8'));
}

function saveProposals(proposals) {
  writeFileSync(proposalsFile(), JSON.stringify(proposals, null, 2), 'utf-8');
}

function proposalHash(ruleId, aId, bIds) {
  return createHash('sha1')
    .update(`${ruleId}|${aId}|${[...bIds].sort().join(',')}`)
    .digest('hex');
}

// ---------- matching ----------

function tolerance(rule, target) {
  return Math.max(rule.amountToleranceAbs || 0, (Math.abs(target) * (rule.amountTolerancePct || 0)) / 100);
}

function dayDiff(a, b) {
  return Math.abs(new Date(a) - new Date(b)) / (1000 * 60 * 60 * 24);
}

function scoreMatch(target, sum, avgDays, windowDays) {
  const amountCloseness = 1 - Math.min(1, Math.abs(target - sum) / Math.max(target, 1));
  const dateProximity = 1 - Math.min(1, avgDays / Math.max(windowDays, 1));
  return Math.round((0.6 * amountCloseness + 0.4 * dateProximity) * 100) / 100;
}

/**
 * Greedy subset search: candidates sorted by date proximity; DFS accumulating
 * sums up to maxSize, pruning when over target+tolerance. Exact-tolerance
 * matches win; otherwise the best partial (≥50% of target — money left as
 * site balance) is returned flagged partial:true.
 */
export function findAggregate(target, tol, candidates, maxSize) {
  let best = null;

  function consider(subset, sum) {
    const avgDays = subset.reduce((s, c) => s + c.days, 0) / subset.length;
    const withinTolerance = Math.abs(target - sum) <= tol;
    const partial = !withinTolerance && sum >= target * 0.5 && sum < target;
    if (!withinTolerance && !partial) return;
    const candidate = {
      items: [...subset],
      sum,
      partial: !withinTolerance,
      avgDays,
    };
    if (
      !best ||
      (best.partial && !candidate.partial) ||
      (best.partial === candidate.partial && Math.abs(target - sum) < Math.abs(target - best.sum))
    ) {
      best = candidate;
    }
  }

  function dfs(start, subset, sum) {
    if (subset.length > 0) consider(subset, sum);
    if (subset.length >= maxSize) return;
    for (let i = start; i < candidates.length; i++) {
      const next = sum + candidates[i].amount;
      if (next > target + tol) continue;
      subset.push(candidates[i]);
      dfs(i + 1, subset, next);
      subset.pop();
    }
  }

  dfs(0, [], 0);
  return best;
}

/**
 * Runs every enabled correlation rule over the ledger. Each new pending
 * proposal produces one notification; already-decided proposal hashes are
 * never re-proposed.
 */
export async function runCorrelations() {
  const rules = loadCorrelationRules().filter((r) => r.enabled);
  const proposals = loadProposals();
  const knownHashes = new Set(proposals.map((p) => p.proposalHash));
  const projections = await getProjections();

  const linkedIds = new Set(
    projections.transactions.filter((t) => t.links?.length > 0).map((t) => t.id)
  );

  const result = { rules: rules.length, proposals: 0 };

  for (const rule of rules) {
    const hint = (rule.textHint || '').toLowerCase();
    const candidatesA = projections.transactions.filter((t) => {
      if (t.source !== rule.sourceA) return false;
      if (linkedIds.has(t.id)) return false;
      if (rule.directionA === 'debit' && t.amount >= 0) return false;
      if (rule.directionA === 'credit' && t.amount < 0) return false;
      if (hint && !(`${t.description} ${t.merchant}`.toLowerCase().includes(hint))) return false;
      return true;
    });

    const poolB = projections.transactions.filter(
      (t) => t.source === rule.sourceB && !linkedIds.has(t.id)
    );

    for (const a of candidatesA) {
      const target = Math.abs(a.amount);
      const tol = tolerance(rule, target);
      const window = poolB
        .map((b) => ({ id: b.id, amount: Math.abs(b.amount), days: dayDiff(a.date, b.date), tx: b }))
        .filter((b) => b.days <= rule.dateWindowDays)
        .sort((x, y) => x.days - y.days);
      if (window.length === 0) continue;

      // Single exact-tolerance match first
      let match = null;
      const single = window.find((b) => Math.abs(target - b.amount) <= tol);
      if (single) {
        match = { items: [single], sum: single.amount, partial: false, avgDays: single.days };
      } else if (rule.allowAggregate) {
        match = findAggregate(target, tol, window, rule.maxAggregateSize || 4);
      }
      if (!match) continue;

      const bIds = match.items.map((i) => i.id);
      const hash = proposalHash(rule.id, a.id, bIds);
      if (knownHashes.has(hash)) continue;
      knownHashes.add(hash);

      const proposal = {
        id: uuidv4(),
        proposalHash: hash,
        ruleId: rule.id,
        ruleName: rule.name,
        aTransactionId: a.id,
        bTransactionIds: bIds,
        amountA: a.amount,
        amountB: match.sum,
        partial: match.partial,
        score: scoreMatch(target, match.sum, match.avgDays, rule.dateWindowDays),
        status: 'pending',
        created: new Date().toISOString(),
      };
      proposals.push(proposal);
      result.proposals++;

      notify(
        'correlation',
        'notify.correlation.found',
        {
          amount: a.amount.toFixed(2),
          sourceA: rule.sourceA,
          date: a.date?.slice(0, 10),
          count: bIds.length,
          sourceB: rule.sourceB,
          sum: match.sum.toFixed(2),
          partial: match.partial ? 1 : 0,
        },
        { proposalId: proposal.id, ruleId: rule.id }
      );
    }
  }

  if (result.proposals > 0) saveProposals(proposals);
  return result;
}

// ---------- confirm / reject ----------

export function confirmProposal(id) {
  const proposals = loadProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal || proposal.status !== 'pending') return null;

  const ev = createEvent('transaction_link', 'correlation', {
    link_id: uuidv4(),
    rule_id: proposal.ruleId,
    transaction_ids: [proposal.aTransactionId, ...proposal.bTransactionIds],
    note: proposal.partial ? 'partial match (site balance remainder)' : null,
  });
  appendEvent(ev);

  proposal.status = 'confirmed';
  proposal.decided = new Date().toISOString();
  saveProposals(proposals);
  return { proposal, event: ev };
}

export function rejectProposal(id) {
  const proposals = loadProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal || proposal.status !== 'pending') return null;
  proposal.status = 'rejected';
  proposal.decided = new Date().toISOString();
  saveProposals(proposals);
  return proposal;
}
