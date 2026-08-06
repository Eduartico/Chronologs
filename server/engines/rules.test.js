import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, ruleMatches } from './rules.js';

const spotifyRule = {
  id: 'r-spotify',
  order: 10,
  enabled: true,
  stopProcessing: true,
  conditions: { text: [{ field: 'any', op: 'contains', value: 'spotify' }] },
  actions: { setCategory: 'subscriptions', addTags: [] },
};

const tripRule = {
  id: 'r-trip',
  order: 20,
  enabled: true,
  stopProcessing: false,
  conditions: { dateRange: { from: '2026-07-10', to: '2026-07-25' } },
  actions: { setCategory: null, addTags: ['tag-viagem-2026'] },
};

test('canonical example: subscription rule stops trip tagging', () => {
  const spotifyTx = {
    description: 'PAG SERV SPOTIFY',
    merchant: 'SPOTIFY',
    date: '2026-07-12',
    amount: -8.99,
    source: 'activobank',
  };
  const outcome = evaluateRules(spotifyTx, [spotifyRule, tripRule]);
  assert.equal(outcome.category, 'subscriptions');
  assert.deepEqual(outcome.tags, []); // stopProcessing prevented the trip tag
});

test('canonical example: restaurant in date range gets the trip tag', () => {
  const restaurantTx = {
    description: 'COMPRA 555 RESTAURANTE MAR',
    merchant: 'RESTAURANTE MAR',
    date: '2026-07-12',
    amount: -35.0,
    source: 'activobank',
  };
  const outcome = evaluateRules(restaurantTx, [spotifyRule, tripRule]);
  assert.equal(outcome.category, null);
  assert.deepEqual(outcome.tags, ['tag-viagem-2026']);
});

test('rules run in order and first category wins', () => {
  const a = { ...spotifyRule, id: 'a', order: 5, stopProcessing: false, actions: { setCategory: 'first', addTags: [] } };
  const b = { ...spotifyRule, id: 'b', order: 15, actions: { setCategory: 'second', addTags: [] } };
  const tx = { description: 'spotify', merchant: '', date: '2026-01-01', amount: -1, source: 'manual' };
  const outcome = evaluateRules(tx, [b, a]); // deliberately unsorted input
  assert.equal(outcome.category, 'first');
});

test('disabled rules are skipped', () => {
  const outcome = evaluateRules(
    { description: 'spotify', merchant: '', date: '2026-01-01', amount: -1, source: 'manual' },
    [{ ...spotifyRule, enabled: false }]
  );
  assert.equal(outcome.category, null);
});

test('amountRange matches absolute value', () => {
  const rule = {
    id: 'r',
    order: 1,
    enabled: true,
    conditions: { amountRange: { min: 50, max: 150 } },
    actions: { setCategory: 'big', addTags: [] },
  };
  const match = { description: 'x', merchant: '', date: '2026-01-01', amount: -100, source: 'manual' };
  const noMatch = { ...match, amount: -10 };
  assert.equal(evaluateRules(match, [rule]).category, 'big');
  assert.equal(evaluateRules(noMatch, [rule]).category, null);
});

test('direction condition distinguishes debit and credit', () => {
  const debitRule = {
    id: 'r',
    order: 1,
    enabled: true,
    conditions: { direction: 'debit' },
    actions: { setCategory: 'expense', addTags: [] },
  };
  assert.equal(
    evaluateRules({ description: 'x', merchant: '', date: '2026-01-01', amount: -5, source: 'manual' }, [debitRule]).category,
    'expense'
  );
  assert.equal(
    evaluateRules({ description: 'x', merchant: '', date: '2026-01-01', amount: 5, source: 'manual' }, [debitRule]).category,
    null
  );
});

test('sources condition filters by platform', () => {
  const rule = {
    id: 'r',
    order: 1,
    enabled: true,
    conditions: { sources: ['pricempire'] },
    actions: { setCategory: 'gaming', addTags: [] },
  };
  assert.equal(
    evaluateRules({ description: 'x', merchant: '', date: '2026-01-01', amount: -5, source: 'pricempire' }, [rule]).category,
    'gaming'
  );
  assert.equal(
    evaluateRules({ description: 'x', merchant: '', date: '2026-01-01', amount: -5, source: 'activobank' }, [rule]).category,
    null
  );
});

test('regex op works and invalid regex fails closed', () => {
  const rule = {
    id: 'r',
    order: 1,
    enabled: true,
    conditions: { text: [{ field: 'description', op: 'regex', value: '^COMPRA \\d+' }] },
    actions: { setCategory: 'shopping', addTags: [] },
  };
  const tx = { description: 'COMPRA 123 LOJA', merchant: '', date: '2026-01-01', amount: -5, source: 'manual' };
  assert.equal(evaluateRules(tx, [rule]).category, 'shopping');

  const broken = { ...rule, conditions: { text: [{ field: 'description', op: 'regex', value: '[' }] } };
  assert.equal(evaluateRules(tx, [broken]).category, null);
});

