/**
 * Accounts, vaults and internal movements.
 *
 * ActivoBank statements cover two real accounts — the current account
 * ("CONTA SIMPLES", nº 45600427404) and the savings account
 * ("CONTA POUPEUP", nº 45745108724) — and the ingestion pipeline pours both
 * into one flat transaction list. Every move between them therefore lands in
 * the ledger twice, correctly signed from each account's own point of view:
 *
 *   2025-10-15  nota     TRF DE PoupeUp - Mealheiro    +1100   (current account)
 *   2025-10-15  extrato  TRF P/ EDUARDO DUARTE SILVA   -1100   (savings account)
 *
 * Summed together as if they were one account, those two rows inflate both
 * spending and income by the same amount. Across the whole ledger that is
 * €13.293,00 on each side, which is why a month like October 2025 reads as
 * €8.693 spent when €5.360 actually left.
 *
 * Pairing legs on amount and date alone is not enough: a day can hold a deposit
 * and a withdrawal of the same value, and matching those two together produces
 * a vault that has been emptied more often than it was filled. Legs are
 * therefore classified by *role* first — which account they sit on, and which
 * way the money went — and only ever paired with the opposite leg of the same
 * role.
 *
 * The vaults ("mealheiros") are not accounts of their own. They are subdivisions
 * inside the single savings account, named only in the movement descriptor, so
 * they are discovered from the data rather than configured.
 */

/** Strips diacritics so bank text compares equal regardless of accenting. */
function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const amountOf = (tx) => (typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0);
const dateOf = (tx) => String(tx.date || tx.timestamp || '').slice(0, 10);

/** The account label a transaction was booked on, when the document declared one. */
export function accountOf(tx) {
  return tx.account ?? tx.raw?.payload?.account ?? null;
}

/** The account number a document declared, when it declared one. */
export function accountNumberOf(tx) {
  return tx.accountId ?? tx.raw?.payload?.account_id ?? null;
}

/**
 * What identifies the account across document types.
 *
 * A statement calls the current account "CONTA SIMPLES" while an advice note
 * calls the very same account "Conta Depósitos à Ordem", so the number is the
 * only thing that ties them together. Documents predating number extraction
 * fall back on the label.
 */
export function accountKeyOf(tx) {
  return accountNumberOf(tx) ?? accountOf(tx);
}

/**
 * Learns which label belongs to which account number.
 *
 * Older statements print the account name without its number, so on their own
 * they would look like a different account from the newer ones. Any label seen
 * alongside a number even once is resolved to that number everywhere. A label
 * that has appeared with two different numbers is left unresolved rather than
 * guessed at.
 */
export function buildAccountResolver(transactions) {
  const numbersByLabel = new Map();
  for (const tx of transactions) {
    const label = accountOf(tx);
    const number = accountNumberOf(tx);
    if (!label || !number) continue;
    if (!numbersByLabel.has(label)) numbersByLabel.set(label, new Set());
    numbersByLabel.get(label).add(number);
  }

  const resolved = new Map();
  for (const [label, numbers] of numbersByLabel) {
    if (numbers.size === 1) resolved.set(label, [...numbers][0]);
  }

  return (tx) => accountNumberOf(tx) ?? resolved.get(accountOf(tx)) ?? accountOf(tx);
}

/** The account holder, as the bank prints it on its own paperwork. */
export function accountHolderOf(tx) {
  return tx.accountHolder ?? tx.raw?.payload?.account_holder ?? null;
}

/** Every name the bank has used for the owner of these accounts. */
export function deriveSelfNames(transactions) {
  const names = new Set();
  for (const tx of transactions) {
    const holder = accountHolderOf(tx);
    if (holder) names.add(holder);
  }
  return [...names];
}

