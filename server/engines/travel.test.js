import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countryOf,
  detectTravels,
  travelWindow,
  transactionsInTravel,
  travelAnomalies,
  buildTravelIndex,
  travelOverlay,
  tripSpending,
} from './travel.js';

const tx = (date, description, amount = -10, extra = {}) => ({
  id: `${date}-${description}`,
  date,
  description,
  amount,
  category: 'uncategorized',
  status: 'pending',
  tags: [],
  ...extra,
});

test('countryOf reads a trailing country code on a card purchase', () => {
  assert.equal(countryOf(tx('2025-12-22', 'COMPRA 0412 BOWES DUBLIN IE')), 'IE');
  assert.equal(countryOf(tx('2026-05-19', 'COMPRA 0412 Supercell Helsinki FI')), 'FI');
});

// The terminal marker is appended after the location, often truncated.
test('countryOf looks past a trailing CONTACTLESS marker', () => {
  assert.equal(countryOf(tx('2025-12-22', 'COMPRA 0412 LEAP CARD D02 IE CONTACTLES')), 'IE');
  assert.equal(countryOf(tx('2026-04-25', 'COMPRA 0412 GIFT SHOP ES CONTACTLESS')), 'ES');
});

test('countryOf ignores Portugal', () => {
  assert.equal(countryOf(tx('2026-05-15', 'COMPRA 0412 TL SAO JOAO PORTO PT')), null);
});

// The bug this guards: "DE" is Germany and also the Portuguese preposition, so
// a transfer descriptor used to be read as a weekend abroad.
test('countryOf does not read a transfer preposition as a country', () => {
  assert.equal(countryOf(tx('2026-06-01', 'TRF DE PoupeUp - Fundo de Emergencia', 500)), null);
  assert.equal(countryOf(tx('2026-05-18', 'TRF. P/O REEMBOLSOS IRS AT - REEM', 1258)), null);
});

test('countryOf falls back to a known city name', () => {
  assert.equal(countryOf(tx('2026-04-20', 'COMPRA 0412 TAXI 1285 VALENCIA')), 'ES');
});

test('detectTravels clusters foreign purchases into a trip', () => {
  const transactions = [
    tx('2025-12-23', 'COMPRA 0412 BOWES DUBLIN IE'),
    tx('2025-12-24', 'COMPRA 0412 Eddie Rockets Dublin IE'),
    tx('2025-12-27', 'COMPRA 0412 LEAP CARD APP IE'),
  ];
  const [trip] = detectTravels(transactions, { existing: [] });
  assert.equal(trip.country, 'IE');
  assert.equal(trip.transactionCount, 3);
  // Exactly the span the card was used abroad. Padding it by a day either side
  // turned a day trip to Tui into a three-day one; the forgiving margin in
  // travelWindow already covers spending on the edges.
  assert.equal(trip.startDate, '2025-12-23');
  assert.equal(trip.endDate, '2025-12-27');
});

test('a one-day trip stays one day', () => {
  const [trip] = detectTravels(
    [
      tx('2026-04-07', 'COMPRA 0412 OPTICOA TUI TUI ES CONTACTLESS'),
      tx('2026-04-07', 'COMPRA 0412 SEMA TUI ES CONTACTLESS'),
    ],
    { existing: [] }
  );
  assert.equal(trip.startDate, '2026-04-07');
  assert.equal(trip.endDate, '2026-04-07');
});

/**
 * "MA" is Morocco and also how the statement clips "MATOSINHOS". A francesinha
 * shop and a billiards club in Matosinhos were being read as a trip to
 * Marrakech.
 */
test('a country code that is really a clipped Portuguese city is not a country', () => {
  assert.equal(countryOf(tx('2025-12-16', 'COMPRA 0412 REQUINTEFRANCESINHAS MA CONTACTLESS')), null);
  assert.equal(countryOf(tx('2026-03-31', 'COMPRA 0412 ACAI CONCEPT MATOSIN MA CONTACTLESS')), null);
  // A real Moroccan purchase names a Moroccan city, and is still recognised.
  assert.equal(countryOf(tx('2025-12-16', 'COMPRA 0412 CAFE ARGANA MARRAKECH MA')), 'MA');
});

