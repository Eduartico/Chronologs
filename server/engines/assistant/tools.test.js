import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Every tool, against an invented ledger.
 *
 * The point is not the arithmetic — that is tested where each engine lives —
 * but the contract the model is handed: every tool runs with no arguments,
 * every result is JSON the window can hold, every period is echoed back, and
 * nothing here can throw at the model or write to disk.
 */
const DIR = mkdtempSync(join(tmpdir(), 'chronologs-assistant-'));
process.env.CHRONOLOGS_DATA_DIR = DIR;
mkdirSync(join(DIR, 'state'), { recursive: true });
writeFileSync(
  join(DIR, 'state', 'categories.json'),
  JSON.stringify([
    { id: 'food', name: 'food' },
    { id: 'housing', name: 'housing' },
    { id: 'income', name: 'income' },
    { id: 'travel', name: 'travel', derived: true },
  ]),
);
writeFileSync(join(DIR, 'state', 'budgets.json'), JSON.stringify({ goals: { food: 300 } }));

const { TOOLS, toolDefinitions, runTool, buildToolContext, resolveRange } = await import('./tools.js');

test.after(() => rmSync(DIR, { recursive: true, force: true }));

const TODAY = '2026-03-15';

function tx(id, date, amount, category, extra = {}) {
  return {
    id,
    date,
    amount,
    category,
    // The recurring detector keys on the description, as the bank writes it.
    description: extra.description || extra.merchant || category.toUpperCase(),
    merchant: extra.merchant || category.toUpperCase(),
    currency: 'EUR',
    status: 'categorized',
    tags: [],
    account: 'Current',
    ...extra,
  };
}

function fixture() {
  const rows = [];
  let n = 0;
  // Fourteen months of a salary, rent and groceries, so cadences and trends exist.
  for (let m = 0; m < 14; m++) {
    const d = new Date(Date.UTC(2025, 1 + m, 1));
    const ym = d.toISOString().slice(0, 7);
    if (ym > TODAY.slice(0, 7)) break;
    rows.push(tx(`s${n++}`, `${ym}-01`, 2000, 'income', { merchant: 'EMPLOYER' }));
    rows.push(tx(`r${n++}`, `${ym}-03`, -700, 'housing', { merchant: 'LANDLORD' }));
    rows.push(tx(`g${n++}`, `${ym}-05`, -120, 'food', { merchant: 'CONTINENTE' }));
    rows.push(tx(`g${n++}`, `${ym}-12`, -80, 'food', { merchant: 'PINGO DOCE' }));
  }
  // One investment so the flow split has something to keep apart.
  rows.push(tx(`i${n++}`, '2026-03-02', -500, 'investments', { investment: 'order', merchant: 'ETF ORDER' }));
  const categoryMap = Object.fromEntries(rows.map((r) => [r.id, r.category]));
  return {
    transactions: rows,
    spendingTransactions: rows,
    categoryMap,
    accounts: [{ id: 'a1', name: 'Current', kind: 'current', lastBalance: 1500.5, lastBalanceDate: '2026-03-14' }],
    vaults: [{ name: 'Férias', balance: 400 }],
    vaultTotal: 400,
    assets: [],
    securityOrders: [],
    priceMap: {},
  };
}

const ctx = () => buildToolContext({ projections: fixture(), settings: { currency: { base: 'EUR' } }, today: TODAY });

test('the catalogue is in the wire shape Ollama takes', () => {
  const defs = toolDefinitions();
  assert.ok(defs.length >= 10);
  for (const d of defs) {
    assert.equal(d.type, 'function');
    assert.match(d.function.name, /^[a-z_]+$/);
    assert.ok(d.function.description.length > 30, `${d.function.name} needs a description the model can choose by`);
    assert.equal(d.function.parameters.type, 'object');
  }
  assert.equal(new Set(defs.map((d) => d.function.name)).size, defs.length, 'tool names are unique');
});

test('every tool runs with no arguments and returns JSON the window can hold', () => {
  const c = ctx();
  for (const tool of TOOLS) {
    const result = runTool(tool.name, {}, c);
    assert.equal(result.error, undefined, `${tool.name}: ${result.error}`);
    const text = JSON.stringify(result);
    assert.ok(text.length < 20000, `${tool.name} returned ${text.length} chars`);
    assert.ok(!text.includes('"raw"'), `${tool.name} leaked the raw event`);
  }
});