const DAY_MS = 86400000;
function dayNumber(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// ---------- institution profile ----------
//
// Every pattern below used to be a module-level constant, which is another way
// of saying: this file only ever worked for ActivoBank. A Santander statement
// spells the same two ideas — "money left towards X", "this is the PoupeUp
// product" — in its own words, and without a seam to swap them at, the engine
// would silently fail to recognise a single internal transfer and count every
// move between the owner's own accounts as real spending. That is the exact
// €13.293 bug this file exists to prevent, just triggered by a different bank.
//
// A profile is five source strings, JSON-shaped so it can be edited from the
// interface and stored in settings; `compileProfile` turns it into the five
// compiled `RegExp`s the matchers actually use. ActivoBank's own wording is
// the default, unchanged from before — nothing about today's behaviour moves
// unless a profile is explicitly passed in.
export const DEFAULT_PROFILE = {
  name: 'ActivoBank',
  // "TRF P/ X" is money leaving this account towards X; "TRF DE X" is money
  // arriving from X. The bank writes both with and without the trailing dot.
  transferOut: '^TRF\\.?\\s*P/\\s*',
  transferIn: '^TRF\\.?\\s*DE\\s+',
  // A "Transferencia" prefix is slipped in front of the counterparty on the
  // savings side only.
  savingsProduct: '^(?:Transferencia\\s+)?PoupeUp\\b',
  // An account whose statement calls the account holder its counterparty is a
  // savings account, not the current account.
  savingsAccount: 'POUPEUP|POUPAN[ÇC]A|SAVINGS',
  cashWithdrawal: '^LEV\\s*ATM\\b',
};

function safeRegExp(source, fallback) {
  try {
    return new RegExp(source, 'i');
  } catch {
    return new RegExp(fallback, 'i');
  }
}

/** Source strings in, compiled matchers out — done once per call, not per row. */
export function compileProfile(profile = DEFAULT_PROFILE) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  return {
    transferOut: safeRegExp(p.transferOut, DEFAULT_PROFILE.transferOut),
    transferIn: safeRegExp(p.transferIn, DEFAULT_PROFILE.transferIn),
    savingsProduct: safeRegExp(p.savingsProduct, DEFAULT_PROFILE.savingsProduct),
    savingsAccount: safeRegExp(p.savingsAccount, DEFAULT_PROFILE.savingsAccount),
    cashWithdrawal: safeRegExp(p.cashWithdrawal, DEFAULT_PROFILE.cashWithdrawal),
  };
}

const DEFAULT_MATCHERS = compileProfile(DEFAULT_PROFILE);

/**
 * Which institution's wording to read a given movement with.
 *
 * One person can bank in two places, and the two do not agree on how to write
 * "money left this account". Compiling one profile for the whole ledger meant
 * the second bank's transfers were invisible as internal movements — counted as
 * real spending, which is the €13.293 bug this file exists to prevent, arriving
 * by a different door.
 *
 * `profiles` is keyed by the `source` on the event, which is the module instance
 * that ingested it. Compiled once per source here rather than per row: a hot
 * loop over the whole ledger must not rebuild five regexes on every movement.
 *
 * With one bank configured, or none, this resolves to exactly what a single
 * profile did before.
 */
export function compileProfiles(profiles = {}, fallback = DEFAULT_PROFILE) {
  const bySource = new Map();
  for (const [source, profile] of Object.entries(profiles)) {
    bySource.set(source, compileProfile(profile ?? fallback));
  }
  const shared = fallback === DEFAULT_PROFILE ? DEFAULT_MATCHERS : compileProfile(fallback);
  return (tx) => bySource.get(tx?.source) ?? shared;
}

/** A resolver that answers with the same matchers whatever it is asked. */
function alwaysMatchers(profileOrResolver) {
  if (typeof profileOrResolver === 'function') return profileOrResolver;
  const matchers =
    profileOrResolver === DEFAULT_PROFILE ? DEFAULT_MATCHERS : compileProfile(profileOrResolver);
  return () => matchers;
}

/** The counterparty text of a transfer descriptor, or null if not a transfer. */
function counterpartyOf(description, matchers = DEFAULT_MATCHERS) {
  const text = String(description || '').trim();
  const out = text.match(matchers.transferOut);
  if (out) return { outgoing: true, counterparty: text.slice(out[0].length).trim() };
  const inc = text.match(matchers.transferIn);
  if (inc) return { outgoing: false, counterparty: text.slice(inc[0].length).trim() };
  return null;
}

