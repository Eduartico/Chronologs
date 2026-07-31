/**
 * These tests write to a real ledger, so they run against a throwaway data dir
 * set before any module that resolves paths is imported.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'chronologs-cat-'));
process.env.CHRONOLOGS_DATA_DIR = dataDir;

let mod;
let paths;
let eventStore;
let cache;

before(async () => {
  paths = await import('../lib/paths.js');
  eventStore = await import('../ledger/eventStore.js');
  cache = await import('../projections/cache.js');
  mod = await import('./categorization.js');
  process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));
});

function seed(rows) {
  writeFileSync(paths.ledgerPath(), '', 'utf-8');
  writeFileSync(paths.statePath('categories.json'), '[]', 'utf-8');
  writeFileSync(paths.statePath('rules.json'), JSON.stringify({ version: 2, rules: [] }), 'utf-8');
  cache.invalidateProjections();
  mod.ensureDefaultCategories();

  for (const [id, description, category] of rows) {
    eventStore.appendEvent(
      eventStore.createEvent('transaction', 'test', {
        transaction_id: id,
        date: '2026-05-01',
        description,
        amount: -10,
        currency: 'EUR',
      })
    );
    if (category) {
      eventStore.appendEvent(
        eventStore.createEvent('category_assignment', 'test', {
          event_id: id,
          category,
          confidence: 1,
          rule_id: null,
        })
      );
    }
  }
}

beforeEach(() => {
  paths.bootstrapUserData();
});

test('renaming a category moves its transactions', async () => {
  seed([['t1', 'PROPINAS', 'education'], ['t2', 'LIDL', 'food']]);

  const result = await mod.updateCategory('education', { name: 'Educação' });
  assert.equal(result.moved, 1);

  const projections = await cache.getProjections();
  assert.equal(projections.transactions.find((t) => t.id === 't1').category, 'Educação');
  assert.equal(projections.transactions.find((t) => t.id === 't2').category, 'food');
});

test('renaming a category repoints the rules that target it', async () => {
  seed([['t1', 'PROPINAS', 'education']]);
  writeFileSync(
    paths.statePath('rules.json'),
    JSON.stringify({
      version: 2,
      rules: [
        {
          id: 'r1',
          name: 'propinas',
          order: 10,
          enabled: true,
          conditions: { text: [{ field: 'any', op: 'contains', value: 'propinas' }] },
          actions: { setCategory: 'education', addTags: [] },
        },
      ],
    }),
    'utf-8'
  );

  const result = await mod.updateCategory('education', { name: 'Educação' });
  assert.equal(result.rulesTouched, 1);

  const rules = JSON.parse(readFileSync(paths.statePath('rules.json'), 'utf-8'));
  assert.equal(rules.rules[0].actions.setCategory, 'Educação');
});

test('a renamed default is not resurrected on the next seed', async () => {
  seed([]);
  await mod.updateCategory('education', { name: 'Educação' });
  mod.ensureDefaultCategories();

  const names = mod.getCategories().map((c) => c.name);
  assert.ok(names.includes('Educação'));
  assert.ok(!names.includes('education'), 'the old default name came back');
});

test('deleting a category returns its transactions to uncategorized', async () => {
  seed([['t1', 'ALGO', 'gaming']]);

  const result = await mod.deleteCategory('gaming');
  assert.equal(result.moved, 1);

  const projections = await cache.getProjections();
  assert.equal(projections.transactions.find((t) => t.id === 't1').category, 'uncategorized');
  assert.ok(!mod.getCategories().some((c) => c.id === 'gaming'));
});

test('a deleted default stays deleted', async () => {
  seed([]);
  await mod.deleteCategory('gaming');
  mod.ensureDefaultCategories();
  assert.ok(!mod.getCategories().some((c) => c.id === 'gaming'));
});

test('uncategorized cannot be renamed or deleted', async () => {
  seed([]);
  assert.equal((await mod.updateCategory('uncategorized', { name: 'Outros' })).error, 'protected');
  assert.equal((await mod.deleteCategory('uncategorized')).error, 'protected');
});

test('renaming onto an existing name is rejected', async () => {
  seed([]);
  assert.equal((await mod.updateCategory('education', { name: 'food' })).error, 'duplicate');
});

test('recolouring does not touch any transaction', async () => {
  seed([['t1', 'ALGO', 'gaming']]);
  const result = await mod.updateCategory('gaming', { color: 'hsl(1, 2%, 3%)' });
  assert.equal(result.moved, 0);
  assert.equal(mod.getCategories().find((c) => c.id === 'gaming').color, 'hsl(1, 2%, 3%)');
});

test('createCategory slugifies the id and rejects duplicates', async () => {
  seed([]);
  const cat = mod.createCategory('Ajuda à Carolina');
  assert.equal(cat.id, 'ajuda-a-carolina');
  assert.equal(cat.name, 'Ajuda à Carolina');
  assert.equal(mod.createCategory('ajuda à carolina'), null);
});

test('bulk categorization leaves manual overrides alone', async () => {
  seed([['t1', 'A', null], ['t2', 'B', null]]);
  eventStore.appendEvent(
    eventStore.createEvent('manual_override', 'manual', {
      event_id: 't2',
      original_category: null,
      new_category: 'shopping',
    })
  );

  const result = await mod.applyCategorizationBulk(['t1', 't2'], 'food');
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);

  const projections = await cache.getProjections();
  assert.equal(projections.transactions.find((t) => t.id === 't2').category, 'shopping');
});
