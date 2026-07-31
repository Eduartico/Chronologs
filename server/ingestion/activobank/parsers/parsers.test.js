import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from './body.js';
import { parseCsv } from './csv.js';
import { parseNotaText } from './nota.js';
import { parseExtratoRows } from './extrato.js';
import { detectDocumentKind } from './pdf.js';
import { parseAmountPT, makeTransactionId, extractMerchant } from '../normalize.js';

/**
 * Builds a positioned row in the shape pdfText.extractRows produces, so the
 * statement parser can be tested on layout without a PDF fixture.
 * Segments are [x, string] pairs; character width is fixed at 5pt.
 */
function row(segments) {
  const CHAR = 5;
  let text = '';
  const spans = [];
  const items = [];
  let cursor = null;
  for (const [x, str] of segments) {
    if (cursor != null && x > cursor) text += ' '.repeat(Math.max(1, Math.round((x - cursor) / CHAR)));
    const start = text.length;
    text += str;
    const item = { x, y: 0, str, width: str.length * CHAR, height: 8 };
    spans.push({ start, end: text.length, item });
    items.push(item);
    cursor = x + str.length * CHAR;
  }
  return { text, spans, items };
}

test('parseAmountPT handles PT number formats', () => {
  assert.equal(parseAmountPT('1.234,56'), 1234.56);
  assert.equal(parseAmountPT('45,30'), 45.3);
  assert.equal(parseAmountPT('8,99'), 8.99);
  assert.equal(parseAmountPT('1234.56'), 1234.56);
  // Statements use a space as the thousands separator.
  assert.equal(parseAmountPT('1 815.55'), 1815.55);
});

test('parseBody block format', () => {
  const body = `Conta: 123456789
Data: 2026-06-20
Descricao: COMPRA 1234 PINGO DOCE LISBOA
Debito: 45.30 EUR
---
Data: 2026-06-18
Descricao: TRANSFERENCIA Salario
Credito: 3200.00 EUR`;
  const { transactions } = parseBody(body);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amount, -45.3);
  assert.equal(transactions[0].date, '2026-06-20');
  assert.equal(transactions[1].amount, 3200);
});

test('parseBody compact format infers year from email date', () => {
  const body = `Movimentos Periodo: 01/06/2025 a 15/06/2025
01/06 COMPRA 9999 AMAZON.ES -34,99 EUR
05/06 TRANSF MBWAY CAROL +50,00 EUR`;
  const { transactions } = parseBody(body, '2025-06-15T10:00:00Z');
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, '2025-06-01');
  assert.equal(transactions[0].amount, -34.99);
  assert.equal(transactions[1].amount, 50);
});

test('parseBody treats a non-transactional email as empty, not unparsed', () => {
  // The bulk of ActivoBank mail is this: a notice that documents are available.
  const body = `Olá,
Aqui estão os Documentos em formato digital referentes à Conta n.º 45600427404.
Até já,
Equipa ActivoBank`;
  const { transactions, unparsedLines, kind } = parseBody(body);
  assert.equal(transactions.length, 0);
  assert.equal(unparsedLines.length, 0);
  assert.equal(kind, 'other');
});

test('detectDocumentKind routes by document heading', () => {
  assert.equal(detectDocumentKind('Nota de Lançamento\nNr.Doc. 118'), 'nota');
  assert.equal(detectDocumentKind('EXTRATO COMBINADO\nMOEDA BASE: EURO'), 'extrato');
  assert.equal(detectDocumentKind('Condições Gerais de Utilização de Cartões'), 'other');
});

test('parseNotaText reads a labelled advice note', () => {
  const text = `Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Nossa Referência H00300628224380020
Montante Debitado 10,00 EUR
Descritivo do Movimento PAG. 910030681 - VODAFONE
Data do Movimento 2020/05/05`;
  const { transactions } = parseNotaText(text);
  assert.equal(transactions.length, 1);
  assert.deepEqual(
    { date: transactions[0].date, amount: transactions[0].amount, description: transactions[0].description },
    { date: '2020-05-05', amount: -10, description: 'PAG. 910030681 - VODAFONE' }
  );
});

test('parseNotaText prefers the posted total and reads DD/MM/YYYY dates', () => {
  const text = `Nota de Lançamento
Operação: Transferência MB WAY
N/Referência
I531873646532
Montante 15,00 EUR
Data do Movimento 14/11/2025
Total Debitado
15,00 EUR`;
  const { transactions } = parseNotaText(text);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].date, '2025-11-14');
  assert.equal(transactions[0].amount, -15);
});

test('parseNotaText credits an incoming transfer', () => {
  const text = `Nota de Lançamento
Operação: TRANSFERÊNCIA A CRÉDITO
Montante da Transferência 10,05 EUR
Ordenante da Transferência ESCOLA SECUNDARIA ALMEIDA GARRETT
TRF. P/O  ESCOLA SECUNDARIA ALMEIDA G
Descritivo da Transferência na Conta
IBAN da Conta do Ordenante PT50003508880010305023045
Data do Movimento 2020/06/03`;
  const { transactions } = parseNotaText(text);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 10.05);
  // The value sits on the line above its label in this two-column layout.
  assert.equal(transactions[0].description, 'TRF. P/O ESCOLA SECUNDARIA ALMEIDA G');
});

test('parseNotaText handles the foreign-payment layout with dot decimals', () => {
  const text = `Nota de Lançamento
Operação: Ordem de Pagamento sobre o Estrangeiro - Emissão
Montante
20.00 EUR
Data Valor
2021/08/30
Total da operação 20.00 EUR
Total Débito (DB)/Crédito (CR)
Total a movimentar 20.00 DB`;
  const { transactions } = parseNotaText(text);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, -20);
  assert.equal(transactions[0].date, '2021-08-30');
});

