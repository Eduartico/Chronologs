import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEcbXml, STALE_AFTER_DAYS } from './fx.js';
import { ecbCodes, PIVOT } from '../../../web/src/lib/currencies.js';

/*
 * A fixture, not the network. The ECB feed is a live external call and belongs
 * in manual verification; what belongs here is the parsing, the reciprocal and
 * the shape of what comes out — the three things that would silently mangle
 * every amount on every screen if they were wrong.
 */
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-08-12'>
      <Cube currency='USD' rate='1.0876'/>
      <Cube currency='JPY' rate='161.23'/>
      <Cube currency='PLN' rate='4.2755'/>
      <Cube currency='CAD' rate='1.4900'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

test('the feed parses into euros per unit', () => {
  const parsed = parseEcbXml(FIXTURE);
  assert.equal(parsed.date, '2026-08-12');
  // The ECB says one euro buys 1.0876 dollars; the app stores the reciprocal,
  // because every amount in the ledger is a foreign amount being turned into
  // euros and not the other way round. Getting this upside down is a 15% error
  // that looks entirely plausible on screen.
  assert.equal(parsed.rates.USD, Math.round((1 / 1.0876) * 1e6) / 1e6);
  assert.ok(parsed.rates.USD > 0.9 && parsed.rates.USD < 0.95, 'a dollar is worth a bit under a euro');
  assert.ok(parsed.rates.JPY < 0.01, 'a yen is worth well under a cent');
  assert.equal(Object.keys(parsed.rates).length, 4);
});

test('the pivot is never in the parsed table', () => {
  // The feed does not publish EUR against itself, and a stored 1 would be an
  // invitation to hand-edit the one number that must never move.
  assert.equal(parseEcbXml(FIXTURE).rates[PIVOT], undefined);
});

test('a broken or empty feed returns null rather than a half table', () => {
  assert.equal(parseEcbXml(''), null);
  assert.equal(parseEcbXml(null), null);
  assert.equal(parseEcbXml('<html>502 Bad Gateway</html>'), null);
  assert.equal(parseEcbXml('<Cube><Cube time="2026-08-12"></Cube></Cube>'), null);
});

test('a nonsensical rate is dropped rather than stored', () => {
  const zeroed = FIXTURE.replace("rate='1.0876'", "rate='0'");
  const parsed = parseEcbXml(zeroed);
  assert.equal(parsed.rates.USD, undefined, 'dividing by zero would give Infinity euros per dollar');
  assert.ok(parsed.rates.JPY, 'and the rest of the table still lands');
});

test('every currency the fetcher believes the ECB covers is a real one', () => {
  const codes = ecbCodes();
  assert.ok(codes.includes('USD') && codes.includes('JPY') && codes.includes('CAD'));
  for (const code of codes) assert.match(code, /^[A-Z]{3}$/);
  assert.ok(!codes.includes('RUB'), 'the rouble has not been published since March 2022');
});

test('a week is still what counts as stale', () => {
  assert.equal(STALE_AFTER_DAYS, 7);
});