/**
 * The vault named by a savings-product counterparty, as the bank wrote it.
 *
 * "PoupeUp - Mealheiro", "PoupeUp Mealheiro" and "Transferencia PoupeUp
 * Mealheiro" all name the same vault; a bare "PoupeUp" names an unnamed one.
 * Names come back verbatim and are consolidated later, because the statement
 * truncates long ones ("Fundo de Emergen") and only the full set of observed
 * spellings reveals which are the same vault.
 */
export function vaultNameOf(counterparty, matchers = DEFAULT_MATCHERS) {
  const text = String(counterparty || '').trim();
  if (!matchers.savingsProduct.test(text)) return null;
  const rest = text.replace(matchers.savingsProduct, '').replace(/^\s*[-–—]\s*/, '').trim();
  return rest || UNNAMED_VAULT;
}

export const UNNAMED_VAULT = 'Geral';

/**
 * Folds truncated vault spellings into their full form.
 *
 * The statement clips the descriptor at a fixed width, so "Fundo de Emergencia"
 * also shows up as "Fundo de Emergen". A name that is a strict prefix of
 * exactly one longer name is that name, cut short. Requiring exactly one match
 * keeps genuinely distinct vaults sharing a prefix from being merged.
 */
export function consolidateVaultNames(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const canonical = {};
  for (const name of unique) {
    const folded = fold(name);
    const longer = unique.filter((other) => {
      const otherFolded = fold(other);
      return otherFolded !== folded && otherFolded.startsWith(folded);
    });
    canonical[name] = longer.length === 1 ? longer[0] : name;
  }
  return canonical;
}

/**
 * Which account is the everyday one.
 *
 * Taken from the data rather than configured: the account carrying the most
 * movements is where life happens, and anything else in the perimeter is a
 * savings or secondary account. Advice notes name no account at all, and are
 * always the current account's own paperwork.
 */
export function findPrimaryAccount(transactions, keyOf = buildAccountResolver(transactions)) {
  const counts = new Map();
  for (const tx of transactions) {
    const account = keyOf(tx);
    if (!account) continue;
    counts.set(account, (counts.get(account) || 0) + 1);
  }
  let primary = null;
  let best = -1;
  for (const [account, count] of counts) {
    if (count > best) {
      best = count;
      primary = account;
    }
  }
  return primary;
}

/**
 * The everyday account *at each institution*, as a lookup by transaction.
 *
 * There is one busiest account per bank, not one in the world. Picking a single
 * global winner meant that with two banks configured, the second one's current
 * account was not the primary and so fell through to being classified as
 * savings — which then made its ordinary payments look like transfers into a
 * savings product, and its real transfers unpairable. Invisible with one
 * institution, wrong the moment there are two.
 */
export function findPrimaryAccounts(transactions, keyOf = buildAccountResolver(transactions)) {
  const bySource = new Map();
  for (const tx of transactions) {
    const source = tx.source ?? null;
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(tx);
  }

  const primaries = new Map();
  for (const [source, rows] of bySource) {
    primaries.set(source, findPrimaryAccount(rows, keyOf));
  }
  return (tx) => primaries.get(tx?.source ?? null) ?? null;
}

/**
 * Classifies a transaction as one leg of an internal movement.
 *
 * Two descriptor shapes qualify. Seen from the current account the counterparty
 * is the savings product itself ("TRF P/ PoupeUp - Mealheiro"); seen from the
 * savings account it is the account holder ("TRF P/ EDUARDO DUARTE SILVA"),
 * because as far as that account is concerned the money is going to its owner.
 *
 * Which side a leg sits on comes from the account the document declared. Advice
 * notes declare none, so they fall back on the descriptor: only a savings
 * account ever calls the holder its counterparty.
 */
