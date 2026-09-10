import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The projection reads whatever ledger `CHRONOLOGS_DATA_DIR` points at, and
 * `lib/paths.js` resolves that once at import time. So the temp dir is fixed for
 * the whole file and chosen *before* anything imports paths — each case then
 * rewrites the ledger in place. `buildProjections` reads the file every call and
 * holds no cache of its own, so the cases stay independent.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-rebuild-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { buildProjections } = await import('./rebuild.js');

/** Overwrites the temp installation's category registry — needed only by the
    tests that check `excludeFromSpending`, which `buildProjections` reads via
    `loadCategories()`. Every other test in this file runs with none, which
    `loadCategories()` treats as an empty registry, not as "use the shipped
    defaults" — that fallback belongs to `ensureDefaultCategories()`, called
    once at server boot, not here. */
function writeCategories(categories) {
  writeFileSync(join(DATA_DIR, 'state', 'categories.json'), JSON.stringify(categories), 'utf-8');
}

async function projectionsOf(events) {
  writeFileSync(
    join(DATA_DIR, 'ledger', 'events.ndjson'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  );
  return buildProjections();
}

let seq = 0;
const txEvent = (transactionId, overrides = {}, documentId = null) => ({
  id: `event-${++seq}`,
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'transaction',
  source: 'activobank',
  hash: `hash-${seq}`,
  payload: {
    transaction_id: transactionId,
    date: '2025-04-01',
    description: 'COMPRA 0412 EST SERVICO A S FREIXO PORTO PT',
    merchant: 'EST SERVICO',
    amount: -2.95,
    ...overrides,
  },
  linked_entities: documentId ? [{ type: 'document', id: documentId }] : [],
});

test('one movement ingested from two documents projects as a single transaction', async () => {
  const p = await projectionsOf([
    txEvent('activobank-2025-04-01--2.95-abc', {}, 'gmail-batch/EXTRATO.pdf'),
    txEvent('activobank-2025-04-01--2.95-abc', {}, 'upload-batch/Extracto.pdf'),
  ]);

  assert.equal(p.transactions.length, 1);
  assert.equal(p.transactions[0].sourceEventIds.length, 2);
});

test('a re-ingested copy fills in fields the first ingestion could not read', async () => {
  const p = await projectionsOf([
    txEvent('tx-1', { account: null, account_id: null }, 'old/EXTRATO.pdf'),
    txEvent('tx-1', { account: 'CONTA SIMPLES', account_id: '45600427404' }, 'new/EXTRATO.pdf'),
  ]);

  assert.equal(p.transactions.length, 1);
  assert.equal(p.transactions[0].account, 'CONTA SIMPLES');
  assert.equal(p.transactions[0].accountId, '45600427404');
});

test('the first ingestion wins for fields both copies declared', async () => {
  const p = await projectionsOf([
    txEvent('tx-1', { description: 'ORIGINAL' }),
    txEvent('tx-1', { description: 'REPARSED' }),
  ]);

  assert.equal(p.transactions[0].description, 'ORIGINAL');
});

test('distinct movements are never folded together', async () => {
  const p = await projectionsOf([
    txEvent('tx-1', { amount: -2.95 }),
    txEvent('tx-2', { amount: -2.95 }),
  ]);

  assert.equal(p.transactions.length, 2);
  assert.deepEqual(
    p.transactions.map((t) => t.sourceEventIds.length),
    [1, 1]
  );
});

test('a decision taken against the re-ingested copy survives the fold', async () => {
  const first = txEvent('tx-1', {}, 'old/EXTRATO.pdf');
  const second = txEvent('tx-1', {}, 'new/EXTRATO.pdf');
  const p = await projectionsOf([
    first,
    second,
    {
      id: 'event-cat',
      timestamp: '2026-01-02T00:00:00.000Z',
      type: 'category_assignment',
      source: 'manual',
      hash: 'hash-cat',
      // Keyed by the *second* event's uuid, which is what the user would have
      // been looking at when the duplicate row was still on screen.
      payload: { event_id: second.id, category: 'transport', confidence: 1 },
      linked_entities: [],
    },
  ]);

  assert.equal(p.transactions.length, 1);
  assert.equal(p.transactions[0].category, 'transport');
  assert.equal(p.transactions[0].status, 'categorized');
});

test('voiding one copy voids the movement, not just that copy', async () => {
  const first = txEvent('tx-1', {}, 'old/EXTRATO.pdf');
  const second = txEvent('tx-1', {}, 'new/EXTRATO.pdf');
  const p = await projectionsOf([
    first,
    second,
    {
      id: 'event-void',
      timestamp: '2026-01-02T00:00:00.000Z',
      type: 'transaction_void',
      source: 'duplicate-review',
      hash: 'hash-void',
      payload: { event_id: 'tx-1', reason: 'duplicate' },
      linked_entities: [],
    },
  ]);

  assert.equal(p.transactions.length, 0);
  assert.equal(p.voidedTransactions.length, 1);
});

/*
 * `excludeFromSpending` on a category. The flag is declared on the shipped
 * `internal_transfer` category and, before this, was never read by anything —
 * `spendingTransactions` only ever checked `.internal`, which the account
 * analysis sets exclusively by *pairing* both legs of a self-transfer. A
 * transaction categorised "internal transfer" by a rule or by hand, with
 * nothing to pair it against, carried the right category and the wrong
 * boolean, and every dashboard aggregate counted it as real money moving.
 */
test('a category flagged excludeFromSpending is kept out of spending even without a paired leg', async () => {
  writeCategories([
    { id: 'internal_transfer', name: 'internal transfer', excludeFromSpending: true },
  ]);
  const solo = txEvent('tx-solo', { amount: -400 });
  const p = await projectionsOf([
    solo,
    {
      id: 'event-cat-internal',
      timestamp: '2026-01-02T00:00:00.000Z',
      type: 'category_assignment',
      source: 'manual',
      hash: 'hash-cat-internal',
      payload: { event_id: solo.id, category: 'internal transfer', confidence: 1 },
      linked_entities: [],
    },
  ]);

  const tx = p.transactions.find((t) => t.id === 'tx-solo');
  assert.equal(tx.internal, undefined, 'nothing paired it, so the account analysis never touches it');
  assert.equal(tx.category, 'internal transfer');
  assert.equal(
    p.spendingTransactions.some((t) => t.id === 'tx-solo'),
    false,
    'the category alone is enough to keep it out of every spending total',
  );
});

test('a category with no excludeFromSpending flag counts as spending, category assignment or not', async () => {
  writeCategories([{ id: 'transport', name: 'transport' }]);
  const solo = txEvent('tx-solo', { amount: -400 });
  const p = await projectionsOf([
    solo,
    {
      id: 'event-cat-transport',
      timestamp: '2026-01-02T00:00:00.000Z',
      type: 'category_assignment',
      source: 'manual',
      hash: 'hash-cat-transport',
      payload: { event_id: solo.id, category: 'transport', confidence: 1 },
      linked_entities: [],
    },
  ]);

  assert.equal(
    p.spendingTransactions.some((t) => t.id === 'tx-solo'),
    true,
    'an ordinary category must not be silently excluded along with the flagged one',
  );
});

test('an empty category registry excludes nothing', async () => {
  // The common case every other test in this file already relies on without
  // saying so: most of them never call writeCategories() at all, which
  // `loadCategories()` treats the same as an explicitly empty array. Made
  // explicit here rather than left implicit, since a shared temp directory
  // means "never called writeCategories" is not the same guarantee as "no
  // categories.json exists yet" once other tests in the file have run.
  writeCategories([]);
  const p = await projectionsOf([txEvent('tx-plain', { amount: -10 })]);
  assert.equal(p.spendingTransactions.some((t) => t.id === 'tx-plain'), true);
});
