import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAccounts,
  computeVaultBalances,
  consolidateVaultNames,
  deriveAccounts,
  findPrimaryAccount,
  internalLegOf,
  isCashWithdrawal,
  matchInternalTransfers,
  vaultNameOf,
  compileProfile,
  DEFAULT_PROFILE,
} from './accounts.js';

const SELF = ['EDUARDO DUARTE SILVA'];
const CURRENT = 'CONTA SIMPLES';
const SAVINGS = 'CONTA POUPEUP';

const tx = (id, date, description, amount, account = null) => ({
  id,
  date,
  description,
  merchant: description,
  amount,
  account,
});

const leg = (t) => internalLegOf(t, { selfNames: SELF, primaryAccount: CURRENT });

test('vaultNameOf reads the vault out of every spelling the bank uses', () => {
  assert.equal(vaultNameOf('PoupeUp - Mealheiro'), 'Mealheiro');
  assert.equal(vaultNameOf('PoupeUp Mealheiro'), 'Mealheiro');
  assert.equal(vaultNameOf('Transferencia PoupeUp Fundo de Emergen'), 'Fundo de Emergen');
  assert.equal(vaultNameOf('PoupeUp'), 'Geral');
});

test('vaultNameOf ignores counterparties that are not the savings product', () => {
  assert.equal(vaultNameOf('EDUARDO DUARTE SILVA'), null);
  assert.equal(vaultNameOf('Unlimint EU LTD'), null);
  assert.equal(vaultNameOf(''), null);
});

test('a truncated vault name folds into its full spelling', () => {
  const canonical = consolidateVaultNames(['Fundo de Emergen', 'Fundo de Emergencia', 'Mealheiro']);
  assert.equal(canonical['Fundo de Emergen'], 'Fundo de Emergencia');
  assert.equal(canonical['Mealheiro'], 'Mealheiro');
});

test('a prefix shared by two distinct vaults is left alone', () => {
  const canonical = consolidateVaultNames(['Fundo', 'Fundo de Ferias', 'Fundo de Emergencia']);
  assert.equal(canonical['Fundo'], 'Fundo');
});

test('the same account under two labels resolves to one account', () => {
  const withNumber = (id, description, amount, account, accountId) => ({
    ...tx(id, '2025-10-01', description, amount, account),
    accountId,
  });
  const accounts = deriveAccounts([
    withNumber('a', 'COMPRA X', -10, 'CONTA SIMPLES', '45600427404'),
    // An older statement printed the name without the number.
    tx('b', '2025-10-02', 'COMPRA Y', -20, 'CONTA SIMPLES'),
    // The advice note calls the very same account something else.
    withNumber('c', 'COMPRA Z', -30, 'Conta Depósitos à Ordem', '45600427404'),
  ]);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, '45600427404');
  assert.equal(accounts[0].transactions, 3);
  assert.deepEqual(accounts[0].labels.sort(), ['CONTA SIMPLES', 'Conta Depósitos à Ordem']);
});

test('the busiest account is the current one', () => {
  assert.equal(
    findPrimaryAccount([
      tx('a', '2025-10-01', 'COMPRA X', -1, CURRENT),
      tx('b', '2025-10-02', 'COMPRA Y', -1, CURRENT),
      tx('c', '2025-10-03', 'TRF DE Transferencia PoupeUp', 1, SAVINGS),
    ]),
    CURRENT
  );
});

test('the same movement reads as a deposit from both accounts', () => {
  assert.deepEqual(leg(tx('a', '2025-10-01', 'TRF P/ PoupeUp - Mealheiro', -500, CURRENT)), {
    side: 'current',
    direction: 'deposit',
    vault: 'Mealheiro',
  });
  assert.deepEqual(leg(tx('b', '2025-10-01', 'TRF DE Transferencia PoupeUp', 500, SAVINGS)), {
    side: 'savings',
    direction: 'deposit',
    vault: 'Geral',
  });
});

test('the same movement reads as a withdrawal from both accounts', () => {
  assert.deepEqual(leg(tx('a', '2025-10-15', 'TRF DE PoupeUp - Mealheiro', 1100, CURRENT)), {
    side: 'current',
    direction: 'withdrawal',
    vault: 'Mealheiro',
  });
  assert.deepEqual(leg(tx('b', '2025-10-15', 'TRF P/ EDUARDO DUARTE SILVA', -1100, SAVINGS)), {
    side: 'savings',
    direction: 'withdrawal',
    vault: null,
  });
});

