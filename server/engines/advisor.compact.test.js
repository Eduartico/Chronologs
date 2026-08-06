import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * `compactLearnedRules`/`applyCompaction` and `patternCandidates`/`applyPattern`
 * write to `rules.json` through `saveRules`, so — like the shadowed-fix tests —
 * they need a real, isolated data directory rather than injected arguments alone.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-advisor-compact-'));
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { compactLearnedRules, applyCompaction, patternCandidates, applyPattern } = await import(
  './advisor.js'
);
const { loadRules, saveRules, ruleMatches } = await import('./rules.js');

function saveRulesV2(rules) {
  writeFileSync(join(DATA_DIR, 'state', 'advisor-feedback.json'), '[]', 'utf-8');
  saveRules(rules);
}

const learned = (id, pattern, category, order) => ({
  id,
  name: pattern,
  order,
  enabled: true,
  stopProcessing: false,
  conditions: { text: [{ field: 'any', op: 'contains', value: pattern }] },
  actions: { setCategory: category, addTags: [] },
  origin: 'learned',
  confidence: 0.7,
});

const tx = (id, description, category) => ({
  id,
  date: '2026-05-20',
  description,
  merchant: description,
  amount: -5,
  category,
  status: category ? 'categorized' : 'pending',
  tags: [],
});

test('a root with concordant learned rules collapses into one', () => {
  saveRulesV2([
    learned('1', 'spar supermarket lisboa', 'food', 10),
    learned('2', 'spar supermarket porto', 'food', 20),
    learned('3', 'spar supermarket sodre', 'food', 30),
  ]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET PORTO', 'food'),
    tx('c', 'COMPRA 0412 SPAR SUPERMARKET SODRE', 'food'),
  ];

  const preview = compactLearnedRules(loadRules(), transactions);
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].category, 'food');
  assert.equal(preview.groups[0].replaces.length, 3);
  assert.equal(preview.removed, 3);
  assert.equal(preview.created, 1);
  assert.equal(preview.changed, 0, 'the real ledger already agrees, nothing should move');

  const result = applyCompaction(preview);
  assert.equal(result.removed, 3);
  assert.equal(result.created, 1);

  const after = loadRules();
  assert.equal(after.filter((r) => r.origin === 'learned').length, 0);
  assert.equal(after.length, 1);
  assert.equal(after[0].actions.setCategory, 'food');
});

test('the merged rule adopts the real majority category, not the first rule written', () => {
  // The first correction happened to be travel — a one-off trip purchase —
  // but every real transaction at this merchant overwhelmingly says food.
  saveRulesV2([
    learned('1', 'pingo doce aeroporto', 'travel', 10),
    learned('2', 'pingo doce cais', 'food', 20),
  ]);
  const transactions = [
    tx('a', 'COMPRA 0412 PINGO DOCE AEROPORTO', 'food'),
    tx('b', 'COMPRA 0412 PINGO DOCE CAIS', 'food'),
    tx('c', 'COMPRA 0412 PINGO DOCE CAIS', 'food'),
    tx('d', 'COMPRA 0412 PINGO DOCE AEROPORTO', 'food'),
  ];

  const preview = compactLearnedRules(loadRules(), transactions);
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].category, 'food');
});

test('an ambiguous root is left untouched', () => {
  saveRulesV2([
    learned('1', 'trf mb way p/ ana', 'food', 10),
    learned('2', 'trf mb way p/ nathalia', 'transfers', 20),
    learned('3', 'trf mb way p/ adam', 'shopping', 30),
  ]);
  // Real transactions for this root land all over the place — the exact
  // shape `ambiguousRoots` exists to detect.
  const transactions = [
    tx('a', 'TRF MB WAY P/ ANA', 'food'),
    tx('b', 'TRF MB WAY P/ NATHALIA', 'transfers'),
    tx('c', 'TRF MB WAY P/ ADAM', 'shopping'),
    tx('d', 'TRF MB WAY P/ CAROL', 'transport'),
    tx('e', 'TRF MB WAY P/ BRUNO', 'housing'),
    tx('f', 'TRF MB WAY P/ INES', 'health'),
    tx('g', 'TRF MB WAY P/ RUI', 'education'),
    tx('h', 'TRF MB WAY P/ SARA', 'entertainment'),
  ];

  const preview = compactLearnedRules(loadRules(), transactions);
  assert.equal(preview.groups.length, 0);

  const after = loadRules();
  assert.equal(after.length, 3, 'the ambiguous root rules are untouched');
});

test('no transaction ends up uncategorized after compacting', () => {
  saveRulesV2([
    learned('1', 'continente matosinhos', 'food', 10),
    learned('2', 'continente porto', 'food', 20),
    learned('3', 'continente maia', 'food', 30),
  ]);
  const transactions = [
    tx('a', 'COMPRA 0412 CONTINENTE MATOSINHOS', 'food'),
    tx('b', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('c', 'COMPRA 0412 CONTINENTE MAIA', 'food'),
  ];

  const preview = compactLearnedRules(loadRules(), transactions);
  const result = applyCompaction(preview);
  assert.ok(result.created > 0);

  const after = loadRules();
  for (const t of transactions) {
    assert.ok(
      after.some((r) => ruleMatches(t, r) && r.actions.setCategory === 'food'),
      `${t.description} should still resolve to food after compaction`
    );
  }
});

test('applyCompaction refuses an empty preview', () => {
  assert.throws(() => applyCompaction({ groups: [] }));
});

test('patternCandidates proposes a rule once three decisions agree, with no rule covering it', () => {
  saveRulesV2([]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET PORTO', 'food'),
    tx('c', 'COMPRA 0412 SPAR SUPERMARKET SODRE', 'food'),
  ];

  const findings = patternCandidates(loadRules(), transactions);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'food');
  assert.equal(findings[0].total, 3);
});

test('patternCandidates stays quiet below the three-decision floor', () => {
  saveRulesV2([]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET PORTO', 'food'),
  ];
  assert.equal(patternCandidates(loadRules(), transactions).length, 0);
});

test('patternCandidates skips a root already covered by a rule', () => {
  saveRulesV2([learned('1', 'spar', 'food', 10)]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET PORTO', 'food'),
    tx('c', 'COMPRA 0412 SPAR SUPERMARKET SODRE', 'food'),
  ];
  assert.equal(patternCandidates(loadRules(), transactions).length, 0);
});

test('applyPattern writes the one rule the observed pattern earned', () => {
  saveRulesV2([]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET PORTO', 'food'),
    tx('c', 'COMPRA 0412 SPAR SUPERMARKET SODRE', 'food'),
  ];
  const finding = patternCandidates(loadRules(), transactions)[0];

  const result = applyPattern(finding);
  assert.equal(result.category, 'food');

  const after = loadRules();
  assert.equal(after.length, 1);
  assert.equal(after[0].origin, 'learned');
  assert.ok(ruleMatches(tx('d', 'COMPRA 0412 SPAR SUPERMARKET MAIA', null), after[0]));
});
