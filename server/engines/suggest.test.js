import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDescription,
  normalizeMerchantKey,
  buildSuggestionContext,
  suggestForTransaction,
  groupByMerchant,
  sortTransactions,
} from './suggest.js';

// The context builder reads the user's rules and trips from disk; these tests
// only assert on behaviour that comes from the bundled templates/keywords plus
// what is passed in explicitly, so a populated rules.json or travels.json
// cannot break them. Trips are injected because they are date-driven, and the
// fixture dates would otherwise land inside whichever holiday is on file.
const ctx = (history = [], travels = []) => buildSuggestionContext(history, { travels });

const tx = (description, extra = {}) => ({
  id: extra.id || description,
  description,
  merchant: extra.merchant ?? '',
  amount: extra.amount ?? -10,
  date: extra.date ?? '2026-05-01',
  status: extra.status,
  category: extra.category,
  overridden: extra.overridden,
});

test('cleanDescription strips the rotating card number', () => {
  assert.equal(cleanDescription('COMPRA 3987 SUPERMERCADO FROIZ PORT CONTACTLESS'), 'SUPERMERCADO FROIZ');
  assert.equal(cleanDescription('COMPRA 0412 SUPERMERCADO FROIZ PORT CONTACTLESS'), 'SUPERMERCADO FROIZ');
});

test('cleanDescription drops the foreign-exchange rate suffix', () => {
  // Every dmarket purchase carries a different rate, which would otherwise make
  // each one its own group.
  assert.equal(cleanDescription('COMPRA 3465 dmarket.com Lond USD TC 0.8650793'), 'DMARKET.COM');
  assert.equal(cleanDescription('COMPRA 3465 dmarket.com Lond USD TC 0.8447368'), 'DMARKET.COM');
});

test('cleanDescription removes a service reference without leaving punctuation', () => {
  assert.equal(
    cleanDescription('PAG SERV 10316/208858552 UNIVERSIDADE DO PORTO'),
    'UNIVERSIDADE DO PORTO'
  );
});

test('cleanDescription unwraps a phone-number service payment', () => {
  assert.equal(cleanDescription('PAG. 910030681 - VODAFONE'), 'VODAFONE');
  assert.equal(cleanDescription('PAG. 916821130 - VODAFONE'), 'VODAFONE');
});

test('cleanDescription drops order references but keeps short names', () => {
  assert.equal(cleanDescription('COMPRA 3465 Glovo 03SEP OP19XCEE1 Lisbon ES'), 'GLOVO');
  assert.equal(cleanDescription('COMPRA 3465 H3 PORTO'), 'H3');
});

test('normalizeMerchantKey collapses variants of the same shop', () => {
  const a = normalizeMerchantKey(tx('COMPRA 3465 CONTINENTE BOM DIA PORTO'));
  const b = normalizeMerchantKey(tx('COMPRA 3987 CONTINENTE BOM DIA PORT CONTACTLESS'));
  assert.equal(a.key, b.key);
});

test('a university payment is suggested as education', () => {
  const s = suggestForTransaction(tx('PAG SERV 10316/208858552 UNIVERSIDADE DO PORTO'), ctx());
  assert.equal(s[0].category, 'education');
  assert.equal(s[0].source, 'keyword');
});

const TRIP = [
  {
    id: 'trip-1',
    name: 'Leste Europeu',
    startDate: '2025-02-12',
    endDate: '2025-03-04',
    forgivingDays: 2,
    status: 'confirmed',
    category: 'travel',
  },
];

test('spending on a date inside a trip is suggested as travel', () => {
  const s = suggestForTransaction(tx('COMPRA 0412 ZING BURGER BUDAPEST HU', { date: '2025-02-20' }), ctx([], TRIP));
  const travel = s.find((x) => x.source === 'travel');
  assert.equal(travel.category, 'travel');
  assert.match(travel.reason, /Leste Europeu/);
});

test('spending outside every trip window gets no travel suggestion', () => {
  const s = suggestForTransaction(tx('COMPRA 0412 ZING BURGER BUDAPEST HU', { date: '2025-06-20' }), ctx([], TRIP));
  assert.equal(s.find((x) => x.source === 'travel'), undefined);
});

