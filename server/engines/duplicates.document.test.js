/**
 * Re-reading the original document, across more than one institution.
 *
 * `verifyAgainstDocument` is the strongest signal the duplicates screen has: not
 * a heuristic, but a count of how many times the movement really appears in the
 * paperwork. It used to reach straight into the ActivoBank parsers and search
 * one hardcoded directory, and it had no test at all — the real ledger has no
 * duplicate groups left, so nothing exercised it.
 *
 * It now asks the module that ingested the document. These cases hold that
 * open with two invented institutions, including the case the change exists
 * for: both of them storing a file called `EXTRATO.pdf`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-docverify-'));
const MODULES_DIR = mkdtempSync(join(tmpdir(), 'chronologs-modules-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;
process.env.CHRONOLOGS_MODULES_DIR = MODULES_DIR;

/**
 * Two invented banks, each reading its own one-line-per-movement format.
 *
 * `bank-one` writes `date;amount;text`, `bank-two` writes `date,amount,text` —
 * different enough that using the wrong parser produces nothing, which is what
 * makes the "same filename at two banks" case below meaningful.
 */
function writeModule(id, separator) {
  mkdirSync(join(MODULES_DIR, id), { recursive: true });
  writeFileSync(
    join(MODULES_DIR, id, 'module.js'),
    `export default {
      id: '${id}',
      kind: 'source',
      family: 'bank',
      label: 'module.${id}.label',
      icon: 'accounts',
      capabilities: {
        sync: async () => ({}),
        parseDocument: async (ctx, { filename, buffer }) => {
          const transactions = [];
          for (const line of buffer.toString('utf-8').split('\\n')) {
            if (!line.trim()) continue;
            const [date, amount, description] = line.split('${separator}');
            if (!date || !amount) continue;
            transactions.push({
              transaction_id: '${id}-' + date + '-' + amount + '-' + (description ?? '').slice(0, 4),
              date,
              amount: Number(amount),
              description: description ?? '',
            });
          }
          return { transactions, orders: [], unparsedLines: [], kind: 'statement' };
        },
      },
    };`,
    'utf-8'
  );
}

writeModule('bank-one', ';');
writeModule('bank-two', ',');

const { resolveDocumentPath, verifyAgainstDocument } = await import('./duplicates.js');
const { documentsPath } = await import('../lib/paths.js');

/** Puts a document where an ingestion batch would have left it. */
function storeDocument(instance, batch, filename, body) {
  const dir = documentsPath(instance, 'processed', batch);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body, 'utf-8');
  return `${batch}/${filename}`;
}

test('a document is found in the directory of the instance that stored it', () => {
  const documentId = storeDocument('bank-one', 'batch-1', 'MARCH.txt', '2025-03-01;-10.00;COFFEE\n');
  const path = resolveDocumentPath(documentId, 'bank-one');
  assert.ok(path, 'document not found');
  assert.match(path.replace(/\\/g, '/'), /bank-one\/processed\/batch-1\/MARCH\.txt$/);
});

test('the same filename at two banks resolves to the right one', () => {
  storeDocument('bank-one', 'b1', 'EXTRATO.pdf', 'one');
  storeDocument('bank-two', 'b2', 'EXTRATO.pdf', 'two');

  const one = resolveDocumentPath('b1/EXTRATO.pdf', 'bank-one').replace(/\\/g, '/');
  const two = resolveDocumentPath('b2/EXTRATO.pdf', 'bank-two').replace(/\\/g, '/');
  assert.match(one, /bank-one\//);
  assert.match(two, /bank-two\//);
});

test('without a source, every instance is searched', () => {
  storeDocument('bank-two', 'b3', 'ONLY-AT-TWO.txt', '2025-03-01,-1.00,X\n');
  const path = resolveDocumentPath('b3/ONLY-AT-TWO.txt');
  assert.ok(path, 'a document whose group predates the source field must still be findable');
  assert.match(path.replace(/\\/g, '/'), /bank-two\//);
});

test('a movement the document justifies once, recorded twice, reports a surplus', async () => {
  const documentId = storeDocument(
    'bank-one',
    'batch-surplus',
    'APR.txt',
    '2025-04-01;-42.00;SUPERMARKET\n2025-04-02;-8.00;BAKERY\n'
  );

  const result = await verifyAgainstDocument({
    documentId,
    source: 'bank-one',
    amount: -42,
    date: '2025-04-01',
    count: 2,
  });

  assert.equal(result.verified, true);
  assert.equal(result.expected, 1);
  assert.equal(result.found, 2);
  assert.equal(result.surplus, 1);
});

test('a movement the document really does contain twice reports no surplus', async () => {
  const documentId = storeDocument(
    'bank-one',
    'batch-genuine',
    'MAY.txt',
    '2025-05-01;-0.14;GOOGLE\n2025-05-01;-0.14;GOOGLE\n'
  );

  const result = await verifyAgainstDocument({
    documentId,
    source: 'bank-one',
    amount: -0.14,
    date: '2025-05-01',
    count: 2,
  });

  assert.equal(result.expected, 2);
  assert.equal(result.surplus, 0);
});

test('each bank is read by its own parser', async () => {
  // bank-two's format is comma-separated; read with bank-one's semicolon parser
  // it yields nothing, so an `expected` of 1 here is the registry having routed
  // the document to the right module rather than to the first one installed.
  const documentId = storeDocument('bank-two', 'batch-two', 'JUN.csv', '2025-06-01,-15.00,FUEL\n');

  const result = await verifyAgainstDocument({
    documentId,
    source: 'bank-two',
    amount: -15,
    date: '2025-06-01',
    count: 1,
  });

  assert.equal(result.verified, true);
  assert.equal(result.expected, 1);
});

test('a group with no document is reported as such, not guessed at', async () => {
  const result = await verifyAgainstDocument({ documentId: null, amount: -1, date: '2025-01-01', count: 2 });
  assert.deepEqual(result, { verified: false, reason: 'no-document' });
});

test('a document that is no longer on disk is reported as missing', async () => {
  const result = await verifyAgainstDocument({
    documentId: 'gone/NOWHERE.pdf',
    source: 'bank-one',
    amount: -1,
    date: '2025-01-01',
    count: 2,
  });
  assert.deepEqual(result, { verified: false, reason: 'document-not-found' });
});