test('parseNotaText splits a PDF holding several notes', () => {
  const one = `Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Montante Debitado 10,00 EUR
Descritivo do Movimento PAG. A
Data do Movimento 2021/04/22`;
  const two = `Nota de Lançamento
Operação: PAGAMENTO DE SERVICOS
Montante Debitado 25,00 EUR
Descritivo do Movimento PAG. B
Data do Movimento 2021/04/23`;
  const { transactions } = parseNotaText(`${one}\n${two}`);
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map((t) => t.amount), [-10, -25]);
});

test('parseExtratoRows signs amounts by column, not by the number', () => {
  const pages = [[
    row([[114, 'CONTA SIMPLES N. 45600427404 MOEDA:   EUR']]),
    row([[114, 'EXTRATO DE 2025/10/01 A 2025/10/31']]),
    row([[117, 'DESCRITIVO'], [355, 'DEBITO'], [427, 'CREDITO'], [529, 'SALDO']]),
    row([[57, '10.01 10.01'], [114, 'COMPRA 0412 CONTINENTE'], [361, '65.50'], [518, '1 814.70']]),
    row([[57, '10.10 10.10'], [114, 'TRF. P/O CATIA'], [444, '5.00'], [528, '843.09']]),
  ]];
  const { transactions } = parseExtratoRows(pages);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amount, -65.5, 'debit column is negative');
  assert.equal(transactions[0].date, '2025-10-01', 'dates are MM.DD, not DD.MM');
  assert.equal(transactions[1].amount, 5, 'credit column is positive');
  assert.equal(transactions[0].account, 'CONTA SIMPLES');
});

test('parseExtratoRows joins a description printed on the row above', () => {
  const pages = [[
    row([[114, 'EXTRATO DE 2025/10/01 A 2025/10/31']]),
    row([[117, 'DESCRITIVO'], [355, 'DEBITO'], [427, 'CREDITO'], [529, 'SALDO']]),
    row([[114, 'TRF P/ PoupeUp']]),
    row([[57, '10.01 10.01'], [361, '60.00'], [518, '1 754.70']]),
  ]];
  const { transactions } = parseExtratoRows(pages);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].description, 'TRF P/ PoupeUp');
  assert.equal(transactions[0].amount, -60);
});

test('parseExtratoRows does not read a reference number into the amount', () => {
  // "...PRAZO 3091214528 100.00" must be 100.00, not 528 100.00.
  const pages = [[
    row([[114, 'EXTRATO DE 2020/07/01 A 2020/07/31']]),
    row([[117, 'DESCRITIVO'], [355, 'DEBITO'], [427, 'CREDITO'], [529, 'SALDO']]),
    row([[57, '7.13 7.13'], [114, 'LIQ PARCIAL DEP PRAZO 3091214528'], [434, '100.00'], [518, '290.61']]),
  ]];
  const { transactions } = parseExtratoRows(pages);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 100);
});

test('parseExtratoRows skips carry-forward and summary rows', () => {
  const pages = [[
    row([[114, 'EXTRATO DE 2025/10/01 A 2025/10/31']]),
    row([[117, 'DESCRITIVO'], [355, 'DEBITO'], [427, 'CREDITO'], [529, 'SALDO']]),
    row([[114, 'SALDO INICIAL'], [519, '1 815.55']]),
    row([[117, 'A TRANSPORTAR'], [528, '942.41']]),
    row([[115, 'TRANSPORTE'], [528, '942.41']]),
    row([[114, 'SALDO FINAL'], [528, '600.36']]),
  ]];
  const { transactions, unparsedLines } = parseExtratoRows(pages);
  assert.equal(transactions.length, 0);
  assert.equal(unparsedLines.length, 0);
});

test('parseCsv with Data/Descricao/Montante header', () => {
  const csv = `Data;Descrição;Montante
02-01-2026;COMPRA CONTINENTE;-45,30
05-01-2026;ORDENADO;1.500,00`;
  const { transactions } = parseCsv(csv);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, '2026-01-02');
  assert.equal(transactions[0].amount, -45.3);
  assert.equal(transactions[1].amount, 1500);
});

test('parseCsv with separate Debito/Credito columns', () => {
  const csv = `Data,Descricao,Debito,Credito
02-01-2026,COMPRA LIDL,12.50,
03-01-2026,MBWAY RECEBIDO,,25.00`;
  const { transactions } = parseCsv(csv);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amount, -12.5);
  assert.equal(transactions[1].amount, 25);
});

test('parseCsv rejects unknown headers gracefully', () => {
  const { transactions, unparsedLines } = parseCsv('foo,bar\n1,2');
  assert.equal(transactions.length, 0);
  assert.equal(unparsedLines.length, 1);
});

test('makeTransactionId is deterministic', () => {
  const a = makeTransactionId('2026-01-02', -45.3, 'COMPRA CONTINENTE');
  const b = makeTransactionId('2026-01-02', -45.3, 'COMPRA CONTINENTE');
  assert.equal(a, b);
});

test('extractMerchant strips ActivoBank prefixes', () => {
  assert.equal(extractMerchant('COMPRA 1234 PINGO DOCE LISBOA'), 'PINGO DOCE LISBOA');
  assert.equal(extractMerchant('PAG SERV SPOTIFY'), 'SPOTIFY');
});
