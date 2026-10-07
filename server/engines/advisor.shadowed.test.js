import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * `applyShadowedFix` writes to `rules.json` through `saveRules`, so — like the
 * travel tag tests — it needs a real, isolated data directory rather than
 * injected arguments alone.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-advisor-shadowed-'));
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { shadowedRules, applyShadowedFix } = await import('./advisor.js');
const { loadRules, saveRules } = await import('./rules.js');

const rule = (id, pattern, category, order, extra = {}) => ({
  id,
  name: pattern,
  order,
  enabled: true,
  stopProcessing: false,
  conditions: { text: [{ field: 'any', op: 'contains', value: pattern }] },
  actions: { setCategory: category, addTags: [] },
  origin: 'learned',
  ...extra,
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

function saveRulesV2(rules) {
  writeFileSync(join(DATA_DIR, 'state', 'advisor-feedback.json'), '[]', 'utf-8');
  saveRules(rules);
}

test('the general rule "minipreco" shadows the specific "minipreco campanha"', async () => {
  saveRulesV2([
    rule('general', 'minipreco', 'shopping', 10),
    rule('specific', 'minipreco campanha', 'food', 20),
  ]);

  const transactions = [
    tx('a', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food'),
    tx('b', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food'),
    tx('c', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food'),
  ];

  const findings = shadowedRules(loadRules(), transactions);
  const finding = findings.find((f) => f.subject === 'specific');
  assert.ok(finding, 'the specific rule should be reported as shadowed');
  assert.equal(finding.shadowedBy.id, 'general');
  assert.equal(finding.redundant, false);
  // Every real transaction the general rule actually catches here resolved to
  // food, not shopping — so retargeting is offered as the other way out.
  assert.equal(finding.retargetTo, 'food');
});

test('promoting moves the shadowed rule directly above the one stealing its transactions', async () => {
  saveRulesV2([
    rule('general', 'minipreco', 'shopping', 10),
    rule('specific', 'minipreco campanha', 'food', 20),
  ]);
  const transactions = [tx('a', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food')];
  const finding = shadowedRules(loadRules(), transactions)[0];

  const result = applyShadowedFix(finding, 'promote');
  assert.equal(result.action, 'promote');

  const after = loadRules();
  const specific = after.find((r) => r.id === 'specific');
  const general = after.find((r) => r.id === 'general');
  assert.ok(specific.order < general.order, 'the specific rule now runs first');
});

test('retargeting rewrites the general rule to the majority category, not the shadowed one', async () => {
  saveRulesV2([
    rule('general', 'minipreco', 'shopping', 10),
    rule('specific', 'minipreco campanha', 'food', 20),
  ]);
  const transactions = [
    tx('a', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food'),
    tx('b', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food'),
  ];
  const finding = shadowedRules(loadRules(), transactions)[0];

  const result = applyShadowedFix(finding, 'retarget');
  assert.equal(result.category, 'food');

  const after = loadRules();
  assert.equal(after.find((r) => r.id === 'general').actions.setCategory, 'food');
  // The specific rule is untouched — retargeting fixes the general rule, not
  // the one that was shadowed by it.
  assert.equal(after.find((r) => r.id === 'specific').actions.setCategory, 'food');
});

test('deleting only ever applies when the two rules already agree', async () => {
  saveRulesV2([
    rule('general', 'lidl', 'food', 10),
    rule('specific', 'lidl porto', 'food', 20),
  ]);
  const transactions = [tx('a', 'COMPRA 0412 LIDL PORTO', 'food')];
  const finding = shadowedRules(loadRules(), transactions)[0];
  assert.equal(finding.redundant, true);

  const result = applyShadowedFix(finding, 'delete');
  assert.equal(result.action, 'delete');
  assert.equal(loadRules().some((r) => r.id === 'specific'), false);
  assert.equal(loadRules().some((r) => r.id === 'general'), true);
});

test('deleting a genuinely different pair is allowed and reports zero impact', async () => {
  // A shadowed rule never wins today — that's what "shadowed" means — so
  // deleting it can never change a single existing categorization, whether
  // or not it agrees with the rule that was beating it. The guard that used
  // to refuse this outside the redundant case blocked exactly the fix
  // Eduardo wanted for real cases ("pingo doce cais do s li" tapada por
  // "pingo doce": he wanted the specific one gone, not promoted).
  saveRulesV2([
    rule('general', 'minipreco', 'shopping', 10),
    rule('specific', 'minipreco campanha', 'food', 20),
  ]);
  const transactions = [tx('a', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food')];
  const finding = shadowedRules(loadRules(), transactions)[0];
  assert.equal(finding.redundant, false);

  const result = applyShadowedFix(finding, 'delete', transactions);
  assert.equal(result.action, 'delete');
  assert.equal(result.impact.affected, 0);
  assert.equal(loadRules().some((r) => r.id === 'specific'), false);
  assert.equal(loadRules().some((r) => r.id === 'general'), true);
});

test('deleteGeneral removes the shadowing rule instead, when it is learned', async () => {
  saveRulesV2([
    rule('general', 'spar supermarket', 'shopping', 10),
    rule('specific', 'spar supermarket', 'food', 20),
  ]);
  const transactions = [
    tx('a', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
    tx('b', 'COMPRA 0412 SPAR SUPERMARKET LISBOA', 'food'),
  ];
  const finding = shadowedRules(loadRules(), transactions)[0];
  assert.equal(finding.canDeleteGeneral, true);

  const result = applyShadowedFix(finding, 'deleteGeneral', transactions);
  assert.equal(result.action, 'deleteGeneral');
  assert.equal(result.removed, 'general');
  // The general rule was the one actually winning today (it ran first and
  // said shopping) — removing it lets the specific rule decide instead, which
  // genuinely moves both transactions from shopping to food.
  assert.equal(result.impact.affected, 2);
  assert.equal(result.impact.changes[0].before, 'shopping');
  assert.equal(result.impact.changes[0].after, 'food');
  assert.equal(loadRules().some((r) => r.id === 'general'), false);
  assert.equal(loadRules().some((r) => r.id === 'specific'), true);
});

test('deleteGeneral refuses a hand-written rule', async () => {
  saveRulesV2([
    rule('general', 'minipreco', 'shopping', 10, { origin: 'manual' }),
    rule('specific', 'minipreco campanha', 'food', 20),
  ]);
  const transactions = [tx('a', 'COMPRA 0412 MINIPRECO CAMPANHA PORTO', 'food')];
  const finding = shadowedRules(loadRules(), transactions)[0];
  assert.equal(finding.canDeleteGeneral, false);

  assert.throws(() => applyShadowedFix(finding, 'deleteGeneral', transactions));
});
