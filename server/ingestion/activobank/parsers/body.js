/**
 * Parses ActivoBank transaction listings embedded in email bodies.
 * Two known formats:
 *  1. Block format:   "Data: YYYY-MM-DD\nDescricao: ...\nDebito: 45,30 EUR"
 *  2. Compact format: "DD/MM DESCRIPTION -45,30 EUR"
 *
 * Most ActivoBank mail is not transactional at all — statement-available
 * notices, marketing, contract copies. Those legitimately yield nothing, so
 * unparsed lines are only reported for bodies that actually look like a
 * movement listing; otherwise every newsletter would raise a warning.
 *
 * Returns { transactions: [{date, description, amount}], unparsedLines: [] }.
 */
import { parseAmountPT } from '../normalize.js';

const datePattern = /Data:\s*(\d{4}-\d{2}-\d{2})/;
const descPattern = /Descricao:\s*(.+)/i;
const debitPattern = /Debito:\s*([\d.,]+)\s*EUR/i;
const creditPattern = /Credito:\s*([\d.,]+)\s*EUR/i;
const compactPattern = /^(\d{2}\/\d{2})(?:\/(\d{4}))?\s+(.+?)\s+([+-])([\d.,]+)\s*EUR/;

// A body only counts as a movement listing if it carries these markers.
const TRANSACTIONAL = /(Data:\s*\d{4}-\d{2}-\d{2})|(D[ée]bito:\s*[\d.,]+\s*EUR)|(Cr[ée]dito:\s*[\d.,]+\s*EUR)|^\d{2}\/\d{2}\s+.+[+-][\d.,]+\s*EUR/im;

export function isTransactionalBody(body) {
  return TRANSACTIONAL.test(body || '');
}

export function parseBody(body, emailDate = null) {
  const transactions = [];
  const unparsedLines = [];
  const lines = body.split('\n');
  // Compact lines carry no year — infer it from the email's own date.
  const fallbackYear = emailDate
    ? String(new Date(emailDate).getFullYear())
    : String(new Date().getFullYear());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    const dateMatch = line.match(datePattern);
    if (dateMatch && i + 2 < lines.length) {
      const descMatch = lines[i + 1].trim().match(descPattern);
      const amtLine = lines[i + 2].trim();
      const debitMatch = amtLine.match(debitPattern);
      const creditMatch = amtLine.match(creditPattern);

      if (descMatch && (debitMatch || creditMatch)) {
        const amount = debitMatch
          ? -parseAmountPT(debitMatch[1])
          : parseAmountPT(creditMatch[1]);
        transactions.push({
          date: dateMatch[1],
          description: descMatch[1].trim(),
          amount,
          kind: 'body',
        });
        i += 3;
        continue;
      }
    }

    const compactMatch = line.match(compactPattern);
    if (compactMatch) {
      const [, dayMonth, year, desc, sign, amt] = compactMatch;
      const [d, m] = dayMonth.split('/');
      const date = `${year || fallbackYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      transactions.push({
        date,
        description: desc.trim(),
        amount: sign === '-' ? -parseAmountPT(amt) : parseAmountPT(amt),
        kind: 'body',
      });
      i++;
      continue;
    }

    unparsedLines.push(line);
    i++;
  }

  // Nothing transactional in sight: this is an ordinary email, not a failure.
  if (!isTransactionalBody(body)) {
    return { transactions, unparsedLines: [], kind: 'other' };
  }

  return { transactions, unparsedLines, kind: 'body' };
}
