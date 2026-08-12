/**
 * A small, invented ledger that exercises every reading the projection makes.
 *
 * Eduardo's real ledger — 10.000 events, 2912 movements — is the strongest
 * possible regression test, and it is also gitignored and personal, so it can
 * never run on a fork or in CI. This is its stand-in: forty-odd handwritten
 * events chosen so that each one is the *only* thing proving a particular rule
 * still holds. Delete any of them and a specific behaviour becomes untested.
 *
 * The names and numbers are invented. The shapes are not: descriptors follow
 * DEFAULT_PROFILE in engines/accounts.js exactly, because a fixture that used
 * wording no bank produces would pass while the real thing broke.
 *
 * Written as a module rather than as a .ndjson file so each event can say what
 * it is for. The test writes it out as a real ledger before reading it back, so
 * `replayEvents` and its line parsing are still on the path.
 */

const CURRENT = { account: 'CONTA SIMPLES', account_id: '11100011100' };
const SAVINGS = { account: 'CONTA POUPEUP', account_id: '22200022200' };
const HOLDER = 'MARIA EXEMPLO SANTOS';

let seq = 0;

/**
 * `hash` exists in the real ledger for append-time deduplication and is never
 * read by the projection, so a counter is honest here — inventing sha256 digests
 * would suggest they mean something.
 */
