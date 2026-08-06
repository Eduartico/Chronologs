import { replayEvents } from '../ledger/eventStore.js';
import { loadAssets, loadCategories, loadRules } from '../ledger/fileStore.js';
import { analyzeAccounts, deriveSelfNames, isCashWithdrawal, compileProfile } from '../engines/accounts.js';
import { loadSettings } from '../lib/settings.js';

export const INTERNAL_CATEGORY = 'internal transfer';
export const CASH_WITHDRAWAL_CATEGORY = 'cash withdrawal';

export async function buildProjections() {
  const events = await replayEvents();

  // Transaction projections: only 'transaction' events
  const rawTransactions = events.filter((e) => e.type === 'transaction');

  // Build transactions list with category assignments overlaid
  const categoryMap = {};
  const overrides = {};
  const ruleApplications = {};

  const tagsByTransaction = {};
  const removedTagsByTransaction = {};
  const linksByTransaction = {};
  const enrichments = {};
  // Duplicates are retired, never deleted: the transaction event stays in the
  // ledger and a later void event hides it from every total. Replaying in order
  // means the last void/unvoid wins, so a mistaken merge can be undone.
  const voided = {};

  for (const ev of events) {
    if (ev.type === 'category_assignment') {
      const key = ev.payload.event_id;
      // Manual overrides always win, even against assignments that were
      // appended to the ledger after the override.
      if (!(key in overrides)) {
        categoryMap[key] = ev.payload.category;
      }
      if (ev.payload.rule_id) {
        ruleApplications[key] = ev.payload.rule_id;
      }
    }
    if (ev.type === 'manual_override') {
      overrides[ev.payload.event_id] = {
        original: ev.payload.original_category,
        new: ev.payload.new_category,
      };
      categoryMap[ev.payload.event_id] = ev.payload.new_category;
    }
    if (ev.type === 'tag_assignment') {
      const txId = ev.payload.transaction_id;
      const set = (tagsByTransaction[txId] ||= new Set());
      set.add(ev.payload.tag_id);
      removedTagsByTransaction[txId]?.delete(ev.payload.tag_id);
    }
    if (ev.type === 'tag_removal') {
      const txId = ev.payload.transaction_id;
      tagsByTransaction[txId]?.delete(ev.payload.tag_id);
      if (ev.source === 'manual') {
        // Manually removed tags are blocked from rule re-application.
        (removedTagsByTransaction[txId] ||= new Set()).add(ev.payload.tag_id);
      }
    }
    if (ev.type === 'transaction_void') {
      voided[ev.payload.event_id] = {
        reason: ev.payload.reason || 'duplicate',
        duplicateOf: ev.payload.duplicate_of || null,
        at: ev.payload.at || ev.timestamp,
      };
    }
    if (ev.type === 'transaction_unvoid') {
      delete voided[ev.payload.event_id];
    }
    // Account identity learned after the fact — see engines/enrichAccounts.js.
    if (ev.type === 'transaction_enrichment') {
      const id = ev.payload.transaction_id;
      if (id) enrichments[id] = { ...enrichments[id], ...ev.payload };
    }
    if (ev.type === 'transaction_link') {
      for (const txId of ev.payload.transaction_ids || []) {
        (linksByTransaction[txId] ||= []).push({
          linkId: ev.payload.link_id,
          ruleId: ev.payload.rule_id || null,
          transactionIds: ev.payload.transaction_ids,
          note: ev.payload.note || null,
        });
      }
    }
  }

  // One row per *transaction*, not per event.
  //
  // The ledger is append-only and deduplicates on the content hash, which is not
  // the same thing as deduplicating on identity: re-ingesting a statement that
  // was already read from Gmail produces a second `transaction` event with the
  // same stable id but a different `linked_entities` document, so the hash
  // differs and both are kept. Mapping events straight to rows then emitted the
  // same movement twice — 35 times over in the real ledger, which is what
  // surfaced as false duplicates, an unresolvable "keep only this one", and
  // €340 of phantom money in the savings vaults.
  //
  // The first event for an id wins, so provenance stays with the original
  // ingestion. Later events only fill in fields the first one left empty, which
  // lets a re-upload parsed by a better parser contribute what it knows without
  // duplicating anything.
  const eventsById = new Map();
  for (const ev of rawTransactions) {
    const stableId = ev.payload.transaction_id || ev.id;
    const bucket = eventsById.get(stableId);
    if (bucket) bucket.push(ev);
    else eventsById.set(stableId, [ev]);
  }

  const allTransactions = [...eventsById.entries()].map(([stableId, evs]) => {
    const ev = evs[0];
    // The first non-null value across every event that described this movement.
    const declared = (field) => {
      for (const e of evs) {
        const value = e.payload[field];
        if (value != null) return value;
      }
      return null;
    };
    // Older ledger events keyed assignments by the event uuid instead of the
    // stable transaction id — honor both, and honor every event uuid this
    // movement was ever written under, so a decision taken against the
    // re-ingested copy is not lost when the copies are folded together.
    const byAnyId = (map) => {
      if (stableId in map) return map[stableId];
      for (const e of evs) if (e.id in map) return map[e.id];
      return undefined;
    };
    const category = byAnyId(categoryMap);
    const override = byAnyId(overrides);
    const void_ = byAnyId(voided);
    const learned = byAnyId(enrichments) || {};
    return {
      // What the document said this movement belongs to. Read at ingestion when
      // the parser knew how, backfilled from the stored originals when it did not.
      account: declared('account') ?? learned.account ?? null,
      accountId: declared('account_id') ?? learned.account_id ?? null,
      accountHolder: declared('account_holder') ?? learned.account_holder ?? null,
      balance: declared('balance') ?? learned.balance ?? null,
      voided: !!void_,
      voidReason: void_?.reason || null,
      duplicateOf: void_?.duplicateOf || null,
      id: stableId,
      eventId: ev.id,
      // Every event that described this same movement. More than one means the
      // document was ingested twice — worth showing, never worth counting twice.
      sourceEventIds: evs.map((e) => e.id),
      date: ev.payload.date || ev.timestamp,
      description: ev.payload.description || '',
      merchant: ev.payload.merchant || '',
      amount: ev.payload.amount,
      currency: ev.payload.currency || 'EUR',
      category: category || 'uncategorized',
      source: ev.source,
      status: override ? 'overridden' : category ? 'categorized' : 'pending',
      overridden: !!override,
      originalCategory: override?.original || null,
      amortize: ev.payload.amortize || null,
      tags: [...(tagsByTransaction[stableId] || [])],
      removedTags: [...(removedTagsByTransaction[stableId] || [])],
      links: linksByTransaction[stableId] || [],
      raw: ev,
    };
  });

  // Everything downstream — totals, charts, the review queue — reads
  // `transactions`, which excludes voided rows. `voidedTransactions` stays
  // available so the duplicates screen can list and undo them.
  const transactions = allTransactions.filter((t) => !t.voided);
  const voidedTransactions = allTransactions.filter((t) => t.voided);

  // Money moved between the owner's own accounts, and cash taken out at an ATM,
  // are recognised from the movement itself rather than categorised by hand.
  //
  // Both legs of an internal move are marked, which is the whole point: the
  // bank books the same transfer once on each account, and counting either of
  // them as spending is what made October 2025 read €3.333 heavier than it was.
  // The system category wins over older hand-made assignments — those were made
  // before the app understood what these rows are.
  const settings = loadSettings();
  const selfNames = [...new Set([...deriveSelfNames(transactions), ...(settings.internal?.selfNames || [])])];
  const accountAnalysis = analyzeAccounts(transactions, {
    selfNames,
    windowDays: settings.internal?.windowDays ?? 3,
    vaultAliases: settings.internal?.vaultAliases || {},
    profile: settings.internal?.profile,
  });
  // Compiled once, outside the per-transaction loop below — `isCashWithdrawal`
  // accepts either a raw profile or these already-compiled matchers, and a
  // hot loop over the whole ledger is exactly the case that should never
  // recompile the same five regexes on every row.
  const institutionMatchers = compileProfile(settings.internal?.profile);

  for (const tx of transactions) {
    if (accountAnalysis.internalIds.has(tx.id)) {
      tx.internal = true;
      tx.redundant = accountAnalysis.redundantIds.has(tx.id);
      tx.category = INTERNAL_CATEGORY;
      tx.status = 'categorized';
      tx.systemCategorized = true;
    } else if (isCashWithdrawal(tx, institutionMatchers)) {
      tx.category = CASH_WITHDRAWAL_CATEGORY;
      tx.status = 'categorized';
      tx.systemCategorized = true;
    }
    // Analytics read the category map rather than the row, so the system's
    // verdict has to land there too — otherwise an old hand-made assignment
    // ("in-account movements") would keep winning inside every chart.
    if (tx.systemCategorized) categoryMap[tx.id] = tx.category;
  }

  // What every spending figure should be computed over. Internal movements are
  // not income and not expense; they are the same euros changing pocket.
  const spendingTransactions = transactions.filter((t) => !t.internal);

  // Investment transactions are projected separately from bank transactions on
  // purpose: they need no categorizing, and mixing them in would bury the
  // pending-review queue under a few hundred skin trades.
  const investments = events
    .filter((e) => e.type === 'investment_transaction')
    .map((ev) => ({
      id: ev.payload.investment_transaction_id || ev.id,
      date: ev.payload.date,
      name: ev.payload.name,
      type: ev.payload.type,
      quantity: ev.payload.quantity,
      unitPrice: ev.payload.unit_price,
      totalPrice: ev.payload.total_price,
      feeAmount: ev.payload.fee_amount || 0,
      feePercentage: ev.payload.fee_percentage || 0,
      marketplace: ev.payload.marketplace,
      note: ev.payload.note,
      floatValue: ev.payload.float_value,
      paintSeed: ev.payload.paint_seed,
      steamAssetId: ev.payload.steam_asset_id,
      currency: ev.payload.currency || 'USD',
      source: ev.source,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Exchange order receipts. Kept apart from both bank transactions and CS2
  // trades: they carry no money movement of their own — the statement debit
  // they are linked to is where the euros are.
  const securityOrders = events
    .filter((e) => e.type === 'security_order')
    .map((ev) => ({
      security_order_id: ev.payload.security_order_id || ev.id,
      date: ev.payload.date,
      side: ev.payload.side || 'buy',
      security: ev.payload.security,
      market: ev.payload.market || null,
      quantity: Number(ev.payload.quantity) || 0,
      price: ev.payload.price ?? null,
      quote: ev.payload.quote ?? null,
      currency: ev.payload.currency || 'EUR',
      executed: ev.payload.executed !== false,
      source: ev.source,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Asset snapshots from events
  const snapshotEvents = events.filter((e) => e.type === 'asset_snapshot');
  const assetSnapshots = snapshotEvents.map((ev) => ({
    date: ev.payload.date || ev.timestamp.slice(0, 10),
    provider: ev.payload.provider || ev.source,
    items: ev.payload.items || ev.payload.assets || [],
    raw: ev,
  }));

  // Price updates
  const priceEvents = events.filter((e) => e.type === 'price_update');
  const priceMap = {};
  for (const ev of priceEvents) {
    const symbol = ev.payload.symbol || ev.payload.ticker || ev.payload.name;
    if (symbol) priceMap[symbol] = ev.payload;
  }

  // Assets from assets.json plus price updates
  const storedAssets = loadAssets();
  const assets = storedAssets.map((a) => {
    const price = priceMap[a.symbol || a.name];
    const currentValue = price ? price.price * (a.quantity || 1) : a.currentValue || a.value || 0;
    return {
      ...a,
      currentValue,
      lastPrice: price?.price || a.lastPrice,
      lastPriceDate: price?.timestamp || a.lastPriceDate,
    };
  });

  return {
    events,
    transactions,
    spendingTransactions,
    voidedTransactions,
    accounts: accountAnalysis.accounts,
    vaults: accountAnalysis.vaults,
    vaultTotal: accountAnalysis.vaultTotal,
    vaultsNeedAttribution: accountAnalysis.needsAttribution,
    vaultReconciliation: accountAnalysis.reconciliation,
    internalMovements: accountAnalysis.movements,
    accountHolders: selfNames,
    investments,
    securityOrders,
    categoryMap,
    overrides,
    assetSnapshots,
    assets,
    priceEvents,
    priceMap,
    tagsByTransaction,
    linksByTransaction,
  };
}