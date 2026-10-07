import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/*
 * "Travel" stopped being a category. The ledger still holds every assignment
 * that ever said it, and is append-only, so the fold is what changes: those
 * assignments are history, not decisions. These are the three shapes they come
 * in, read back through a real ledger file.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-legacy-travel-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

let seq = 0;
const event = (type, payload, source = 'activobank') => ({
  id: `ev-${++seq}`,
  timestamp: '2026-01-01T00:00:00.000Z',
  type,
  source,
  hash: `hash-${seq}`,
  payload,
  linked_entities: [],
});
const tx = (id, amount) =>
  event('transaction', { transaction_id: id, date: '2025-12-22', description: `COMPRA ${id}`, amount, currency: 'EUR' });

const EVENTS = [
  // Food first, then overwritten with travel by the old trip claim.
  tx('dinner', -30),
  event('category_assignment', { event_id: 'dinner', category: 'food' }),
  event('category_assignment', { event_id: 'dinner', category: 'travel' }),
  // Only ever "travel": nobody has said what it bought.
  tx('flight', -120),
  event('category_assignment', { event_id: 'flight', category: 'travel' }),
  // Overridden *to* travel by hand, from transport.
  tx('taxi', -15),
  event('category_assignment', { event_id: 'taxi', category: 'transport' }),
  event('manual_override', { event_id: 'taxi', original_category: 'transport', new_category: 'travel' }, 'manual'),
  // Never travel at all.
  tx('rent', -700),
  event('category_assignment', { event_id: 'rent', category: 'housing' }),
];

writeFileSync(join(DATA_DIR, 'ledger', 'events.ndjson'), EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n');
// A renamed travel category is still the travel category: it is matched by id.
writeFileSync(
  join(DATA_DIR, 'state', 'categories.json'),
  JSON.stringify([{ id: 'travel', name: 'viagens', derived: true }]),
);

const { buildProjections } = await import('./rebuild.js');
const p = await buildProjections();
const row = (id) => p.transactions.find((t) => t.id === id);

test('a travel assignment on top of a real category leaves the real one', () => {
  assert.equal(row('dinner').category, 'food');
  assert.equal(row('dinner').legacyTravel, true);
});

test('a movement that was only ever "travel" goes back to the review queue', () => {
  assert.equal(row('flight').category, 'uncategorized');
  assert.equal(row('flight').status, 'pending');
  assert.equal(row('flight').legacyTravel, true);
});

test('an override to travel is ignored, and the category before it stands', () => {
  assert.equal(row('taxi').category, 'transport');
  assert.equal(row('taxi').overridden, false);
  assert.equal(row('taxi').legacyTravel, true);
});

test('a movement never filed as travel carries no trace of it', () => {
  assert.equal(row('rent').category, 'housing');
  assert.equal('legacyTravel' in row('rent'), false);
});