export function internalLegOf(
  tx,
  { selfNames = [], primaryAccount = null, keyOf = accountKeyOf, matchers = DEFAULT_MATCHERS } = {}
) {
  const parsed = counterpartyOf(tx.description, matchers);
  if (!parsed) return null;

  const vault = vaultNameOf(parsed.counterparty, matchers);
  const folded = fold(parsed.counterparty);
  const namesHolder =
    !vault &&
    selfNames.some((name) => {
      const self = fold(name);
      return self.length > 0 && folded.startsWith(self);
    });
  if (!vault && !namesHolder) return null;

  const key = keyOf(tx);
  const label = accountOf(tx);
  let side;
  if (key) side = matchers.savingsAccount.test(label || '') || key !== primaryAccount ? 'savings' : 'current';
  else side = namesHolder ? 'savings' : 'current';

  // On the current account, money going out is money going into savings; on the
  // savings account it is the reverse.
  const outgoing = parsed.outgoing;
  const direction = side === 'current' ? (outgoing ? 'deposit' : 'withdrawal') : outgoing ? 'withdrawal' : 'deposit';

  return { side, direction, vault: vault || null };
}

/**
 * Pairs each current-account leg with its savings-account mirror.
 *
 * Only legs of the same direction are ever paired, so a deposit can never
 * cancel a withdrawal. A leg whose mirror is missing — the savings statements
 * cover a shorter period than the current account's do — stays a real internal
 * movement; it is simply single-entry, and reported as such.
 */
export function matchInternalTransfers(
  transactions,
  { selfNames = [], windowDays = 3, profile = DEFAULT_PROFILE, profiles = null } = {}
) {
  // Legs are still paired across every account, including across two different
  // banks — a transfer from one to the other is exactly as internal as one
  // between two accounts at the same bank. Only the *reading* of each descriptor
  // is per-institution.
  const matchersFor = profiles ? compileProfiles(profiles, profile) : alwaysMatchers(profile);
  const keyOf = buildAccountResolver(transactions);
  const primaryFor = findPrimaryAccounts(transactions, keyOf);

  const legs = [];
  transactions.forEach((tx, index) => {
    const leg = internalLegOf(tx, {
      selfNames,
      primaryAccount: primaryFor(tx),
      keyOf,
      matchers: matchersFor(tx),
    });
    if (!leg) return;
    const day = dayNumber(dateOf(tx));
    if (day == null) return;
    legs.push({ tx, index, day, amount: Math.abs(amountOf(tx)), ...leg });
  });

  const byOrder = (a, b) => a.day - b.day || a.index - b.index;
  const current = legs.filter((l) => l.side === 'current').sort(byOrder);
  const savings = legs.filter((l) => l.side === 'savings').sort(byOrder);

  const claimed = new Set();
  const movements = [];

  for (const leg of current) {
    let mirror = null;
    let bestRank = null;
    for (const candidate of savings) {
      if (claimed.has(candidate.index)) continue;
      if (candidate.direction !== leg.direction) continue;
      if (Math.abs(candidate.amount - leg.amount) > 0.005) continue;
      const distance = Math.abs(candidate.day - leg.day);
      if (distance > windowDays) continue;
      const rank = [distance, candidate.index];
      if (!bestRank || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
        mirror = candidate;
        bestRank = rank;
      }
    }
    if (mirror) claimed.add(mirror.index);

    // Either leg may be the one that names the vault, and the unnamed default
    // never wins against a real name.
    const named = [leg.vault, mirror?.vault].find((v) => v && v !== UNNAMED_VAULT);
    movements.push({
      date: dateOf(leg.tx),
      amount: leg.amount,
      direction: leg.direction,
      vault: named || leg.vault || mirror?.vault || UNNAMED_VAULT,
      currentId: leg.tx.id,
      mirrorId: mirror?.tx.id || null,
      description: leg.tx.description,
      singleEntry: !mirror,
    });
  }

  // A savings-side leg with no current-account partner is still internal — the
  // current account's statement for that period simply was not ingested.
  const orphanMirrors = savings.filter((l) => !claimed.has(l.index));
  for (const leg of orphanMirrors) {
    movements.push({
      date: dateOf(leg.tx),
      amount: leg.amount,
      direction: leg.direction,
      vault: leg.vault || UNNAMED_VAULT,
      currentId: null,
      mirrorId: leg.tx.id,
      description: leg.tx.description,
      singleEntry: true,
    });
  }

  // Every leg is internal. The mirrors are additionally *redundant*: they are
  // the same movement seen twice, and are what has to leave the totals.
  const internalIds = new Set(legs.map((l) => l.tx.id));
  const redundantIds = new Set(savings.filter((l) => claimed.has(l.index)).map((l) => l.tx.id));

  movements.sort((a, b) => a.date.localeCompare(b.date));
  // One institution's everyday account, for the single-bank callers that read
  // this. With several configured, `findPrimaryAccounts` is the honest answer.
  return { movements, internalIds, redundantIds, primaryAccount: findPrimaryAccount(transactions, keyOf) };
}

