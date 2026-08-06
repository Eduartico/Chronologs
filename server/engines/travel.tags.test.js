import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Tag synchronisation writes to the ledger and to state files, so unlike the
 * detection tests it cannot run against injected arguments alone. The data dir
 * is fixed before anything imports `lib/paths.js`, which resolves it once.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-travel-tags-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { createTravel, updateTravel, syncTravelTag, removeTravelTag, markTransactionAsTravel } =
  await import('./travel.js');
const { buildProjections } = await import('../projections/rebuild.js');
const { loadTags } = await import('../lib/tags.js');

let seq = 0;
const txEvent = (date, description) => ({
  id: `event-${++seq}`,
  timestamp: `${date}T00:00:00.000Z`,
  type: 'transaction',
  source: 'activobank',
  hash: `hash-${seq}`,
  payload: {
    transaction_id: `tx-${date}`,
    date,
    description,
    merchant: description,
    amount: -25,
  },
  linked_entities: [],
});

/** Resets the world and seeds it with one transaction per date. */
async function seed(dates) {
  seq = 0;
  writeFileSync(join(DATA_DIR, 'state', 'travels.json'), '[]', 'utf-8');
  writeFileSync(join(DATA_DIR, 'state', 'tags.json'), '[]', 'utf-8');
  writeFileSync(
    join(DATA_DIR, 'ledger', 'events.ndjson'),
    dates.map((d) => JSON.stringify(txEvent(d, `COMPRA 0412 LOJA ${d}`))).join('\n') + '\n',
    'utf-8'
  );
  return (await buildProjections()).transactions;
}

const tagsOf = (transactions, id) => transactions.find((t) => t.id === id)?.tags || [];
const find = (transactions, id) => transactions.find((t) => t.id === id);

test('a trip gets its subcategory but tags nothing on its own', async () => {
  const transactions = await seed(['2025-06-01', '2025-06-05', '2025-09-01']);
  const trip = createTravel({
    name: 'Leste Europeu',
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    forgivingDays: 0,
  });

  const { tagId } = syncTravelTag(trip);
  assert.ok(tagId);

  const tags = loadTags();
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'Leste Europeu');

  // Falling between the dates is a proposal, not a decision. The rent and the
  // Spotify bill land in that window too.
  const after = (await buildProjections()).transactions;
  assert.deepEqual(tagsOf(after, 'tx-2025-06-01'), []);
  assert.deepEqual(tagsOf(after, 'tx-2025-06-05'), []);
  assert.deepEqual(tagsOf(after, 'tx-2025-09-01'), []);
});

test('marking a transaction attaches the trip, unmarking detaches it', async () => {
  const transactions = await seed(['2025-06-01', '2025-06-05']);
  const trip = createTravel({
    name: 'Irlanda',
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    forgivingDays: 0,
  });

  const marked = markTransactionAsTravel(trip, find(transactions, 'tx-2025-06-01'), true);
  assert.equal(marked.changed, true);

  let after = (await buildProjections()).transactions;
  assert.deepEqual(tagsOf(after, 'tx-2025-06-01'), [marked.tagId]);
  // The other one was in the window the whole time and was never chosen.
  assert.deepEqual(tagsOf(after, 'tx-2025-06-05'), []);

  markTransactionAsTravel(trip, find(after, 'tx-2025-06-01'), false);
  after = (await buildProjections()).transactions;
  assert.deepEqual(tagsOf(after, 'tx-2025-06-01'), []);
});

test('marking the same transaction twice is not a second change', async () => {
  const transactions = await seed(['2025-06-01']);
  const trip = createTravel({ name: 'Irlanda', startDate: '2025-06-01', endDate: '2025-06-01' });

  assert.equal(markTransactionAsTravel(trip, find(transactions, 'tx-2025-06-01'), true).changed, true);
  const after = (await buildProjections()).transactions;
  assert.equal(markTransactionAsTravel(trip, find(after, 'tx-2025-06-01'), true).changed, false);
  assert.deepEqual(tagsOf(after, 'tx-2025-06-01').length, 1);
});

test('moving a trip does not undo what was already chosen', async () => {
  const transactions = await seed(['2025-06-01', '2025-06-05']);
  const trip = createTravel({
    name: 'Irlanda',
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    forgivingDays: 0,
  });
  const { tagId } = markTransactionAsTravel(trip, find(transactions, 'tx-2025-06-05'), true);

  // The dates now exclude it, but the owner said it belonged to the trip and
  // the calendar does not get to overrule that.
  const shortened = updateTravel(trip.id, { endDate: '2025-06-02' });
  syncTravelTag(shortened);

  const after = (await buildProjections()).transactions;
  assert.deepEqual(tagsOf(after, 'tx-2025-06-05'), [tagId]);
});

test('renaming a trip renames its subcategory rather than making a second one', async () => {
  await seed(['2025-06-01']);
  const trip = createTravel({ name: 'Viagem', startDate: '2025-06-01', endDate: '2025-06-01' });
  syncTravelTag(trip);

  const renamed = updateTravel(trip.id, { name: 'Leste Europeu' });
  syncTravelTag(renamed);

  const tags = loadTags();
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'Leste Europeu');
});

test('deleting a trip takes its subcategory with it', async () => {
  const transactions = await seed(['2025-06-01', '2025-06-05']);
  const trip = createTravel({
    name: 'Irlanda',
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    forgivingDays: 0,
  });
  markTransactionAsTravel(trip, find(transactions, 'tx-2025-06-01'), true);
  markTransactionAsTravel(trip, find(transactions, 'tx-2025-06-05'), true);

  const { untagged } = removeTravelTag(trip, (await buildProjections()).transactions);
  assert.equal(untagged, 2);
  assert.equal(loadTags().length, 0);

  const after = (await buildProjections()).transactions;
  assert.deepEqual(tagsOf(after, 'tx-2025-06-01'), []);
});

test('a trip cannot be filed inside another one', async () => {
  await seed(['2025-02-20']);
  createTravel({ name: 'Leste Europeu', startDate: '2025-02-12', endDate: '2025-03-04' });

  assert.throws(
    () => createTravel({ name: 'Chéquia', startDate: '2025-02-21', endDate: '2025-02-25' }),
    /Leste Europeu/
  );
});

test('rejecting a proposal inside a trip is still allowed', async () => {
  await seed(['2025-02-20']);
  createTravel({ name: 'Leste Europeu', startDate: '2025-02-12', endDate: '2025-03-04' });

  const rejected = createTravel({
    name: 'Chéquia',
    startDate: '2025-02-21',
    endDate: '2025-02-25',
    status: 'rejected',
  });
  assert.equal(rejected.status, 'rejected');
  // A rejection is a note, not a trip, so it earns no subcategory.
  assert.equal(syncTravelTag(rejected).tagId, null);
});
