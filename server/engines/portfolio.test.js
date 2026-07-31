import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parsePricempireCsv, repairMojibake } from '../ingestion/pricempire/csv.js';
import {
  computePositions,
  computeSummary,
  computeByMarketplace,
  computeCashTimeline,
} from './portfolio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'ingestion', 'pricempire', '__fixtures__', 'pricempire-export.csv');

const parsed = parsePricempireCsv(readFileSync(FIXTURE));
const positions = computePositions(parsed.transactions, parsed.prices);
const find = (needle) => positions.find((p) => p.name.includes(needle));

test('every row of the export parses', () => {
  assert.equal(parsed.unparsedLines.length, 0);
  assert.equal(parsed.transactions.length, 19);
});

test('prices are read as USD cents', () => {
  // 20660 in the file is $206.60, not $20,660.
  const huntsman = parsed.transactions.find((t) => t.name.includes('Huntsman') && t.type === 'buy');
  assert.equal(huntsman.unitPrice, 206.6);
  assert.equal(huntsman.totalPrice, 206.6);
});

test('current market price is captured once per item', () => {
  const price = parsed.prices.find((p) => p.name.includes('Huntsman'));
  assert.equal(price.price, 140.26);
  const names = parsed.prices.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('repairMojibake restores star and trademark glyphs', () => {
  const mangled = Buffer.from('★ StatTrak™ Huntsman', 'utf-8').toString('latin1');
  assert.equal(repairMojibake(mangled), '★ StatTrak™ Huntsman');
});

test('repairMojibake leaves clean text untouched', () => {
  assert.equal(repairMojibake('AK-47 | Bloodsport (Factory New)'), 'AK-47 | Bloodsport (Factory New)');
  assert.equal(repairMojibake('★ StatTrak™ Huntsman'), '★ StatTrak™ Huntsman');
});

test('realized P&L is net of the Steam 15% fee', () => {
  // Bought at $206.60, sold at $102.88 less 15% => $87.45 net => -$119.15.
  assert.equal(find('Huntsman').realizedPnl, -119.15);
});

test('realized P&L is net of the CSFloat 2% fee', () => {
  // Bought at $361.00, sold at $237.00 less 2% => $232.26 net => -$128.74.
  assert.equal(find('Scarlet Shamagh').realizedPnl, -128.74);
});

test('cost basis is a weighted average across purchases', () => {
  // 33 cases bought for $40.26 total (two batches were free) => $1.22 each.
  const dn = find('Dreams & Nightmares');
  assert.equal(dn.boughtQty, 33);
  assert.equal(dn.heldQty, 23);
  assert.equal(dn.avgCost, 1.22);
});

test('selling more than was bought is flagged, not fatal', () => {
  // The export starts mid-history, so some items were sold from stock that was
  // never recorded as a purchase.
  const recoil = find('Recoil Case');
  assert.equal(recoil.quantityMismatch, true);
  assert.ok(recoil.heldQty < 0);
  // Only the quantity actually covered by purchases carries a cost.
  assert.equal(recoil.realizedPnl, 258.39);
  assert.equal(recoil.marketValue, 0, 'a negative holding must not create market value');
});

test('items with no purchase cost still report unrealized gains', () => {
  const stickers = find('Eternal Fire');
  assert.equal(stickers.avgCost, 0);
  assert.equal(stickers.heldQty, 6);
  assert.equal(stickers.unrealizedPnl, 11.76);
});

test('float and paint seed survive onto the position', () => {
  const gloves = find('Amphibious');
  assert.equal(gloves.floatValue, 0.27482593);
  assert.equal(gloves.paintSeed, 514);
});

test('summary totals reconcile with the positions', () => {
  const summary = computeSummary(positions);
  const held = positions.filter((p) => p.heldQty > 0);
  assert.equal(summary.itemsHeld, held.length);
  assert.equal(
    summary.realizedPnl,
    Math.round(positions.reduce((s, p) => s + p.realizedPnl, 0) * 100) / 100
  );
  assert.equal(summary.totalPnl, Math.round((summary.realizedPnl + summary.unrealizedPnl) * 100) / 100);
  assert.equal(summary.mismatches, 2);
});

test('marketplace breakdown separates spend from proceeds', () => {
  const rows = computeByMarketplace(parsed.transactions);
  const csfloat = rows.find((r) => r.marketplace === 'csfloat');
  assert.equal(csfloat.buys, 1);
  assert.equal(csfloat.sells, 1);
  assert.equal(csfloat.spent, 361);
  assert.equal(csfloat.received, 232.26);
});

test('cash timeline accumulates month by month', () => {
  const timeline = computeCashTimeline(parsed.transactions);
  assert.ok(timeline.length > 1);
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(
      timeline[i].cumulativeSpent >= timeline[i - 1].cumulativeSpent,
      'cumulative spend must never decrease'
    );
    assert.ok(timeline[i].month > timeline[i - 1].month, 'months must be ordered');
  }
});

test('duplicate rows produce distinct transactions', () => {
  // Two identical "buy 3x Eternal Fire" rows on 2025-07-25 are two real events.
  const stickers = parsed.transactions.filter((t) => t.name.includes('Eternal Fire'));
  assert.equal(stickers.length, 2);
  assert.notEqual(stickers[0].id, stickers[1].id);
});

test('an unrecognized header is reported rather than throwing', () => {
  const result = parsePricempireCsv('foo,bar\n1,2');
  assert.equal(result.transactions.length, 0);
  assert.match(result.unparsedLines[0], /Cabeçalho não reconhecido/);
});
