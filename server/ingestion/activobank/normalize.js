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

export function normalizeTransactions(parsed) {
  const seen = new Map();
  return parsed
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
      return normalized;
    });
}
