/**
 * The whole projection over a synthetic ledger, asserted against a committed
 * golden file.
 *
 * The other projection tests each check one rule and would all still pass while
 * a refactor quietly changed a field name, dropped `spendingTransactions`, or
 * started reporting a vault to two decimal places instead of one. This asserts
 * the *entire* shape at once, so any such change has to be looked at and
 * deliberately re-blessed rather than noticed months later on a dashboard.
 *
 * Re-bless with:  UPDATE_GOLDEN=1 node --test server/framework/golden.test.js
 * Never do that to make a red test go green. Read the diff first — the point of
 * the file is that it makes an unintended change loud.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { canonical, firstDifference } from '../../scripts/lib/canonical.js';
import {
  SYNTHETIC_EVENTS,
  SYNTHETIC_ASSETS,
} from './__fixtures__/syntheticLedger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, '__fixtures__', 'synthetic-projection.json');

// paths.js resolves CHRONOLOGS_DATA_DIR once at import time, so the temp dir has
// to be chosen before anything imports it.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-golden-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

// Written out as a real ledger file and read back, so line parsing stays on the
// path rather than being bypassed by handing the array straight over.
writeFileSync(
  join(DATA_DIR, 'ledger', 'events.ndjson'),
  SYNTHETIC_EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n',
  'utf-8'
);
writeFileSync(join(DATA_DIR, 'state', 'assets.json'), JSON.stringify(SYNTHETIC_ASSETS), 'utf-8');

const { buildProjections } = await import('../projections/rebuild.js');

async function project() {
  // `events` is the input, not a projection of it, and every transaction already
  // carries the event it came from under `raw`.
  const { events, ...rest } = await buildProjections();
  return canonical(rest);
}

test('the projection over the synthetic ledger matches the golden file', async () => {
  const actual = await project();

  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
    console.log(`  golden file rewritten: ${GOLDEN}`);
    return;
  }

  assert.ok(existsSync(GOLDEN), `no golden file — create it with UPDATE_GOLDEN=1`);
  const expected = JSON.parse(readFileSync(GOLDEN, 'utf-8'));
  const diff = firstDifference(expected, JSON.parse(JSON.stringify(actual)));

  assert.equal(
    diff && `${diff.path}\n    golden: ${diff.expected}\n    now:    ${diff.actual}`,
    null
  );
});

/**
 * A handful of assertions written out in words as well.
 *
 * The golden file above catches everything, but it says nothing about *why* a
 * number is what it is. These are the facts the fixture was built to hold, in a
 * form that survives re-blessing: if someone regenerates the golden file to make
 * a red build green, these still fail.
 */
test('both legs of an internal move are recognised, on either account', async () => {
  const p = await project();
  const internal = p.transactions.filter((t) => t.internal).map((t) => t.id);
  assert.deepEqual(internal.sort(), [
    'tx-vault-deposit-current',
    'tx-vault-deposit-savings',
    'tx-vault-second',
    'tx-vault-second-savings',
    'tx-vault-second-truncated',
    'tx-vault-second-truncated-savings',
    'tx-vault-withdrawal-current',
    'tx-vault-withdrawal-savings',
  ]);
  // …and none of them counts as spending.
  assert.equal(p.spendingTransactions.some((t) => internal.includes(t.id)), false);
});

test('income that merely looks like a transfer stays income', async () => {
  const p = await project();
  const salary = p.transactions.find((t) => t.id === 'tx-salary');
  assert.equal(salary.internal, undefined);
  assert.equal(p.spendingTransactions.some((t) => t.id === 'tx-salary'), true);
});

test('cash at an ATM is recognised rather than left for the review queue', async () => {
  const p = await project();
  const atm = p.transactions.find((t) => t.id === 'tx-atm');
  assert.equal(atm.category, 'cash withdrawal');
  assert.equal(atm.systemCategorized, true);
  // Analytics read the map, not the row, so the verdict has to land in both.
  assert.equal(p.categoryMap['tx-atm'], 'cash withdrawal');
});

