/**
 * Two banks at once.
 *
 * This is the case the framework was built for, and the one nothing else can
 * test: Eduardo has a single institution, so his real ledger — the strongest
 * evidence available for everything else — says nothing at all about what
 * happens when a second one is configured.
 *
 * The danger is specific and expensive. `engines/accounts.js` recognises money
 * moving between the owner's own accounts by matching the descriptor against
 * five regular expressions. Read a Santander statement with ActivoBank's
 * wording and not one transfer is recognised, so every move between the owner's
 * own accounts is counted as real spending. That is the €13.293 error this
 * codebase already made once, and a second bank is a second door to it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAccounts,
  compileProfiles,
  isCashWithdrawal,
  DEFAULT_PROFILE,
} from '../engines/accounts.js';

const HOLDER = 'MARIA EXEMPLO SANTOS';

/** A bank that words everything differently from the shipped default. */
const OTHER_BANK = {
  name: 'Outro Banco',
  transferOut: '^ENVIO PARA\\s+',
  transferIn: '^RECEBIDO DE\\s+',
  savingsProduct: '^Cofre\\b',
  savingsAccount: 'COFRE|AFORRO',
  cashWithdrawal: '^MULTIBANCO LEVANTAMENTO\\b',
};

let seq = 0;
const tx = (source, overrides) => ({
  id: `tx-${++seq}`,
  source,
  date: '2025-03-10',
  amount: -100,
  description: '',
  account_holder: HOLDER,
  accountHolder: HOLDER,
  ...overrides,
});

/** ActivoBank's own wording, on the ActivoBank instance. */
const activobankLegs = () => [
  tx('activobank', {
    description: 'TRF P/ PoupeUp - Mealheiro',
    amount: -100,
    account: 'CONTA SIMPLES',
    accountId: '111',
  }),
  tx('activobank', {
    description: `TRF DE ${HOLDER}`,
    amount: 100,
    account: 'CONTA POUPEUP',
    accountId: '222',
  }),
];

/** The other bank's wording, on the other bank's instance. */
const otherBankLegs = () => [
  tx('outro', {
    description: 'ENVIO PARA Cofre - Ferias',
    amount: -250,
    account: 'CONTA CORRENTE',
    accountId: '333',
  }),
  tx('outro', {
    description: `RECEBIDO DE ${HOLDER}`,
    amount: 250,
    account: 'CONTA AFORRO',
    accountId: '444',
  }),
];

const analyse = (transactions, profiles) =>
  analyzeAccounts(transactions, { selfNames: [HOLDER], profiles });

test('each bank is read in its own wording', () => {
  const result = analyse([...activobankLegs(), ...otherBankLegs()], {
    activobank: null, // null means the shipped ActivoBank default
    outro: OTHER_BANK,
  });

  // All four legs are internal movements. Under a single profile, two of them
  // would have been counted as €250 of spending and €250 of income.
  assert.equal(result.internalIds.size, 4);
  assert.deepEqual(
    result.vaults.map((v) => v.vault).sort(),
    ['Ferias', 'Mealheiro']
  );
});

test('one bank\'s wording is never applied to the other\'s statements', () => {
  // The failure this guards against: configure the second bank, and the first
  // one silently stops recognising anything.
  const result = analyse([...activobankLegs(), ...otherBankLegs()], {
    activobank: OTHER_BANK,
    outro: OTHER_BANK,
  });

  // With ActivoBank misconfigured, only the other bank's two legs are found —
  // which is exactly the symptom, made visible.
  assert.equal(result.internalIds.size, 2);
});

test('a source with no profile of its own falls back to the shipped wording', () => {
  const result = analyse(activobankLegs(), { outro: OTHER_BANK });
  assert.equal(result.internalIds.size, 2);
});

test('with one bank configured the result is what a single profile gave', () => {
  const transactions = activobankLegs();
  const withProfiles = analyse(transactions, { activobank: null });
  const single = analyzeAccounts(transactions, { selfNames: [HOLDER], profile: DEFAULT_PROFILE });

  assert.deepEqual([...withProfiles.internalIds].sort(), [...single.internalIds].sort());
  assert.deepEqual(withProfiles.vaults, single.vaults);
  assert.deepEqual(withProfiles.accounts, single.accounts);
});

test('cash at an ATM is recognised in each bank\'s own words', () => {
  const matchersFor = compileProfiles({ activobank: null, outro: OTHER_BANK });

  assert.equal(
    isCashWithdrawal(tx('activobank', { description: 'LEV ATM 4821 PORTO' }), matchersFor),
    true
  );
  assert.equal(
    isCashWithdrawal(tx('outro', { description: 'MULTIBANCO LEVANTAMENTO 902' }), matchersFor),
    true
  );
  // …and neither bank's phrasing leaks into the other.
  assert.equal(
    isCashWithdrawal(tx('outro', { description: 'LEV ATM 4821 PORTO' }), matchersFor),
    false
  );
  assert.equal(
    isCashWithdrawal(tx('activobank', { description: 'MULTIBANCO LEVANTAMENTO 902' }), matchersFor),
    false
  );
});

test('a savings account at the second bank is recognised as savings', () => {
  const result = analyse([...activobankLegs(), ...otherBankLegs()], {
    activobank: null,
    outro: OTHER_BANK,
  });

  const savings = result.accounts.filter((a) => a.kind === 'savings').map((a) => a.name).sort();
  assert.deepEqual(savings, ['CONTA AFORRO', 'CONTA POUPEUP']);
});

test('a transfer between two different banks is still an internal movement', () => {
  // Money leaving one bank towards the account holder at another is not
  // spending. Impossible to encounter with a single institution configured,
  // and the first thing that happens with two.
  const legs = [
    tx('activobank', {
      description: `TRF P/ ${HOLDER}`,
      amount: -500,
      account: 'CONTA SIMPLES',
      accountId: '111',
    }),
    tx('outro', {
      description: `RECEBIDO DE ${HOLDER}`,
      amount: 500,
      account: 'CONTA CORRENTE',
      accountId: '333',
    }),
  ];

  const result = analyse(legs, { activobank: null, outro: OTHER_BANK });
  assert.equal(result.internalIds.size, 2, 'both legs of a cross-bank transfer must be internal');
});