/**
 * The bug the user hit: rejecting a proposal did nothing, because rejected
 * trips were filtered out of the very list used to suppress re-proposals.
 */
test('a rejected trip is never proposed again', () => {
  const transactions = [
    tx('2025-12-16', 'COMPRA 0412 BOWES DUBLIN IE'),
    tx('2025-12-17', 'COMPRA 0412 Eddie Rockets Dublin IE'),
  ];
  const rejected = [
    { country: 'IE', startDate: '2025-12-16', endDate: '2025-12-17', status: 'rejected' },
  ];
  assert.deepEqual(detectTravels(transactions, { existing: rejected }), []);
});

test('detectTravels ignores merchants that bill from abroad every month', () => {
  const transactions = [];
  for (const month of ['01', '02', '03', '04', '05']) {
    transactions.push(tx(`2026-${month}-10`, 'COMPRA 0412 Spotify STOCKHOLM SE'));
    transactions.push(tx(`2026-${month}-11`, 'COMPRA 0412 IKEA STOCKHOLM SE'));
  }
  assert.equal(detectTravels(transactions, { existing: [] }).length, 0);
});

test('detectTravels ignores online shops billing from a foreign address', () => {
  const transactions = [
    tx('2026-01-07', 'COMPRA 0412 eBay O 25-14045 Luxembourg LU'),
    tx('2026-01-09', 'COMPRA 0412 ALIEXPRESSCOM Luxembourg LU'),
  ];
  assert.equal(detectTravels(transactions, { existing: [] }).length, 0);
});

test('detectTravels needs more than one merchant', () => {
  const transactions = [
    tx('2026-03-05', 'COMPRA 0412 HOTEL ATLAS RABAT MA'),
    tx('2026-03-06', 'COMPRA 0412 HOTEL ATLAS RABAT MA'),
  ];
  assert.equal(detectTravels(transactions, { existing: [] }).length, 0);
});

test('detectTravels does not re-propose a trip already on file', () => {
  const transactions = [
    tx('2025-12-23', 'COMPRA 0412 BOWES DUBLIN IE'),
    tx('2025-12-24', 'COMPRA 0412 Eddie Rockets Dublin IE'),
  ];
  const existing = [
    { id: '1', country: 'IE', startDate: '2025-12-20', endDate: '2025-12-30', status: 'confirmed' },
  ];
  assert.equal(detectTravels(transactions, { existing }).length, 0);
});

test('travelWindow widens the trip by its forgiving margin', () => {
  const window = travelWindow({ startDate: '2026-04-20', endDate: '2026-04-30', forgivingDays: 2 });
  assert.deepEqual(window, { from: '2026-04-18', to: '2026-05-02' });
});

test('transactionsInTravel includes spending inside the margin', () => {
  const travel = { startDate: '2026-04-20', endDate: '2026-04-30', forgivingDays: 2 };
  const transactions = [
    tx('2026-04-18', 'COMPRA 0412 RYANAIR'),
    tx('2026-04-25', 'COMPRA 0412 GIFT SHOP VALENCIA ES'),
    tx('2026-05-05', 'COMPRA 0412 CONTINENTE'),
  ];
  const inside = transactionsInTravel(travel, transactions);
  assert.equal(inside.length, 2);
});

/*
 * Labelling is the trip's tag, and nothing else. It used to be the tag *or* the
 * `travel` category, which made sense while marking a transaction wrote both;
 * now that a trip transaction keeps its real category, reading the category
 * would report a line as labelled because of a word left over from the old
 * behaviour, on a trip that has tagged nothing at all.
 */
test('travelAnomalies separates unlabelled trip spending from stray travel labels', () => {
  const travels = [
    { id: 't1', name: 'Valencia', startDate: '2026-04-20', endDate: '2026-04-30', forgivingDays: 2, tagId: 'tag-1' },
  ];
  const transactions = [
    tx('2026-04-25', 'COMPRA 0412 GIFT SHOP VALENCIA ES', -20, { category: 'shopping', status: 'categorized' }),
    tx('2026-04-26', 'COMPRA 0412 TAXI VALENCIA ES', -8, { category: 'transport', status: 'categorized', tags: ['tag-1'] }),
    tx('2026-08-01', 'COMPRA 0412 CONTINENTE', -30, { category: 'food', status: 'categorized', tags: ['tag-1'] }),
  ];
  const { missing, stray } = travelAnomalies(transactions, travels);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].transaction.description, 'COMPRA 0412 GIFT SHOP VALENCIA ES');
  assert.equal(stray.length, 1);
  assert.equal(stray[0].transaction.date, '2026-08-01');
});

