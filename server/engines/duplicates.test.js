import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateCandidates, documentFilename } from './duplicates.js';
import { normalizeTransactions } from '../ingestion/activobank/normalize.js';
import { parseNotaText } from '../ingestion/activobank/parsers/nota.js';

const tx = (id, date, description, amount, document = 'EXTRATO.pdf', kind = 'extrato') => ({
  id,
  date,
  description,
  merchant: description,
  amount,
  category: 'uncategorized',
  status: 'pending',
  raw: {
    payload: { document_kind: kind },
    linked_entities: [{ type: 'document', id: `batch/${document}` }],
  },
});

test('findDuplicateCandidates groups identical rows from one document', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2023-02-28', 'CUSTO DE SERVICO INTERNACIONAL', -0.01),
    tx('a-2', '2023-02-28', 'CUSTO DE SERVICO INTERNACIONAL', -0.01),
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].sameDocument, true);
  assert.ok(groups[0].evidence.some((e) => e.key === 'same-document'));
  assert.ok(groups[0].evidence.some((e) => e.key === 'repeat-ordinal'));
});

test('a statement row and its advice note rank as very likely duplicates', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2021-03-08', 'PAG. 916111757 - VODAFONE', -10, 'EXTRATO.pdf', 'extrato'),
    tx('b', '2021-03-09', 'PAG. 916111757 - VODAFONE', -10, 'NL.pdf', 'nota'),
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].confidence, 'high');
  assert.equal(groups[0].crossKind, true);
});

test('a document that never declared its kind is not mistaken for a second kind', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2021-03-08', 'PAG. 916111757 - VODAFONE', -10, 'EXTRATO.pdf', 'extrato'),
    tx('b', '2021-03-09', 'PAG. 916111757 - VODAFONE', -10, 'OLD.pdf', null),
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].crossKind, false);
  assert.notEqual(groups[0].confidence, 'high');
});

test('different merchants at the same price are never grouped', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2026-05-20', 'COMPRA 0412 CONTINENTE PORTO', -1.1),
    tx('b', '2026-05-20', 'COMPRA 0412 LIDL AGRADECE PORTO', -1.1),
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 0);
});

test('the same purchase weeks apart is not a duplicate', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2026-05-01', 'COMPRA 0412 SPOTIFY STOCKHOLM SE', -4.99),
    tx('b', '2026-06-01', 'COMPRA 0412 SPOTIFY STOCKHOLM SE', -4.99),
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 0);
});

test('voided transactions are left out of the analysis', () => {
  const groups = findDuplicateCandidates([
    tx('a', '2023-02-28', 'CUSTO DE SERVICO INTERNACIONAL', -0.01),
    { ...tx('a-2', '2023-02-28', 'CUSTO DE SERVICO INTERNACIONAL', -0.01), voided: true },
  ], { dismissedGroups: [] });
  assert.equal(groups.length, 0);
});

test('documentFilename survives both separators', () => {
  assert.equal(documentFilename('batch/E:\\Repos\\docs\\NL 1.pdf'), 'NL 1.pdf');
  assert.equal(documentFilename('gmail-2026/17816814-NL.pdf'), '17816814-NL.pdf');
});

// --- prevention, at the parser level ---

test('a statement row repeated at an unchanged balance is dropped', () => {
  const rows = [
    { date: '2021-12-01', description: 'COMPRA 3465 TIP TRANSPORTES', amount: -2.4, balance: 100.0 },
    { date: '2021-12-01', description: 'COMPRA 3465 TIP TRANSPORTES', amount: -2.4, balance: 100.0 },
  ];
  assert.equal(normalizeTransactions(rows).length, 1);
});

test('a genuinely repeated purchase keeps both rows', () => {
  // Two identical charges really did happen: the balance moved between them.
  const rows = [
    { date: '2023-02-28', description: 'CUSTO DE SERVICO INTERNACIONAL', amount: -0.01, balance: 100.0 },
    { date: '2023-02-28', description: 'CUSTO DE SERVICO INTERNACIONAL', amount: -0.01, balance: 99.99 },
  ];
  const normalized = normalizeTransactions(rows);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[1].occurrence, 2);
});

test('advice notes without a balance are unaffected', () => {
  const rows = [
    { date: '2021-03-08', description: 'PAG. 916111757 - VODAFONE', amount: -10 },
    { date: '2021-03-08', description: 'PAG. 916111757 - VODAFONE', amount: -10 },
  ];
  assert.equal(normalizeTransactions(rows).length, 2);
});

test('a note printed twice in one PDF is read once', () => {
  const note = `Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Montante Debitado 10,00 EUR
Descritivo do Movimento PAG. 916111757 - VODAFONE
Data do Movimento 2021/03/08`;
  const { transactions } = parseNotaText(`${note}\n${note}`);
  assert.equal(transactions.length, 1);
});

test('a PDF bundling two different notes still yields two', () => {
  const text = `Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Montante Debitado 10,00 EUR
Descritivo do Movimento PAG. 916111757 - VODAFONE
Data do Movimento 2021/03/08
Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Montante Debitado 25,00 EUR
Descritivo do Movimento PAG. 111222333 - EDP
Data do Movimento 2021/03/09`;
  assert.equal(parseNotaText(text).transactions.length, 2);
});
