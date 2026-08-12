import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nameScore,
  parseStatementOrder,
  isBrokerageFee,
  matchOrders,
  computeSecurityPositions,
  computeSecuritySummary,
} from './securities.js';
import { parseComprovativoText } from '../../modules/activobank/parsers/comprovativo.js';

// Taken from a real ComprovativoOperacao PDF: pdf-parse renders the two-column
// form with labels glued to their values.
const RECEIPT = `
Ordem Compra/Venda Bolsa
Comprovativo de Operação
O pedido de operação com as características abaixo indicadas encontra-se registado no nosso sistema.
OPERAÇÃO
TipoOrdem Compra/Venda Bolsa
CanalApp
EstadoExecutado
Data/Hora do carregamento18-05-2026 10:11:38
DADOS ESPECÍFICOS
Tipo de OrdemOrdem de Compra
MercadoAMS
TítuloiShares Core MSCI World ETF USD Acc
Quantidade1,00
Tipo de PreçoAo mercado
Preço0,00
Moeda da OperaçãoEUR
Validade18-05-2026
Valor da Última Cotação120,33
`;

test('parseComprovativoText reads a market buy order', () => {
  const { orders } = parseComprovativoText(RECEIPT);
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0], {
    date: '2026-05-18',
    side: 'buy',
    security: 'iShares Core MSCI World ETF USD Acc',
    market: 'AMS',
    quantity: 1,
    // A market order quotes 0,00 as the price, so it must not be taken as cost.
    price: null,
    quote: 120.33,
    currency: 'EUR',
    executed: true,
  });
});

test('parseComprovativoText ignores documents that are not trade receipts', () => {
  assert.deepEqual(parseComprovativoText('EXTRATO COMBINADO 2026').orders, []);
});

test('nameScore recognises the statement abbreviation', () => {
  assert.equal(nameScore('ISH CORE MSCI W', 'iShares Core MSCI World ETF USD Acc'), 1);
  assert.ok(nameScore('VANG FT ALL WLD', 'Vanguard FTSE All-World ETF USD Acc') >= 0.6);
  assert.ok(nameScore('ISHARES MSCI EM', 'iShares MSCI EM ETF USD Acc') >= 0.9);
  assert.ok(nameScore('ISH CORE MSCI W', 'Vanguard FTSE All-World ETF USD Acc') < 0.6);
});

test('parseStatementOrder reads the exchange purchase line', () => {
  assert.deepEqual(parseStatementOrder('COMPRA BOLSA..OP.390545877 DE ISH CORE MSCI W'), {
    side: 'buy',
    orderRef: '390545877',
    security: 'ISH CORE MSCI W',
  });
  assert.equal(parseStatementOrder('COMPRA 0412 CONTINENTE PORTO'), null);
});

test('isBrokerageFee recognises the exchange service commission', () => {
  assert.ok(isBrokerageFee('Comissão de Serviço de Bolsa'));
  assert.ok(!isBrokerageFee('COMPRA 0412 CONTINENTE'));
});

const orders = [
  {
    security_order_id: 'o1',
    date: '2026-05-18',
    side: 'buy',
    security: 'iShares Core MSCI World ETF USD Acc',
    quantity: 1,
    quote: 120.33,
    currency: 'EUR',
  },
  {
    security_order_id: 'o2',
    date: '2026-05-18',
    side: 'buy',
    security: 'Vanguard FTSE All-World ETF USD Acc',
    quantity: 1,
    quote: 158.5,
    currency: 'EUR',
  },
];

const statement = [
  { id: 't1', date: '2026-05-20', description: 'COMPRA BOLSA..OP.390545877 DE ISH CORE MSCI W', amount: -120.3 },
  { id: 't2', date: '2026-05-20', description: 'COMPRA BOLSA..OP.390545894 DE VANG FT ALL WLD', amount: -163.7 },
  { id: 't3', date: '2026-06-01', description: 'Comissão de Serviço de Bolsa', amount: -3.69 },
  { id: 't4', date: '2026-05-20', description: 'COMPRA 0412 CONTINENTE PORTO', amount: -12.4 },
];

test('matchOrders pairs each receipt with its statement debit', () => {
  const { matches, unmatchedOrders } = matchOrders(orders, statement);
  assert.equal(matches.length, 2);
  assert.equal(unmatchedOrders.length, 0);
  assert.equal(matches.find((m) => m.order.security_order_id === 'o1').transaction.id, 't1');
  // Executed away from the quote: 158.50 quoted, 163.70 actually paid.
  assert.equal(matches.find((m) => m.order.security_order_id === 'o2').cost, 163.7);
});

test('matchOrders will not pair an order with a debit before it', () => {
  const early = [{ ...statement[0], date: '2026-05-10' }];
  const { matches, unmatchedOrders } = matchOrders([orders[0]], early);
  assert.equal(matches.length, 0);
  assert.equal(unmatchedOrders.length, 1);
});

test('matchOrders rejects an amount far from the expected cost', () => {
  const wrong = [{ ...statement[0], amount: -900 }];
  assert.equal(matchOrders([orders[0]], wrong).matches.length, 0);
});

test('computeSecurityPositions takes cost from the bank debit, not the quote', () => {
  const positions = computeSecurityPositions(orders, statement, {});
  const vanguard = positions.find((p) => p.name.startsWith('Vanguard'));
  assert.equal(vanguard.quantity, 1);
  assert.equal(vanguard.invested, 163.7);
  assert.equal(vanguard.estimatedCost, false);
  assert.equal(vanguard.marketValue, null);
});

test('computeSecurityPositions falls back to the quote and flags it', () => {
  const positions = computeSecurityPositions([orders[0]], [], {});
  assert.equal(positions[0].invested, 120.33);
  assert.equal(positions[0].estimatedCost, true);
});

test('computeSecurityPositions values a position when a price is known', () => {
  const priceMap = { 'iShares Core MSCI World ETF USD Acc': { price: 130, timestamp: '2026-08-01' } };
  const positions = computeSecurityPositions([orders[0]], statement, priceMap);
  assert.equal(positions[0].marketValue, 130);
  assert.equal(positions[0].pnl, 9.7);
});

test('computeSecuritySummary counts brokerage fees and unpriced rows', () => {
  const positions = computeSecurityPositions(orders, statement, {});
  const summary = computeSecuritySummary(positions, statement);
  assert.equal(summary.positions, 2);
  assert.equal(summary.fees, 3.69);
  assert.equal(summary.unpriced, 2);
  assert.equal(summary.marketValue, null);
});
