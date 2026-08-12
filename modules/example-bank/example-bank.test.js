/**
 * The template module, proved to work end to end.
 *
 * A template nobody runs is a template that rots. These cases exercise the
 * whole path a new module takes — parse, stable ids, ingest through the shared
 * kit, land in the ledger, project into transactions — so that "copy this
 * folder" stays true rather than becoming true once and drifting.
 *
 * They are also the shortest honest answer to "how do I know my module works".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-example-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { parseStatement, makeTransactionId, ingestFiles, reprocessStored } = await import('./ingest.js');
const { createContext } = await import('../../server/framework/context.js');
const { buildProjections } = await import('../../server/projections/rebuild.js');

const STATEMENT = [
  'Data;Descritivo;Montante;Saldo',
  '2025-03-04;COMPRA CONTINENTE PORTO;-45,20;1.954,80',
  '2025-03-05;TRANSF RECEBIDA SALARIO;1.800,00;3.754,80',
  'nonsense line that is not a movement',
  '2025-03-06;LEVANTAMENTO MULTIBANCO;-60,00;3.694,80',
].join('\n');

const ctx = createContext({ id: 'my-bank', module: 'example-bank', config: {} });
const file = (name, body) => ({ filename: name, buffer: Buffer.from(body, 'utf-8') });

test('the parser reads the statement and keeps what it could not', () => {
  const { transactions, unparsedLines, kind } = parseStatement(STATEMENT);

  assert.equal(transactions.length, 3);
  assert.equal(kind, 'statement');
  // Dropped silently is how a parser loses a month of spending unnoticed.
  assert.deepEqual(unparsedLines, ['nonsense line that is not a movement']);
});

test('Portuguese decimals are read as one number, not scaled by a thousand', () => {
  const [, salary] = parseStatement(STATEMENT).transactions;
  assert.equal(salary.amount, 1800);
  assert.equal(salary.balance, 3754.8);
});

test('a movement id depends only on what the document says', () => {
  const tx = { date: '2025-03-04', amount: -45.2, description: 'COMPRA CONTINENTE PORTO' };
  assert.equal(makeTransactionId('my-bank', tx), makeTransactionId('my-bank', { ...tx }));
  // Two accounts at the same bank must not collide, so the instance is in it.
  assert.notEqual(makeTransactionId('my-bank', tx), makeTransactionId('other-bank', tx));
});

test('an upload lands in the ledger and projects as transactions', async () => {
  const result = await ingestFiles(ctx, [file('marco.csv', STATEMENT)]);
  assert.equal(result.new, 3);
  assert.equal(result.errors.length, 0);

  const { transactions } = await buildProjections();
  const mine = transactions.filter((t) => t.source === 'my-bank');
  assert.equal(mine.length, 3);
  // Everything downstream reads these fields; a module that fills them wrongly
  // is a module whose data never appears in a chart.
  assert.ok(mine.every((t) => t.date && Number.isFinite(t.amount) && t.currency === 'EUR'));
});

test('the same statement uploaded again adds nothing', async () => {
  const again = await ingestFiles(ctx, [file('marco-copia.csv', STATEMENT)]);
  assert.equal(again.new, 0);
  const { transactions } = await buildProjections();
  assert.equal(transactions.filter((t) => t.source === 'my-bank').length, 3);
});

test('reprocessing reads the stored originals and stays idempotent', async () => {
  const result = await reprocessStored(ctx);
  assert.ok(result.filesFound >= 1, 'the stored document was not found again');
  assert.equal(result.new, 0);
});

test('two instances of the same module keep separate ledgers and folders', async () => {
  const second = createContext({ id: 'her-bank', module: 'example-bank', config: {} });
  const result = await ingestFiles(second, [file('marco.csv', STATEMENT)]);

  // Same statement, different account: three more real movements, not three
  // duplicates. This is the whole point of instances.
  assert.equal(result.new, 3);

  const { transactions } = await buildProjections();
  assert.equal(transactions.filter((t) => t.source === 'my-bank').length, 3);
  assert.equal(transactions.filter((t) => t.source === 'her-bank').length, 3);
});