test('one movement reported by two documents is one row carrying both events', async () => {
  const p = await project();
  const rows = p.transactions.filter((t) => t.id === 'tx-restaurant');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceEventIds.length, 2);
  // The first reading wins; the second only fills in what it left empty.
  assert.equal(rows[0].account, 'CONTA SIMPLES');
});

test('a manual override outranks an assignment appended after it', async () => {
  const p = await project();
  const row = p.transactions.find((t) => t.id === 'tx-restaurant');
  assert.equal(row.category, 'dining');
  assert.equal(row.overridden, true);
  assert.equal(row.originalCategory, 'groceries');
});

test('facts learned after ingestion are overlaid without touching the original', async () => {
  const p = await project();
  const row = p.transactions.find((t) => t.id === 'tx-unattributed');
  assert.equal(row.account, 'CONTA SIMPLES');
  assert.equal(row.accountId, '11100011100');
  // The event as recorded still says nothing about the account.
  assert.equal(row.raw.payload.account, undefined);
});

test('a void hides a row from every total and an unvoid brings it back', async () => {
  const p = await project();
  assert.equal(p.transactions.some((t) => t.id === 'tx-duplicate-copy'), false);
  assert.equal(p.voidedTransactions.some((t) => t.id === 'tx-duplicate-copy'), true);
  assert.equal(p.transactions.some((t) => t.id === 'tx-wrongly-voided'), true);
});

test('a hand-removed tag is not silently reapplied', async () => {
  const p = await project();
  const row = p.transactions.find((t) => t.id === 'tx-restaurant');
  assert.deepEqual(row.tags, []);
  assert.deepEqual(row.removedTags, ['tag-leisure']);
});

test('a truncated vault name folds into the full one', async () => {
  const p = await project();
  const names = p.vaults.map((v) => v.vault).sort();
  assert.deepEqual(names, ['Fundo de Emergencia', 'Mealheiro']);
  // The clipped spelling contributed its €25 to the full name rather than
  // opening a vault of its own.
  assert.equal(p.vaults.find((v) => v.vault === 'Fundo de Emergencia').deposited, 100);
});

test('the vault split reconciles against the savings statement', async () => {
  const p = await project();
  const r = p.vaultReconciliation;
  assert.equal(r.computed, 250);
  // Interest is the savings account acting on its own — it belongs to no vault,
  // and counting it as one is how a reconciliation quietly stops meaning
  // anything.
  assert.equal(r.interest, 1.25);
  assert.equal(r.statementBalance, 251.25);
  assert.equal(r.unaccounted, 0);
  assert.equal(r.balanced, true);
});

test('two sources coexist and investments stay out of the bank projection', async () => {
  const p = await project();
  assert.deepEqual([...new Set(p.transactions.map((t) => t.source))].sort(), [
    'activobank',
    'pricempire',
  ]);
  assert.equal(p.investments.length, 1);
  assert.equal(p.securityOrders.length, 1);
});

test('a marketplace trade is a position, and the bank debit paired with it is investing', async () => {
  const p = await project();
  // Pricempire's own "Buy 1x …" row describes a holding, not money leaving an
  // account. Counting it beside the bank debit counted every skin twice.
  const trade = p.transactions.find((t) => t.id === 'pricempire-2025-05-02-deadbeef');
  assert.equal(trade.position, true);
  assert.equal(p.spendingTransactions.some((t) => t.id === trade.id), false);
  // The debit it is linked to is the cash leg: still in the flow totals, but as
  // investing, with the reason it was decided on.
  const debit = p.spendingTransactions.find((t) => t.id === 'tx-security-debit');
  assert.equal(debit.investment, 'link');
  // Ordinary spending carries no verdict at all.
  assert.equal(p.transactions.find((t) => t.id === 'tx-restaurant').investment, undefined);
});
