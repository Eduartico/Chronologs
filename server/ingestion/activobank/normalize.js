import { createHash } from 'crypto';

export function extractMerchant(description) {
  if (!description) return '';
  // Common ActivoBank description patterns
  const patterns = [
    /COMPRA\s+\d+\s+(.+)/i,
    /PAG SERV\s+(.+)/i,
    /TRANSF\s+(.+)/i,
    /LEV\s+ATM\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = description.match(p);
    if (m) return m[1].trim();
  }
  return description;
}

// Parses Portuguese-formatted numbers: "1.234,56" -> 1234.56
export function parseAmountPT(str) {
  if (typeof str === 'number') return str;
  const cleaned = String(str).trim().replace(/\s/g, '').replace(/€/g, '');
  if (/,\d{1,2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(cleaned.replace(/,/g, ''));
}

// Deterministic id so re-scans and re-uploads dedupe via the ledger hash.
// `occurrence` distinguishes genuinely repeated rows (same purchase twice in
// one day) within a single document.
export function makeTransactionId(date, amount, description, occurrence = 1) {
  const digest = createHash('sha1')
    .update(`${description}`)
    .digest('hex')
    .slice(0, 8);
  return `activobank-${date}-${amount}-${digest}` + (occurrence > 1 ? `-${occurrence}` : '');
}

/**
 * A statement prints a running balance next to every movement. Two identical
 * rows that also share a balance cannot both be real — the balance must have
 * moved by the amount between them — so that pair is the same row read twice
 * and the second copy is dropped. Two identical rows with *different* balances
 * are two genuine purchases (fifteen €0.01 international-service fees in one
 * month is a real thing that happens), and both are kept.
 *
 * Only applies where a balance was actually parsed; advice notes carry none.
 */
function dropRowsRepeatedAtSameBalance(parsed) {
  const seen = new Set();
  return parsed.filter((t) => {
    if (t.balance == null) return true;
    const key = `${t.date}|${t.amount}|${t.description}|${t.balance}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeTransactions(parsed) {
  const seen = new Map();
  return dropRowsRepeatedAtSameBalance(parsed)
    .filter((t) => t.date && Number.isFinite(t.amount) && t.amount !== 0)
    .map((t) => {
      const key = `${t.date}|${t.amount}|${t.description}`;
      const occurrence = (seen.get(key) || 0) + 1;
      seen.set(key, occurrence);
      const normalized = {
        transaction_id: makeTransactionId(t.date, t.amount, t.description, occurrence),
        date: t.date,
        description: t.description,
        merchant: extractMerchant(t.description),
        amount: t.amount,
        currency: 'EUR',
        source: 'activobank',
        occurrence,
      };
      // Which document type this came from, so statements and advice notes for
      // the same movement can be reconciled instead of double-counted.
      if (t.kind) normalized.document_kind = t.kind;
      if (t.account) normalized.account = t.account;
      // The account *number* is what identifies an account across document
      // types: a statement calls it "CONTA SIMPLES", an advice note calls the
      // same account "Conta Depósitos à Ordem".
      if (t.accountNumber) normalized.account_id = t.accountNumber;
      if (t.accountHolder) normalized.account_holder = t.accountHolder;
      // The running balance is the statement's own arithmetic — it validates
      // computed balances instead of them having to be trusted.
      if (t.balance != null) normalized.balance = t.balance;
      return normalized;
    });
}