/**
 * What each vault holds.
 *
 * Counted once per movement, never once per leg, so the mirrored bookkeeping
 * cannot inflate a balance.
 *
 * The bank only began naming the vault in the descriptor partway through, so
 * early deposits are filed under a name that is not the one the later
 * withdrawal carries. That shows up as a vault holding less than nothing —
 * which no mealheiro has ever done. `settleShortfalls` moves the attribution
 * back where the money actually was; `aliases` lets the owner say outright
 * which vault an unnamed pool belonged to.
 */
export function computeVaultBalances(movements, { aliases = {} } = {}) {
  const aliased = movements.map((m) => ({ ...m, vault: aliases[m.vault] || m.vault }));
  const canonical = consolidateVaultNames(aliased.map((m) => m.vault));
  const named = aliased.map((m) => ({
    ...m,
    vault: canonical[m.vault] || m.vault || UNNAMED_VAULT,
  }));
  const vaults = new Map();

  for (const movement of named) {
    const name = movement.vault;
    const vault = vaults.get(name) || {
      vault: name,
      deposited: 0,
      withdrawn: 0,
      movements: 0,
      lastMovement: null,
    };
    if (movement.direction === 'deposit') vault.deposited += movement.amount;
    else vault.withdrawn += movement.amount;
    vault.movements++;
    if (!vault.lastMovement || movement.date > vault.lastMovement) vault.lastMovement = movement.date;
    vaults.set(name, vault);
  }

  const { adjustments, counterparts } = settleShortfalls(vaults, named);

  const rows = [...vaults.values()].map((v) => {
    const settled = round(adjustments.get(v.vault) || 0);
    const balance = round(v.deposited - v.withdrawn + settled);
    return {
      ...v,
      deposited: round(v.deposited),
      withdrawn: round(v.withdrawn),
      balance,
      // Positive: this vault was credited deposits that had been filed under
      // another name. Negative: it is the vault they were filed under.
      settled,
      // Who the other side of that inference was, so the UI can name it.
      settledWith: [...(counterparts.get(v.vault) || [])],
      unnamed: v.vault === UNNAMED_VAULT,
      // The number is right; the attribution is inferred.
      estimated: Math.abs(settled) > 0.005,
      // Still impossible after settling: the savings account as a whole does not
      // hold enough to explain this withdrawal, which is a real gap in the data
      // rather than a misfiled name.
      short: balance < -0.005,
    };
  });
  rows.sort((a, b) => b.balance - a.balance || a.vault.localeCompare(b.vault));

  return {
    vaults: rows,
    total: round(rows.reduce((sum, v) => sum + v.balance, 0)),
    needsAttribution: rows.some((v) => v.estimated),
  };
}

/**
 * Puts a vault's missing deposits back where the money actually was.
 *
 * The bank only began naming vaults in the descriptor partway through, and its
 * generic word for a piggy bank is "Mealheiro" — so deposits into what the owner
 * calls "Faculdade" were written down as either the unnamed pool or as
 * Mealheiro, while the later withdrawal carries the real name. Counted naively
 * that leaves Faculdade at −533 € and Mealheiro 533 € too rich.
 *
 * Movements are replayed in date order. Whenever a withdrawal would push a vault
 * below zero, the shortfall is borrowed from whichever vault is actually holding
 * it at that moment: the unnamed pool first, since that is what it is for, then
 * the fullest of the others. The split becomes a well-founded estimate; the
 * total never moves, because a euro only ever passes between two vaults that are
 * both counted.
 *
 * This used to bail out at the first line unless a vault literally called
 * "Geral" existed, which is why a ledger whose deposits were all filed under
 * Mealheiro kept showing an impossible balance.
 *
 * Returns the net adjustment per vault (negative for the lenders) and who lent
 * to whom, so the interface can say where the inference came from.
 */