test('a transaction the trip claims keeps the category it already had', () => {
  const travels = [
    { id: 't1', name: 'Madrid', startDate: '2026-04-20', endDate: '2026-04-30', tagId: 'tag-1' },
  ];
  const transactions = [
    tx('2026-04-21', 'HOTEL MADRID ES', -400, { category: 'housing', tags: ['tag-1'] }),
    tx('2026-04-22', 'RESTAURANTE MADRID ES', -60, { category: 'food', tags: ['tag-1'] }),
    tx('2026-06-01', 'CONTINENTE', -30, { category: 'food' }),
  ];

  // Off: the ledger says what it says.
  const plain = travelOverlay(transactions, {}, []);
  assert.equal(plain[transactions[0].id], undefined);

  // On: the trip's lines read as travel, and nothing else moves.
  const overlaid = travelOverlay(transactions, {}, travels);
  assert.equal(overlaid[transactions[0].id], 'travel');
  assert.equal(overlaid[transactions[1].id], 'travel');
  assert.equal(overlaid[transactions[2].id], undefined);
});

test('a trip reports what it was spent on, never as one lump of travel', () => {
  const travels = [
    { id: 't1', name: 'Madrid', country: 'ES', startDate: '2026-04-20', endDate: '2026-04-24', tagId: 'tag-1' },
  ];
  const transactions = [
    tx('2026-04-21', 'HOTEL MADRID ES', -400, { category: 'housing', tags: ['tag-1'] }),
    tx('2026-04-22', 'RESTAURANTE MADRID ES', -60, { category: 'food', tags: ['tag-1'] }),
    tx('2026-04-22', 'METRO MADRID ES', -12, { category: 'transport', tags: ['tag-1'] }),
    tx('2026-04-23', 'REEMBOLSO', 25, { category: 'shopping', tags: ['tag-1'] }),
    tx('2026-06-01', 'CONTINENTE', -30, { category: 'food' }),
  ];
  const [trip] = tripSpending(transactions, {}, travels);
  assert.equal(trip.name, 'Madrid');
  assert.equal(trip.total, 472);
  assert.equal(trip.count, 3);
  assert.equal(trip.days, 5);
  assert.deepEqual(
    trip.categories.map((c) => c.category),
    ['housing', 'food', 'transport'],
  );
  assert.equal(trip.categories[0].value, 400);
});

test('the per-trip breakdown is not the overlay applied to itself', () => {
  const travels = [
    { id: 't1', name: 'Madrid', startDate: '2026-04-20', endDate: '2026-04-24', tagId: 'tag-1' },
  ];
  const transactions = [
    tx('2026-04-21', 'HOTEL MADRID ES', -400, { category: 'housing', tags: ['tag-1'] }),
    tx('2026-04-22', 'RESTAURANTE MADRID ES', -60, { category: 'food', tags: ['tag-1'] }),
  ];
  // Even handed the overlaid map, the card must show the real split — otherwise
  // a trip costs €460 and is 100% "travel", which is the information loss this
  // whole change exists to undo.
  const overlaid = travelOverlay(transactions, {}, travels);
  const [trip] = tripSpending(transactions, {}, travels);
  assert.equal(overlaid[transactions[0].id], 'travel');
  assert.notDeepEqual(
    trip.categories.map((c) => c.category),
    ['travel'],
  );
});

test('buildTravelIndex maps transactions to their trip', () => {
  const travels = [
    { id: 't1', name: 'Valencia', startDate: '2026-04-20', endDate: '2026-04-30', forgivingDays: 0 },
  ];
  const inside = tx('2026-04-25', 'COMPRA 0412 EMT VALENCIA ES');
  const outside = tx('2026-06-25', 'COMPRA 0412 CONTINENTE');
  const index = buildTravelIndex([inside, outside], travels);
  assert.equal(index.get(inside.id).id, 't1');
  assert.equal(index.get(outside.id), undefined);
});