test('an advice note naming the holder is savings-side even with no account on it', () => {
  assert.equal(leg(tx('a', '2025-10-15', 'TRF P/ EDUARDO DUARTE SILVA', -1100)).side, 'savings');
  assert.equal(leg(tx('b', '2025-10-01', 'TRF P/ PoupeUp', -280)).side, 'current');
});

test('a transfer to another person is not an internal movement', () => {
  assert.equal(leg(tx('a', '2025-10-10', 'TRF. P/O CATIA MONICA GOMES DUARTE', 5, CURRENT)), null);
  assert.equal(leg(tx('b', '2025-10-02', 'TRF P/ Unlimint EU LTD', -232.02, CURRENT)), null);
  assert.equal(leg(tx('c', '2025-10-11', 'Transferência MB WAY', -10, CURRENT)), null);
});

test('a deposit booked on both accounts collapses into one movement', () => {
  const { movements, redundantIds } = matchInternalTransfers(
    [
      tx('cur', '2025-10-01', 'TRF P/ PoupeUp', -280, CURRENT),
      tx('mir', '2025-10-01', 'TRF DE Transferencia PoupeUp', 280, SAVINGS),
    ],
    { selfNames: SELF }
  );

  assert.equal(movements.length, 1);
  assert.equal(movements[0].direction, 'deposit');
  assert.equal(movements[0].amount, 280);
  assert.equal(movements[0].singleEntry, false);
  assert.deepEqual([...redundantIds], ['mir']);
});

test('a withdrawal takes its vault name from whichever leg carries one', () => {
  const { movements } = matchInternalTransfers(
    [
      tx('cur', '2025-10-15', 'TRF DE PoupeUp - Mealheiro', 1100, CURRENT),
      tx('mir', '2025-10-15', 'TRF P/ EDUARDO DUARTE SILVA', -1100, SAVINGS),
    ],
    { selfNames: SELF }
  );

  assert.equal(movements.length, 1);
  assert.equal(movements[0].direction, 'withdrawal');
  assert.equal(movements[0].vault, 'Mealheiro');
});

test('a deposit is never paired with a same-day withdrawal of equal value', () => {
  const { movements } = matchInternalTransfers(
    [
      tx('dep', '2025-10-02', 'TRF P/ PoupeUp - Mealheiro', -243, CURRENT),
      tx('wdr', '2025-10-02', 'TRF DE PoupeUp Faculdade', 243, CURRENT),
      tx('wdrMirror', '2025-10-02', 'TRF P/ EDUARDO DUARTE SILVA', -243, SAVINGS),
    ],
    { selfNames: SELF }
  );

  const deposit = movements.find((m) => m.direction === 'deposit');
  const withdrawal = movements.find((m) => m.direction === 'withdrawal');
  assert.equal(deposit.vault, 'Mealheiro');
  assert.equal(deposit.singleEntry, true);
  assert.equal(withdrawal.vault, 'Faculdade');
  assert.equal(withdrawal.mirrorId, 'wdrMirror');
});

test('legs booked a couple of days apart still pair', () => {
  const { movements } = matchInternalTransfers(
    [
      tx('cur', '2025-04-01', 'TRF P/ PoupeUp', -280, CURRENT),
      tx('mir', '2025-04-03', 'TRF DE Transferencia PoupeUp', 280, SAVINGS),
    ],
    { selfNames: SELF }
  );
  assert.equal(movements.length, 1);
  assert.equal(movements[0].singleEntry, false);
});

test('a current-account leg whose mirror was never ingested still counts once', () => {
  const { movements, internalIds, redundantIds } = matchInternalTransfers(
    [tx('cur', '2025-04-01', 'TRF P/ PoupeUp - Mealheiro', -280, CURRENT)],
    { selfNames: SELF }
  );

  assert.equal(movements.length, 1);
  assert.equal(movements[0].singleEntry, true);
  assert.deepEqual([...internalIds], ['cur']);
  assert.equal(redundantIds.size, 0);
});

test('same-value legs on one day each claim a mirror exactly once', () => {
  const { movements, redundantIds } = matchInternalTransfers(
    [
      tx('cur1', '2025-10-02', 'TRF P/ PoupeUp - Mealheiro', -231.95, CURRENT),
      tx('cur2', '2025-10-02', 'TRF P/ PoupeUp - Mealheiro', -231.95, CURRENT),
      tx('mir1', '2025-10-02', 'TRF DE Transferencia PoupeUp Mealheiro', 231.95, SAVINGS),
      tx('mir2', '2025-10-02', 'TRF DE Transferencia PoupeUp Mealheiro', 231.95, SAVINGS),
    ],
    { selfNames: SELF }
  );

  assert.equal(movements.length, 2);
  assert.equal(redundantIds.size, 2);
  assert.deepEqual(movements.map((m) => m.mirrorId).sort(), ['mir1', 'mir2']);
});