function settleShortfalls(vaults, movements) {
  const adjustments = new Map();
  const counterparts = new Map();
  const names = [...vaults.keys()];
  if (names.length < 2) return { adjustments, counterparts };

  const running = new Map(names.map((name) => [name, 0]));
  const chronological = [...movements].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const note = (a, b) => {
    if (!counterparts.has(a)) counterparts.set(a, new Set());
    counterparts.get(a).add(b);
  };

  for (const movement of chronological) {
    const name = movement.vault;
    const delta = movement.direction === 'deposit' ? movement.amount : -movement.amount;
    running.set(name, (running.get(name) || 0) + delta);

    let owed = -(running.get(name) || 0);
    if (owed <= 0.005) continue;

    // The unnamed pool is the first place to look — it exists precisely because
    // the bank did not say which vault a deposit belonged to. After that, the
    // fullest vault: the deposits have to be sitting somewhere, and that is
    // where the most of them are.
    const lenders = names
      .filter((other) => other !== name && (running.get(other) || 0) > 0.005)
      .sort((a, b) => {
        if (a === UNNAMED_VAULT) return -1;
        if (b === UNNAMED_VAULT) return 1;
        return (running.get(b) || 0) - (running.get(a) || 0);
      });

    for (const lender of lenders) {
      if (owed <= 0.005) break;
      const available = running.get(lender) || 0;
      const moved = Math.min(owed, available);
      if (moved <= 0.005) continue;

      running.set(name, (running.get(name) || 0) + moved);
      running.set(lender, available - moved);
      adjustments.set(name, (adjustments.get(name) || 0) + moved);
      adjustments.set(lender, (adjustments.get(lender) || 0) - moved);
      note(name, lender);
      note(lender, name);
      owed -= moved;
    }
  }

  return { adjustments, counterparts };
}

/**
 * The accounts seen in the data.
 *
 * Accounts are never configured: a document declares which account it covers,
 * and that is what shows up here, so connecting another bank later needs no
 * code.
 */
export function deriveAccounts(transactions, profile = DEFAULT_PROFILE) {
  // A profile, or a resolver from compileProfiles: an account's "is this the
  // savings product" test has to be read in the wording of the bank that
  // printed the label, not of whichever bank happens to be first.
  const matchersFor = alwaysMatchers(profile);
  const keyOf = buildAccountResolver(transactions);
  const primaryFor = findPrimaryAccounts(transactions, keyOf);
  const accounts = new Map();
  for (const tx of transactions) {
    const key = keyOf(tx);
    if (!key) continue;
    const label = accountOf(tx) || key;
    const matchers = matchersFor(tx);
    // Each institution has its own everyday account; see findPrimaryAccounts.
    const primary = primaryFor(tx);
    const account = accounts.get(key) || {
      id: key,
      name: label,
      // One account answers to several names across document types; the labels
      // are kept so the UI can show what the bank actually printed.
      labels: new Set(),
      holder: accountHolderOf(tx),
      kind: matchers.savingsAccount.test(label) ? 'savings' : key === primary ? 'current' : 'secondary',
      primary: key === primary,
      source: tx.source || null,
      transactions: 0,
      firstDate: null,
      lastDate: null,
      lastBalance: null,
      lastBalanceDate: null,
    };
    const date = dateOf(tx);
    account.labels.add(label);
    account.transactions++;
    if (!account.holder) account.holder = accountHolderOf(tx);
    if (!account.firstDate || date < account.firstDate) account.firstDate = date;
    if (!account.lastDate || date > account.lastDate) account.lastDate = date;

    // The statement's own running balance, from the latest row that carried one.
    const balance = tx.balance ?? tx.raw?.payload?.balance ?? null;
    if (balance != null && (!account.lastBalanceDate || date >= account.lastBalanceDate)) {
      account.lastBalance = balance;
      account.lastBalanceDate = date;
    }
    accounts.set(key, account);
  }
  for (const account of accounts.values()) {
    account.labels = [...account.labels];
    // A savings account is still savings even when it happens to be busiest —
    // read, again, in the wording of the institution that named it.
    const matchers = matchersFor({ source: account.source });
    if (account.kind !== 'savings' && account.labels.some((l) => matchers.savingsAccount.test(l))) {
      account.kind = 'savings';
    }
  }
  return [...accounts.values()].sort((a, b) => b.transactions - a.transactions);
}