function event(type, source, payload, linked = []) {
  seq++;
  return {
    id: `ev-${String(seq).padStart(3, '0')}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    type,
    source,
    hash: `hash-${seq}`,
    payload,
    linked_entities: linked,
  };
}

const tx = (id, payload, documentId = null) =>
  event(
    'transaction',
    payload.source ?? 'activobank',
    { transaction_id: id, currency: 'EUR', ...payload },
    documentId ? [{ type: 'document', id: documentId }] : []
  );

export const SYNTHETIC_EVENTS = [
  // ---- ordinary spending on the current account -------------------------
  tx('tx-groceries', {
    date: '2025-03-03',
    description: 'COMPRA 0412 CONTINENTE PORTO PT',
    merchant: 'CONTINENTE',
    amount: -45.2,
    balance: 1954.8,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mar/EXTRATO.pdf'),

  // Income. "TRF DE EMPRESA…" matches the transfer-in pattern but names neither
  // the savings product nor the account holder, so it must NOT be read as an
  // internal movement — the case that decides whether salary counts as income.
  tx('tx-salary', {
    date: '2025-03-05',
    description: 'TRF DE EMPRESA EXEMPLO LDA',
    merchant: 'EMPRESA EXEMPLO',
    amount: 1800,
    balance: 3754.8,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mar/EXTRATO.pdf'),

  // ---- a vault deposit, booked once on each account ----------------------
  // Both legs are real records of the same €300. Counting either as spending is
  // the bug engines/accounts.js exists to prevent.
  tx('tx-vault-deposit-current', {
    date: '2025-03-10',
    description: 'TRF P/ PoupeUp - Mealheiro',
    merchant: 'POUPEUP',
    amount: -300,
    balance: 3454.8,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mar/EXTRATO.pdf'),
  tx('tx-vault-deposit-savings', {
    date: '2025-03-10',
    description: `TRF DE ${HOLDER}`,
    merchant: 'TRANSFERENCIA',
    amount: 300,
    balance: 300,
    account_holder: HOLDER,
    ...SAVINGS,
  }, 'batch-mar/EXTRATO-POUPEUP.pdf'),

  // ---- and a withdrawal back out of it, three weeks later ----------------
  tx('tx-vault-withdrawal-current', {
    date: '2025-04-02',
    description: 'TRF DE PoupeUp - Mealheiro',
    merchant: 'POUPEUP',
    amount: 150,
    balance: 3210.4,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO.pdf'),
  tx('tx-vault-withdrawal-savings', {
    date: '2025-04-02',
    description: `TRF P/ ${HOLDER}`,
    merchant: 'TRANSFERENCIA',
    amount: -150,
    balance: 150,
    account_holder: HOLDER,
    ...SAVINGS,
  }, 'batch-abr/EXTRATO-POUPEUP.pdf'),

  // A second vault, named only in the descriptor — vaults are discovered, never
  // configured, and this is the event that proves it.
  tx('tx-vault-second', {
    date: '2025-04-05',
    description: 'TRF P/ PoupeUp - Fundo de Emergencia',
    merchant: 'POUPEUP',
    amount: -75,
    balance: 3135.4,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO.pdf'),

  // The statement clips long descriptors, so the same vault also appears cut
  // short. consolidateVaultNames folds this into the name above; if it stops
  // doing so, the fixture grows a third vault and the golden file says where.
  tx('tx-vault-second-truncated', {
    date: '2025-05-06',
    description: 'TRF P/ PoupeUp - Fundo de Emergen',
    merchant: 'POUPEUP',
    amount: -25,
    balance: 3110.4,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mai/EXTRATO.pdf'),

  // The savings-side mirrors of the two legs above. Present so the vault split
  // can be checked against the bank's own running balance — reconciliation is
  // only meaningful when the savings statements cover the same period.
  tx('tx-vault-second-savings', {
    date: '2025-04-05',
    description: `TRF DE ${HOLDER}`,
    merchant: 'TRANSFERENCIA',
    amount: 75,
    balance: 225,
    account_holder: HOLDER,
    ...SAVINGS,
  }, 'batch-abr/EXTRATO-POUPEUP.pdf'),
  tx('tx-vault-second-truncated-savings', {
    date: '2025-05-06',
    description: `TRF DE ${HOLDER}`,
    merchant: 'TRANSFERENCIA',
    amount: 25,
    balance: 250,
    account_holder: HOLDER,
    ...SAVINGS,
  }, 'batch-mai/EXTRATO-POUPEUP.pdf'),

  // What the savings account did on its own. Not a transfer leg, so it belongs
  // to no vault; reconciliation has to account for it separately or the split
  // looks short by exactly the interest earned.
  tx('tx-savings-interest', {
    date: '2025-06-30',
    description: 'JUROS CREDITADOS',
    merchant: 'JUROS',
    amount: 1.25,
    balance: 251.25,
    account_holder: HOLDER,
    ...SAVINGS,
  }, 'batch-jun/EXTRATO-POUPEUP.pdf'),

  // ---- cash at an ATM: recognised, not categorised by hand ---------------
  tx('tx-atm', {
    date: '2025-03-12',
    description: 'LEV ATM 4821 PORTO',
    merchant: 'ATM',
    amount: -60,
    balance: 3394.8,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mar/EXTRATO.pdf'),

  // ---- one movement, two documents ---------------------------------------
  // The advice note reports it on the day; the statement reports it again with
  // the account fields the note never carries. One row, both event ids, the
  // later document filling in only what the first left empty.
  tx('tx-restaurant', {
    date: '2025-03-18',
    description: 'COMPRA 0412 RESTAURANTE EXEMPLO PORTO PT',
    merchant: 'RESTAURANTE EXEMPLO',
    amount: -32.5,
  }, 'batch-mar/NOTA.pdf'),
  tx('tx-restaurant', {
    date: '2025-03-18',
    description: 'COMPRA 0412 RESTAURANTE EXEMPLO PORTO PT',
    merchant: 'RESTAURANTE EXEMPLO',
    amount: -32.5,
    balance: 3362.3,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-mar/EXTRATO.pdf'),

  // ---- a movement the parsers could not attribute at ingestion -----------
  tx('tx-unattributed', {
    date: '2025-03-20',
    description: 'COMPRA 0412 FARMACIA EXEMPLO PORTO PT',
    merchant: 'FARMACIA EXEMPLO',
    amount: -12.4,
  }, 'batch-mar/NOTA.pdf'),
  // …learned later by re-reading the stored document. The original reading stays
  // exactly as recorded; what was learned sits beside it.
  event('transaction_enrichment', 'enrich', {
    transaction_id: 'tx-unattributed',
    account: CURRENT.account,
    account_id: CURRENT.account_id,
    account_holder: HOLDER,
    balance: 3349.9,
  }),

  // ---- a genuine duplicate, retired rather than deleted -------------------
  tx('tx-duplicate-original', {
    date: '2025-04-10',
    description: 'COMPRA 0412 LOJA EXEMPLO PORTO PT',
    merchant: 'LOJA EXEMPLO',
    amount: -19.99,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO.pdf'),
  tx('tx-duplicate-copy', {
    date: '2025-04-10',
    description: 'COMPRA 0412 LOJA EXEMPLO PORTO PT',
    merchant: 'LOJA EXEMPLO',
    amount: -19.99,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO-REENVIO.pdf'),
  event('transaction_void', 'manual', {
    event_id: 'tx-duplicate-copy',
    reason: 'duplicate',
    duplicate_of: 'tx-duplicate-original',
    at: '2026-01-02T00:00:00.000Z',
  }),

  // Voiding is reversible — a mistaken merge has to be undoable, so the last
  // void/unvoid in ledger order wins.
  tx('tx-wrongly-voided', {
    date: '2025-04-11',
    description: 'COMPRA 0412 PADARIA EXEMPLO PORTO PT',
    merchant: 'PADARIA EXEMPLO',
    amount: -3.6,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO.pdf'),
  event('transaction_void', 'manual', { event_id: 'tx-wrongly-voided', reason: 'duplicate' }),
  event('transaction_unvoid', 'manual', { event_id: 'tx-wrongly-voided' }),

  // ---- categorisation ----------------------------------------------------
  event('category_assignment', 'rule', {
    event_id: 'tx-groceries',
    category: 'groceries',
    rule_id: 'rule-groceries',
  }),
  event('category_assignment', 'rule', { event_id: 'tx-restaurant', category: 'groceries' }),
  // A manual override outranks any assignment, including one appended after it.
  event('manual_override', 'manual', {
    event_id: 'tx-restaurant',
    original_category: 'groceries',
    new_category: 'dining',
  }),
  event('category_assignment', 'rule', { event_id: 'tx-restaurant', category: 'groceries' }),

  // ---- tags --------------------------------------------------------------
  event('tag_assignment', 'rule', { transaction_id: 'tx-groceries', tag_id: 'tag-essential' }),
  event('tag_assignment', 'rule', { transaction_id: 'tx-restaurant', tag_id: 'tag-leisure' }),
  // Removed by hand, which also blocks the rule from putting it straight back.
  event('tag_removal', 'manual', { transaction_id: 'tx-restaurant', tag_id: 'tag-leisure' }),

  // ---- an exchange order and the statement debit it belongs to -----------
  event('security_order', 'activobank', {
    security_order_id: 'order-2025-04-15-abc123',
    date: '2025-04-15',
    side: 'buy',
    security: 'ISHARES CORE MSCI WORLD',
    market: 'EURONEXT',
    quantity: 4,
    price: 92.15,
    quote: 92.15,
    currency: 'EUR',
    executed: true,
  }, [{ type: 'document', id: 'batch-abr/NOTA-BOLSA.pdf' }]),
  tx('tx-security-debit', {
    date: '2025-04-15',
    description: 'COMPRA TITULOS BOLSA',
    merchant: 'BOLSA',
    amount: -368.6,
    account_holder: HOLDER,
    ...CURRENT,
  }, 'batch-abr/EXTRATO.pdf'),

  // ---- a second source entirely ------------------------------------------
  // Proves the projection never assumes one institution: two sources coexist,
  // and the investment side stays out of the review queue on purpose.
  tx('pricempire-2025-05-02-deadbeef', {
    source: 'pricempire',
    date: '2025-05-02',
    description: 'Buy 1x Example Skin | Factory New',
    merchant: 'pricempire',
    amount: -84.3,
    portfolio_id: 'portfolio-1',
  }),
  event('price_update', 'pricempire', {
    symbol: 'Example Skin | Factory New',
    price: 91.5,
    currency: 'EUR',
    timestamp: '2025-05-20',
  }),
  event('asset_snapshot', 'pricempire', {
    provider: 'pricempire',
    date: '2025-05-20',
    items: [
      {
        name: 'Example Skin | Factory New',
        type: 'cs2_skin',
        source: 'pricempire',
        quantity: 1,
        price: 91.5,
        value: 91.5,
        currency: 'EUR',
      },
    ],
  }),
  event('investment_transaction', 'pricempire', {
    investment_transaction_id: 'inv-1',
    date: '2025-05-02',
    name: 'Example Skin | Factory New',
    type: 'buy',
    quantity: 1,
    unit_price: 84.3,
    total_price: 84.3,
    fee_amount: 1.2,
    fee_percentage: 1.4,
    marketplace: 'Example Market',
    currency: 'USD',
  }),

  // ---- two movements linked as one economic act --------------------------
  event('transaction_link', 'correlation', {
    link_id: 'link-1',
    rule_id: 'corr-1',
    transaction_ids: ['tx-security-debit', 'pricempire-2025-05-02-deadbeef'],
    note: 'synthetic correlation',
  }),
];

/** Matches the one asset the snapshot above describes. */
export const SYNTHETIC_ASSETS = [
  {
    name: 'Example Skin | Factory New',
    symbol: 'Example Skin | Factory New',
    type: 'cs2_skin',
    class: 'cs2_skin',
    source: 'pricempire',
    quantity: 1,
    costBasis: 84.3,
    purchaseValue: 84.3,
    currentValue: 91.5,
    lastPrice: 91.5,
    lastPriceDate: '2025-05-20T00:00:00.000Z',
    currency: 'EUR',
    portfolioId: 'portfolio-1',
  },
];

export const SYNTHETIC_SELF_NAMES = [HOLDER];