test('vault balances net deposits against withdrawals under one canonical name', () => {
  const { vaults, total } = computeVaultBalances([
    { vault: 'Fundo de Emergencia', direction: 'deposit', amount: 1500, date: '2026-04-30' },
    { vault: 'Fundo de Emergen', direction: 'withdrawal', amount: 1100, date: '2026-05-18' },
    { vault: 'Mealheiro', direction: 'deposit', amount: 500, date: '2025-10-31' },
  ]);

  assert.equal(vaults.length, 2);
  const emergency = vaults.find((v) => v.vault === 'Fundo de Emergencia');
  assert.equal(emergency.balance, 400);
  assert.equal(emergency.movements, 2);
  assert.equal(emergency.lastMovement, '2026-05-18');
  assert.equal(total, 900);
});

test('a vault emptied without ever being filled claims its deposits from the unnamed pool', () => {
  const { vaults, total, needsAttribution } = computeVaultBalances([
    { vault: 'Geral', direction: 'deposit', amount: 4020, date: '2025-04-01' },
    { vault: 'Mealheiro', direction: 'withdrawal', amount: 1020, date: '2026-07-30' },
  ]);

  const mealheiro = vaults.find((v) => v.vault === 'Mealheiro');
  const geral = vaults.find((v) => v.vault === 'Geral');
  assert.equal(mealheiro.balance, 0);
  assert.equal(mealheiro.settled, 1020);
  assert.equal(mealheiro.estimated, true);
  assert.deepEqual(mealheiro.settledWith, ['Geral']);
  assert.equal(geral.balance, 3000);
  assert.equal(geral.settled, -1020);
  assert.equal(geral.unnamed, true);
  // The euros moved between two vaults that are both counted, so the savings
  // account still holds exactly what it held before.
  assert.equal(total, 3000);
  assert.equal(needsAttribution, true);
});

/**
 * The real ledger's shape, and the one the old settlement could not touch: there
 * is no vault called "Geral" at all. Faculdade's deposits were written down as
 * "Mealheiro" — the bank's generic word for a piggy bank — so Faculdade read
 * −533 € while Mealheiro read 533 € too rich.
 */
test('a vault borrows from the fullest one when there is no unnamed pool', () => {
  const { vaults, total, needsAttribution } = computeVaultBalances([
    { vault: 'Mealheiro', direction: 'deposit', amount: 3123, date: '2025-01-15' },
    { vault: 'Fundo de Emergencia', direction: 'deposit', amount: 1500, date: '2025-02-01' },
    { vault: 'Faculdade', direction: 'withdrawal', amount: 533, date: '2025-10-30' },
  ]);

  const faculdade = vaults.find((v) => v.vault === 'Faculdade');
  const mealheiro = vaults.find((v) => v.vault === 'Mealheiro');
  const fundo = vaults.find((v) => v.vault === 'Fundo de Emergencia');

  assert.equal(faculdade.balance, 0);
  assert.equal(faculdade.estimated, true);
  assert.deepEqual(faculdade.settledWith, ['Mealheiro']);
  // Borrowed from the fullest vault, which is where the deposits most likely sat.
  assert.equal(mealheiro.balance, 2590);
  assert.equal(fundo.balance, 1500);
  assert.equal(total, 4090);
  assert.equal(needsAttribution, true);
});

test('no vault is ever left holding less than nothing while another has money', () => {
  const { vaults } = computeVaultBalances([
    { vault: 'A', direction: 'deposit', amount: 200, date: '2025-01-01' },
    { vault: 'B', direction: 'deposit', amount: 300, date: '2025-01-02' },
    { vault: 'C', direction: 'withdrawal', amount: 450, date: '2025-03-01' },
  ]);

  for (const v of vaults) assert.ok(v.balance >= 0, `${v.vault} went to ${v.balance}`);
  // Drained the fullest first, then the rest.
  assert.equal(vaults.find((v) => v.vault === 'B').balance, 0);
  assert.equal(vaults.find((v) => v.vault === 'A').balance, 50);
});