test('lenient matching skips date/amount/source conditions for pseudo-transactions', () => {
  const rule = {
    id: 'r',
    enabled: true,
    conditions: {
      text: [{ field: 'any', op: 'contains', value: 'continente' }],
      dateRange: { from: '2026-07-01', to: '2026-07-31' },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  const pseudo = { description: 'COMPRA CONTINENTE', merchant: '', date: null, amount: null, source: null };
  assert.equal(ruleMatches(pseudo, rule), false);
  assert.equal(ruleMatches(pseudo, rule, { lenient: true }), true);
});

// ---------- nested condition trees ----------
//
// `conditions.tree` is what lets a rule say "(A or B) and not C" — the flat
// shape above can only AND groups together and OR entries inside `text`. Every
// rule the correction-learning path writes stays in that flat shape forever;
// these only exercise the opt-in path a rule takes when built through the tree
// editor.

const supermarketTx = (overrides = {}) => ({
  description: 'COMPRA 0412 CONTINENTE MATOSINHOS',
  merchant: 'CONTINENTE MATOSINHOS',
  date: '2026-07-15',
  amount: -42.5,
  source: 'activobank',
  ...overrides,
});

test('a tree rule with no tree falls through to the flat evaluator unchanged', () => {
  // The ~400 learned rules already on file have no `tree` key at all — this is
  // what proves adding the feature could not have touched them.
  const rule = {
    id: 'r',
    enabled: true,
    conditions: { text: [{ field: 'any', op: 'contains', value: 'continente' }] },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx(), rule), true);
});

test('"any" (OR) matches when either branch matches', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'any',
        children: [
          { field: 'merchant', op: 'contains', value: 'pingo doce' },
          { field: 'merchant', op: 'contains', value: 'continente' },
        ],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx(), rule), true);
  assert.equal(ruleMatches(supermarketTx({ merchant: 'LIDL PORTO' }), rule), false);
});

test('"all" (AND) requires every branch', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'all',
        children: [
          { field: 'merchant', op: 'contains', value: 'continente' },
          { field: 'direction', op: 'equals', value: 'debit' },
        ],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx(), rule), true);
  assert.equal(ruleMatches(supermarketTx({ amount: 42.5 }), rule), false); // credit, fails the second branch
});

test('"not" inverts its children', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'all',
        children: [
          { field: 'merchant', op: 'contains', value: 'continente' },
          { op: 'not', children: [{ field: 'amount', op: 'gt', value: 100 }] },
        ],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx(), rule), true); // 42.50, not over 100
  assert.equal(ruleMatches(supermarketTx({ amount: -150 }), rule), false); // over 100, NOT excludes it
});

test('groups nest: (A or B) and not C', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'all',
        children: [
          {
            op: 'any',
            children: [
              { field: 'merchant', op: 'contains', value: 'continente' },
              { field: 'merchant', op: 'contains', value: 'pingo doce' },
            ],
          },
          { op: 'not', children: [{ field: 'direction', op: 'equals', value: 'credit' }] },
        ],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx(), rule), true);
  assert.equal(ruleMatches(supermarketTx({ merchant: 'PINGO DOCE MAIA' }), rule), true);
  assert.equal(ruleMatches(supermarketTx({ merchant: 'LIDL' }), rule), false); // matches neither OR branch
  assert.equal(ruleMatches(supermarketTx({ amount: 42.5 }), rule), false); // credit, NOT excludes it
});

test('amount "between" on a tree leaf', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: { op: 'all', children: [{ field: 'amount', op: 'between', value: { min: 10, max: 50 } }] },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx({ amount: -42.5 }), rule), true);
  assert.equal(ruleMatches(supermarketTx({ amount: -5 }), rule), false);
  assert.equal(ruleMatches(supermarketTx({ amount: -80 }), rule), false);
});

test('date "between" on a tree leaf', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'all',
        children: [{ field: 'date', op: 'between', value: { from: '2026-07-01', to: '2026-07-31' } }],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  assert.equal(ruleMatches(supermarketTx({ date: '2026-07-15' }), rule), true);
  assert.equal(ruleMatches(supermarketTx({ date: '2026-08-01' }), rule), false);
});

test('a tree leaf is lenient the same way a flat condition is', () => {
  const rule = {
    id: 'r',
    conditions: {
      tree: {
        op: 'all',
        children: [
          { field: 'merchant', op: 'contains', value: 'continente' },
          { field: 'amount', op: 'gt', value: 10 },
        ],
      },
    },
    actions: { setCategory: 'food', addTags: [] },
  };
  const pseudo = { description: '', merchant: 'CONTINENTE', date: null, amount: null, source: null };
  assert.equal(ruleMatches(pseudo, rule), false);
  assert.equal(ruleMatches(pseudo, rule, { lenient: true }), true);
});