/**
 * Cash taken out at an ATM — spending, not a move between my own accounts.
 *
 * Accepts any of three things, because all three call sites are legitimate:
 * a raw profile (compiled here — fine for the odd lookup), already-compiled
 * matchers from `compileProfile` (what a hot loop over the whole ledger should
 * pass, so the regexes are built once rather than once per row), or a resolver
 * from `compileProfiles` (which picks the right institution per row).
 */
export function isCashWithdrawal(tx, profile = DEFAULT_PROFILE) {
  const matchers =
    typeof profile === 'function'
      ? profile(tx)
      : profile?.cashWithdrawal instanceof RegExp
        ? profile
        : profile === DEFAULT_PROFILE
          ? DEFAULT_MATCHERS
          : compileProfile(profile);
  return matchers.cashWithdrawal.test(String(tx.description || '').trim());
}

/**
 * Checks the computed vault split against what the savings statement says.
 *
 * The statement's running balance is the bank's own arithmetic and is simply
 * true. The per-vault split is derived, and can only account for movements that
 * were actually ingested — not the balance the account already held before the
 * first statement, nor the interest it earns. Rather than bend the split until
 * it matches, the remainder is reported under its own name.
 */
export function reconcileVaults(accounts, vaults, transactions = [], { internalIds = new Set() } = {}) {
  const savings = accounts.find((a) => a.kind === 'savings');
  if (!savings || savings.lastBalance == null) return null;

  const keyOf = buildAccountResolver(transactions);
  const computed = round(vaults.reduce((sum, v) => sum + v.balance, 0));
  // Whatever the savings account did on its own: interest credited, tax
  // withheld. Anything that is one leg of a transfer is already in `computed`.
  const interest = round(
    transactions
      .filter((tx) => keyOf(tx) === savings.id && !internalIds.has(tx.id))
      .reduce((sum, tx) => sum + amountOf(tx), 0)
  );

  return {
    statementBalance: savings.lastBalance,
    statementDate: savings.lastBalanceDate,
    computed,
    interest,
    // Money the savings account held before the earliest statement we have.
    unaccounted: round(savings.lastBalance - computed - interest),
    balanced: Math.abs(savings.lastBalance - computed - interest) < 0.005,
  };
}

/** Everything the projections need, computed in one pass. */
export function analyzeAccounts(
  transactions,
  { selfNames = [], windowDays = 3, vaultAliases = {}, profile = DEFAULT_PROFILE, profiles = null } = {}
) {
  // `profiles` maps a source — a module instance id — to that institution's
  // wording. `profile` remains the single-institution form, and is also the
  // fallback for a source `profiles` says nothing about.
  const matchersFor = profiles ? compileProfiles(profiles, profile) : alwaysMatchers(profile);

  const { movements, internalIds, redundantIds, primaryAccount } = matchInternalTransfers(
    transactions,
    { selfNames, windowDays, profile: matchersFor }
  );
  const { vaults, total, needsAttribution } = computeVaultBalances(movements, {
    aliases: vaultAliases,
  });
  const accounts = deriveAccounts(transactions, matchersFor);
  return {
    accounts,
    reconciliation: reconcileVaults(accounts, vaults, transactions, { internalIds }),
    primaryAccount,
    movements,
    internalIds,
    redundantIds,
    vaults,
    vaultTotal: total,
    needsAttribution,
    singleEntry: movements.filter((m) => m.singleEntry).length,
  };
}