test('settling never leaves a vault holding less than nothing', () => {
  const { vaults, total } = computeVaultBalances([
    { vault: 'Geral', direction: 'deposit', amount: 4143, date: '2025-01-01' },
    { vault: 'Faculdade', direction: 'withdrawal', amount: 533, date: '2025-06-01' },
    { vault: 'Mealheiro', direction: 'withdrawal', amount: 1020, date: '2025-07-01' },
  ]);

  for (const v of vaults) assert.ok(v.balance >= 0, `${v.vault} went to ${v.balance}`);
  // 4143 deposited less 1553 withdrawn. Settling shuffles the split between
  // vaults; it never invents or destroys a euro.
  assert.equal(total, 2590);
});

test('no vault is lent more than the savings account actually holds', () => {
  const { vaults, total } = computeVaultBalances([
    { vault: 'Geral', direction: 'deposit', amount: 100, date: '2025-01-01' },
    { vault: 'Mealheiro', direction: 'withdrawal', amount: 400, date: '2025-02-01' },
  ]);

  assert.equal(vaults.find((v) => v.vault === 'Geral').balance, 0);
  // Everything on file has been lent and the balance is still impossible, which
  // means the withdrawal has no matching deposit anywhere in the data. That is a
  // gap worth reporting, not one to hide by inventing a euro.
  assert.equal(vaults.find((v) => v.vault === 'Mealheiro').short, true);
  assert.equal(total, -300);
});

test('a vault refilled after borrowing keeps what it was later given', () => {
  const { vaults, total } = computeVaultBalances([
    { vault: 'Geral', direction: 'deposit', amount: 2000, date: '2025-01-01' },
    // Emptied before the bank ever named a deposit into it...
    { vault: 'Mealheiro', direction: 'withdrawal', amount: 800, date: '2025-02-01' },
    // ...then filled again, now that the descriptor carries the name.
    { vault: 'Mealheiro', direction: 'deposit', amount: 500, date: '2025-03-01' },
  ]);

  assert.equal(vaults.find((v) => v.vault === 'Mealheiro').balance, 500);
  assert.equal(vaults.find((v) => v.vault === 'Geral').balance, 1200);
  assert.equal(total, 1700);
});

test('pointing the unnamed pool at its real vault settles the balance', () => {
  const { vaults, total, needsAttribution } = computeVaultBalances(
    [
      { vault: 'Geral', direction: 'deposit', amount: 4020, date: '2025-04-01' },
      { vault: 'Mealheiro', direction: 'withdrawal', amount: 1020, date: '2026-07-30' },
    ],
    { aliases: { Geral: 'Mealheiro' } }
  );

  assert.equal(vaults.length, 1);
  assert.equal(vaults[0].vault, 'Mealheiro');
  assert.equal(vaults[0].balance, 3000);
  assert.equal(vaults[0].estimated, false);
  assert.equal(total, 3000);
  assert.equal(needsAttribution, false);
});

test('deriveAccounts discovers accounts from the documents, not from config', () => {
  const accounts = deriveAccounts([
    tx('a', '2025-10-01', 'COMPRA X', -10, CURRENT),
    tx('b', '2025-10-05', 'COMPRA Y', -20, CURRENT),
    tx('c', '2025-10-02', 'TRF DE Transferencia PoupeUp', 280, SAVINGS),
    tx('d', '2025-10-03', 'COMPRA Z', -5),
  ]);

  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].name, CURRENT);
  assert.equal(accounts[0].kind, 'current');
  assert.equal(accounts[0].primary, true);
  assert.equal(accounts[0].transactions, 2);
  assert.equal(accounts[0].firstDate, '2025-10-01');
  assert.equal(accounts[1].kind, 'savings');
});

test('cash withdrawals are spending, not internal movements', () => {
  assert.equal(isCashWithdrawal(tx('a', '2025-11-10', 'LEV ATM 0412 BCP Braga Pc Conde Agrol', -40)), true);
  assert.equal(isCashWithdrawal(tx('b', '2025-10-01', 'TRF P/ PoupeUp', -280)), false);
  assert.equal(leg(tx('a', '2025-11-10', 'LEV ATM 0412 BCP Braga', -40, CURRENT)), null);
});

