import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * `collapseCandidates` reads `advisor-feedback.json` through `rejectedIds()`
 * to skip suggestions the user already turned down — without an isolated
 * data directory that reads the *real* one, and a real rejection can share
 * a stable id with a synthetic test fixture by coincidence (the "trf mb
 * way" merge here did, once Eduardo actually rejected that exact merge in
 * the live app), silently filtering a candidate the test expects to see.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-advisor-'));
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { collapseCandidates, anomalyCandidates } = await import('./advisor.js');

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

const tx = (id, description, category = 'food') => ({
  id,
  date: '2026-05-20',
  description,
  merchant: description,
  amount: -10,
  category,
  status: 'categorized',
  tags: [],
});

test('collapseCandidates bundles rules that share a merchant root', () => {
  const rules = [
    learned('1', 'trf mb way p/ ana', 'transfers', 10),
    learned('2', 'trf mb way p/ nathalia', 'transfers', 20),
    learned('3', 'trf mb way p/ adam', 'transfers', 30),
  ];
  const candidates = collapseCandidates(rules, []);
  const root = candidates.find((c) => c.level === 'root');
  assert.ok(root);
  assert.equal(root.replaces.length, 3);
  assert.equal(root.category, 'transfers');
  assert.equal(root.patterns.length, 3);
});

test('a cluster smaller than three rules is not worth merging', () => {
  const rules = [
    learned('1', 'pingo doce porto', 'food', 10),
    learned('2', 'pingo doce maia', 'food', 20),
  ];
  assert.equal(collapseCandidates(rules, []).length, 0);
});

test('rules pointing at different categories are never merged together', () => {
  const rules = [
    learned('1', 'trf mb way p/ ana', 'transfers', 10),
    learned('2', 'trf mb way p/ nathalia', 'transfers', 20),
    learned('3', 'trf mb way p/ adam', 'transfers', 30),
    learned('4', 'trf mb way p/ carol', 'food', 40),
  ];
  const roots = collapseCandidates(rules, []).filter((c) => c.level === 'root');
  assert.equal(roots.length, 1);
  assert.equal(roots[0].category, 'transfers');
  assert.equal(roots[0].replaces.length, 3);
});

test('a rule doing more than matching text is left alone', () => {
  const rules = [
    learned('1', 'pingo doce porto', 'food', 10),
    learned('2', 'pingo doce maia', 'food', 20),
    { ...learned('3', 'pingo doce gaia', 'food', 30), stopProcessing: true },
    { ...learned('4', 'pingo doce braga', 'food', 40), actions: { setCategory: 'food', addTags: ['t1'] } },
  ];
  const roots = collapseCandidates(rules, []).filter((c) => c.level === 'root');
  assert.equal(roots.length, 0);
});

// The check that makes accepting a merge safe: a merged rule inherits the
// earliest order of the group, so it can start winning against a rule that used
// to run first.
test('collapseCandidates reports transactions that would change category', () => {
  const rules = [
    learned('1', 'continente', 'food', 10),
    learned('2', 'continente bom dia', 'food', 20),
    learned('3', 'continente modelo', 'food', 30),
    // Sits between the food rules and claims this transaction today. The merged
    // rule would inherit order 10 and jump ahead of it.
    { ...learned('4', 'lidl', 'shopping', 25) },
    learned('5', 'lidl agradece', 'food', 40),
    learned('6', 'lidl porto', 'food', 50),
    learned('7', 'lidl gaia', 'food', 60),
    // A category-wide merge is only offered above a size threshold.
    learned('8', 'pingo doce', 'food', 70),
    learned('9', 'adega leonor', 'food', 80),
  ];
  const transactions = [tx('a', 'COMPRA 0412 LIDL AGRADECE 1050', 'food')];
  const category = collapseCandidates(rules, transactions).find(
    (c) => c.level === 'category' && c.category === 'food'
  );
  assert.ok(category);
  assert.equal(category.lossless, false);
  assert.equal(category.changed, 1);
  assert.equal(category.changes[0].before, 'shopping');
  assert.equal(category.changes[0].after, 'food');
});

test('anomalyCandidates flags the odd one out in a merchant group', () => {
  const transactions = [
    tx('1', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('2', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('3', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('4', 'COMPRA 0412 CONTINENTE PORTO', 'shopping'),
  ];
  const findings = anomalyCandidates(transactions, []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].transaction.id, '4');
  assert.equal(findings[0].expected, 'food');
});

/*
 * The travel exception, which is the whole reason the advisor knows about trips.
 * Being inside the trip is now the entire test. It used to also require the
 * transaction to be categorized `travel`, which was fair while claiming a
 * transaction for a trip overwrote its category — that is no longer true, and an
 * odd-one-out abroad is explained by being abroad whatever it is filed under.
 */
test('an odd one out during a detected trip is not flagged', () => {
  const transactions = [
    { ...tx('1', 'COMPRA 0412 SUPERMERCADO', 'food'), date: '2026-01-10' },
    { ...tx('2', 'COMPRA 0412 SUPERMERCADO', 'food'), date: '2026-01-11' },
    { ...tx('3', 'COMPRA 0412 SUPERMERCADO', 'food'), date: '2026-01-12' },
    { ...tx('4', 'COMPRA 0412 SUPERMERCADO', 'shopping'), date: '2026-04-25' },
  ];
  const travels = [
    { id: 't1', name: 'Valencia', startDate: '2026-04-20', endDate: '2026-04-30', forgivingDays: 2 },
  ];
  assert.equal(anomalyCandidates(transactions, travels).length, 0);
  // Without the trip, the same transaction is worth asking about.
  assert.equal(anomalyCandidates(transactions, []).length, 1);
});

test('a merchant group that is not lopsided is left alone', () => {
  const transactions = [
    tx('1', 'COMPRA 0412 GALP PORTO', 'transport'),
    tx('2', 'COMPRA 0412 GALP PORTO', 'transport'),
    tx('3', 'COMPRA 0412 GALP PORTO', 'food'),
    tx('4', 'COMPRA 0412 GALP PORTO', 'food'),
  ];
  assert.equal(anomalyCandidates(transactions, []).length, 0);
});

test('pending transactions are not judged', () => {
  const transactions = [
    tx('1', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('2', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    tx('3', 'COMPRA 0412 CONTINENTE PORTO', 'food'),
    { ...tx('4', 'COMPRA 0412 CONTINENTE PORTO', 'uncategorized'), status: 'pending' },
  ];
  assert.equal(anomalyCandidates(transactions, []).length, 0);
});