test('a rejected trip never suggests anything', () => {
  const rejected = [{ ...TRIP[0], status: 'rejected' }];
  const s = suggestForTransaction(tx('COMPRA 0412 LOJA', { date: '2025-02-20' }), ctx([], rejected));
  assert.equal(s.find((x) => x.source === 'travel'), undefined);
});

test('a merchant you already filed by hand outranks the trip you were on', () => {
  const history = [
    {
      id: 'h1',
      description: 'COMPRA 0412 CONTINENTE PORTO',
      merchant: '',
      amount: -30,
      date: '2024-01-01',
      category: 'food',
      status: 'overridden',
      overridden: true,
    },
  ];
  const s = suggestForTransaction(
    tx('COMPRA 0412 CONTINENTE PORTO', { date: '2025-02-20' }),
    ctx(history, TRIP)
  );
  assert.equal(s[0].category, 'food');
  assert.equal(s[0].source, 'history');
  // Travel is still offered, just not first — both are one click away.
  assert.ok(s.some((x) => x.source === 'travel'));
});

test('templates classify transactions without any rule being accepted first', () => {
  // The bug this engine exists to fix: rule-templates.json used to be reachable
  // only by accepting a rule, so a fresh ledger produced no suggestions at all.
  const s = suggestForTransaction(tx('COMPRA 3465 PINGO DOCE CIRCUNVALPOR CONTACTLESS'), ctx());
  assert.equal(s[0].category, 'food');
});

test('manual history outranks a template match', () => {
  const history = [
    tx('COMPRA 3465 CONTINENTE BOM DIA PORTO', {
      id: 'h1',
      status: 'overridden',
      category: 'shopping',
      overridden: true,
    }),
  ];
  const s = suggestForTransaction(tx('COMPRA 3987 CONTINENTE BOM DIA PORT CONTACTLESS'), ctx(history));
  assert.equal(s[0].category, 'shopping');
  assert.equal(s[0].source, 'history');
  // The template still shows up as the alternative.
  assert.ok(s.some((x) => x.category === 'food'));
});

test('short keywords do not fire on substrings', () => {
  // "irs " must not match "TURISMO", "bp " must not match "BPI".
  const s = suggestForTransaction(tx('COMPRA 3465 TURISMO DE PORTUGAL'), ctx());
  assert.ok(!s.some((x) => x.source === 'keyword' && x.category === 'income'));
});

test('suggestions never include uncategorized', () => {
  const s = suggestForTransaction(tx('ALGO COMPLETAMENTE DESCONHECIDO'), ctx());
  assert.ok(!s.some((x) => x.category === 'uncategorized'));
});

test('groupByMerchant collapses repeats and sums the total', () => {
  const pending = [
    tx('COMPRA 3465 CONTINENTE BOM DIA PORTO', { id: 'a', amount: -10, date: '2026-01-01' }),
    tx('COMPRA 3987 CONTINENTE BOM DIA PORT CONTACTLESS', { id: 'b', amount: -15, date: '2026-03-01' }),
    tx('COMPRA 3465 SPOTIFY STOCKHOLM SE', { id: 'c', amount: -7, date: '2026-02-01' }),
  ];
  const groups = groupByMerchant(pending, ctx(), 'date_desc');
  assert.equal(groups.length, 2);

  const continente = groups.find((g) => g.label.includes('CONTINENTE'));
  assert.equal(continente.count, 2);
  assert.equal(continente.total, -25);
  assert.deepEqual(continente.transactionIds.sort(), ['a', 'b']);
  assert.equal(continente.dateFrom, '2026-01-01');
  assert.equal(continente.dateTo, '2026-03-01');

  // date_desc ranks groups by their most recent transaction.
  assert.ok(groups[0].label.includes('CONTINENTE'));
});

test('sortTransactions defaults to newest first', () => {
  const list = [
    tx('a', { id: 'a', date: '2020-07-07' }),
    tx('b', { id: 'b', date: '2026-05-01' }),
  ];
  assert.equal(sortTransactions(list)[0].id, 'b');
  assert.equal(sortTransactions(list, 'date_asc')[0].id, 'a');
  assert.equal(sortTransactions(list, 'amount_desc').length, 2);
});