test('October 2025 counts the computer once and the shuffling not at all', () => {
  const october = [
    tx('pc', '2025-10-17', 'COMPRA 0412 PcComponentes Murcia ES', -1349.25, CURRENT),
    tx('cur', '2025-10-15', 'TRF DE PoupeUp - Mealheiro', 1100, CURRENT),
    tx('mir', '2025-10-15', 'TRF P/ EDUARDO DUARTE SILVA', -1100, SAVINGS),
  ];
  const { internalIds, vaults } = analyzeAccounts(october, { selfNames: SELF });

  const spending = october
    .filter((t) => !internalIds.has(t.id) && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  assert.equal(spending, 1349.25);
  assert.equal(vaults[0].vault, 'Mealheiro');
  assert.equal(vaults[0].withdrawn, 1100);
});

// ---------- institution profile ----------
//
// The whole point: none of the matching logic above may be spelled in
// ActivoBank's own words at the call site, or a second bank could never work.
// This profile invents a bank that phrases everything differently — "PARA"
// instead of "P/", "DE PARTE DE" instead of "DE", a savings product called
// "Poupança Já" instead of "PoupeUp" — and the same functions have to find
// the same internal transfer through it, using nothing but the profile.

const OTHER_BANK = {
  name: 'Banco Fictício',
  transferOut: '^TRANSF\\.?\\s*PARA\\s+',
  transferIn: '^TRANSF\\.?\\s*DE PARTE DE\\s+',
  // No trailing `\b` here: JS's default (non-unicode) `\b` treats accented
  // letters as non-word characters, so a boundary right after "á" does not
  // reliably fire. Real profiles should end a pattern on an ASCII boundary for
  // the same reason — this is exactly the kind of thing the preview panel in
  // Settings is for.
  savingsProduct: '^(?:Mov\\.\\s+)?Poupan[çc]a J[áa]',
  savingsAccount: 'POUPANCA JA|CONTA POUPANCA',
  cashWithdrawal: '^LEVANTAMENTO MB\\b',
};

test('a profile in another bank\'s own words finds the same internal transfer', () => {
  const matchers = compileProfile(OTHER_BANK);
  const leg1 = internalLegOf(
    tx('a', '2026-01-10', 'TRANSF PARA Poupança Já - Férias', -200, 'CONTA CORRENTE'),
    { selfNames: SELF, primaryAccount: 'CONTA CORRENTE', matchers }
  );
  assert.ok(leg1);
  assert.equal(leg1.side, 'current');
  assert.equal(leg1.direction, 'deposit');
  assert.equal(leg1.vault, 'Férias');

  const leg2 = internalLegOf(
    tx('b', '2026-01-10', 'TRANSF DE PARTE DE EDUARDO DUARTE SILVA', 200, 'CONTA POUPANCA JA'),
    { selfNames: SELF, primaryAccount: 'CONTA CORRENTE', matchers }
  );
  assert.ok(leg2);
  assert.equal(leg2.side, 'savings');
  assert.equal(leg2.direction, 'deposit');
});

test('a profile drives matchInternalTransfers and analyzeAccounts end to end', () => {
  const transactions = [
    tx('cur', '2026-01-10', 'TRANSF PARA Poupança Já - Férias', -200, 'CONTA CORRENTE'),
    tx('sav', '2026-01-10', 'TRANSF DE PARTE DE EDUARDO DUARTE SILVA', 200, 'CONTA POUPANCA JA'),
    tx('shop', '2026-01-11', 'COMPRA SUPERMERCADO', -30, 'CONTA CORRENTE'),
  ];
  const { internalIds, vaults } = analyzeAccounts(transactions, {
    selfNames: SELF,
    profile: OTHER_BANK,
  });
  assert.equal(internalIds.has('cur'), true);
  assert.equal(internalIds.has('sav'), true);
  assert.equal(internalIds.has('shop'), false);
  assert.equal(vaults[0].vault, 'Férias');
  assert.equal(vaults[0].balance, 200);
});

test('an unrecognised institution profile falls back to the default patterns rather than matching nothing', () => {
  // A profile with an invalid regex (user typo) must not crash the whole
  // matcher — it silently falls back to ActivoBank's own pattern for that one
  // field, exactly like a missing field would.
  const broken = { ...DEFAULT_PROFILE, transferOut: '(unterminated' };
  const matchers = compileProfile(broken);
  const result = internalLegOf(tx('a', '2026-01-10', 'TRF P/ PoupeUp', -200, 'CONTA SIMPLES'), {
    selfNames: SELF,
    primaryAccount: 'CONTA SIMPLES',
    matchers,
  });
  assert.ok(result, 'falls back to the default transferOut pattern instead of matching nothing');
});