test('a range is resolved honestly and echoed back', () => {
  assert.deepEqual(resolveRange({ month: '2026-02' }, TODAY), { from: '2026-02-01', to: '2026-02-28', label: '2026-02' });
  assert.deepEqual(resolveRange({}, TODAY), { from: '2025-12-16', to: TODAY, label: `2025-12-16..${TODAY}` });
  // Swapped bounds are a mistake, not an empty range.
  assert.equal(resolveRange({ from: '2026-03-10', to: '2026-03-01' }, TODAY).from, '2026-03-01');
  // Garbage falls back rather than throwing at the model.
  assert.equal(resolveRange({ from: 'yesterday' }, TODAY).to, TODAY);
  const overview = runTool('period_overview', { month: '2026-02' }, ctx());
  assert.equal(overview.period.from, '2026-02-01');
  assert.equal(overview.spent, 900);
  assert.equal(overview.income, 2000);
});

test('investing is kept apart from spending in the overview', () => {
  const overview = runTool('period_overview', { month: '2026-03' }, ctx());
  assert.equal(overview.invested, 500);
  assert.equal(overview.spent, 900);
  assert.equal(overview.kept, 600);
  assert.ok(!overview.topCategories.some((c) => c.category === 'investments'));
});

test('spending_by_category drills into one category with its biggest items', () => {
  const r = runTool('spending_by_category', { month: '2026-02', category: 'food' }, ctx());
  assert.equal(r.categories.length, 1);
  assert.equal(r.categories[0].spent, 200);
  assert.equal(r.categories[0].previousPeriod, 200);
  assert.equal(r.biggestItems[0].amount, -120);
  assert.equal(r.biggestItems[0].description, 'CONTINENTE');
});

test('search_transactions caps rows and reports the full count', () => {
  const r = runTool('search_transactions', { text: 'continente', from: '2025-01-01', limit: 3 }, ctx());
  assert.ok(r.matches > 3);
  assert.equal(r.transactions.length, 3);
  assert.equal(r.shown, 3);
  assert.ok(r.transactions[0].date >= r.transactions[1].date, 'newest first');
  // The hard cap holds whatever the model asks for.
  assert.equal(runTool('search_transactions', { from: '2025-01-01', limit: 999 }, ctx()).transactions.length <= 40, true);
});

test('recurring_bills finds the rent and the salary', () => {
  const r = runTool('recurring_bills', {}, ctx());
  const names = r.series.map((s) => s.name);
  assert.ok(names.some((n) => /landlord/i.test(n)), `rent missing from ${names}`);
  assert.ok(names.some((n) => /employer/i.test(n)), `salary missing from ${names}`);
  assert.ok(r.monthlyOut >= 700);
  assert.ok(r.monthlyIn >= 2000);
});

test('budget_goals reads the goal set on disk', () => {
  const r = runTool('budget_goals', { month: '2026-02' }, ctx());
  const food = r.goals.find((g) => g.category === 'food');
  assert.equal(food.goal, 300);
  assert.equal(food.spent, 200);
  assert.equal(food.status, 'ok');
});

test('net_worth never adds the vaults on top of the account', () => {
  const r = runTool('net_worth', {}, ctx());
  const cash = r.components.find((c) => c.id === 'cash');
  assert.equal(cash.value, 1500.5);
  assert.equal(r.vaultTotal, 400);
  assert.equal(r.accounts[0].balance, 1500.5);
});

test('an unknown tool or bad arguments answer with an error, never a throw', () => {
  assert.match(runTool('delete_everything', {}, ctx()).error, /Unknown tool/);
  assert.equal(runTool('top_merchants', '{"limit": 2}', ctx()).merchants.length, 2);
  assert.equal(runTool('top_merchants', 'not json', ctx()).merchants.length > 0, true);
  assert.equal(runTool('monthly_trend', { months: 'lots' }, ctx()).months.length, 12);
});

test('every tool has a label in the catalogue, so the evidence chips read as words', async () => {
  const { default: en } = await import('../../../web/src/i18n/locales/en.js');
  for (const tool of TOOLS) {
    assert.ok(en[`assistant.tool.${tool.name}`], `en.js has no assistant.tool.${tool.name}`);
  }
});
