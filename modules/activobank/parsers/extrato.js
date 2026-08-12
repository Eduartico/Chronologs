/**
 * Parses ActivoBank "EXTRATO COMBINADO" monthly statements.
 *
 * Layout (one row per movement):
 *   DATA   DATA
 *   LANC.  VALOR   DESCRITIVO                    DEBITO   CREDITO   SALDO
 *   10.01  10.01   COMPRA 0412 CONTINENTE ...      0.85            1 814.70
 *   10.10  10.10   TRF. P/O CATIA ...                       5.00     843.09
 *
 * Three things make this format tricky:
 *  1. The sign is carried by the *column*, never by the number, so amounts are
 *     classified by their right-aligned x position against the column headers.
 *  2. Dates are MM.DD (month first) and carry no year — the year comes from the
 *     "EXTRATO DE yyyy/mm/dd A yyyy/mm/dd" period line above the table. Note a
 *     small amount like "0.85" is indistinguishable from a date by shape alone,
 *     which is why the date cells are located by position, not by pattern.
 *  3. Long descriptions are printed on the row *above* their amounts.
 */
import { parseAmountPT } from '../normalize.js';
import { rightEdgeOf, leftEdgeOf } from './pdfText.js';

const PERIOD = /EXTRATO\s+DE\s+(\d{4})\/(\d{2})\/(\d{2})\s+A\s+(\d{4})\/(\d{2})\/(\d{2})/i;
// A combined statement holds one table per account. The account header appears
// either as "CONTA SIMPLES N. 45600427404 MOEDA: EUR" or just
// "CONTA POUPEUP MOEDA: EUR"; the bare "CONTA SIMPLES 2 316.44" line in the
// summary block must not match.
// The account number is what identifies the account across document types: an
// advice note calls the same account "Conta Depósitos à Ordem" where the
// statement calls it "CONTA SIMPLES".
const ACCOUNT = /\b(CONTA\s+[A-Za-zÀ-Ü][A-Za-zÀ-ÿ0-9 ]*?)\s+(?:N\.?\s*(\d{6,})\s+)?MOEDA\b/i;
// Booking date then value date, both MM.DD, at the very start of the row.
const ROW_DATES = /^\s*(\d{1,2})\.(\d{2})\s+(\d{1,2})\.(\d{2})(?=\s|$)/;
// Statement amounts use a space or dot as thousands separator: "1 815.55".
// The leading (?<!\d) stops the thousands group from bridging out of a long
// reference number printed just left of the column ("...PRAZO 3091214528
// 100.00" must read 100.00, not 528 100.00).
const AMOUNT_TOKEN = /(?<!\d)\d{1,3}(?:[ .]\d{3})*[.,]\d{2}(?!\d)/g;
// Widest an amount cell can be; anything reaching further left of its column
// has swallowed description text.
const MAX_CELL_WIDTH = 75;
const HEADER_LABELS = /\b(DEBITO|D[ÉE]BITO|CREDITO|CR[ÉE]DITO|SALDO)\b/gi;

const NOISE = [
  /^SALDO\s+(INICIAL|FINAL|DISPONIVEL|ANTERIOR)/i,
  /^A\s+TRANSPORTAR/i,
  /^TRANSPORTE/i,
  /^DATA\b/i,
  /^LANC\.?\s*VALOR/i,
  /^DESCRITIVO/i,
  /EXT\.?\s*N\.?\s*\d/i,
  /^PAG:/i,
  /ULTRAPASSAGEM\s+CREDITO/i,
  /^\d{2}\/\d{2}\/\d{2}\b/,
];

function isNoise(text) {
  const t = text.trim();
  return NOISE.some((r) => r.test(t));
}

/**
 * Learns the DEBITO / CREDITO / SALDO column positions from a header row so
 * amounts can be attributed to a column instead of guessing from the sign.
 * Matching happens on the row text, since older statements split the headers
 * into fragments like "DE" + "BITO".
 */
function readColumns(row) {
  const cols = {};
  HEADER_LABELS.lastIndex = 0;
  let m;
  while ((m = HEADER_LABELS.exec(row.text)) !== null) {
    const edge = rightEdgeOf(row, m.index, m.index + m[0].length);
    if (edge == null) continue;
    const label = m[0].toUpperCase();
    if (label.startsWith('D')) cols.debit = edge;
    else if (label.startsWith('C')) cols.credit = edge;
    else cols.balance = edge;
  }
  return cols.debit != null && cols.credit != null ? cols : null;
}

function classify(edge, cols) {
  const candidates = [
    ['debit', cols.debit],
    ['credit', cols.credit],
    ['balance', cols.balance],
  ].filter(([, v]) => v != null);

  let best = null;
  let bestDist = Infinity;
  for (const [name, pos] of candidates) {
    const dist = Math.abs(edge - pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  // Anything more than a column-width away is not an amount cell at all.
  return bestDist <= 45 ? best : null;
}

function resolveYear(month, period) {
  if (!period) return null;
  // A statement may straddle a year boundary (December → January).
  return month >= period.startMonth ? period.startYear : period.endYear;
}

/**
 * Pulls the positioned amounts out of a row and returns the leftover text as
 * the description.
 */
function splitRow(row, cols, fromIndex) {
  const amounts = [];
  const masked = row.text.split('');

  AMOUNT_TOKEN.lastIndex = 0;
  let m;
  while ((m = AMOUNT_TOKEN.exec(row.text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start < fromIndex) continue;
    const edge = rightEdgeOf(row, start, end);
    if (edge == null) continue;
    const column = classify(edge, cols);
    if (!column) continue;
    const left = leftEdgeOf(row, start, end);
    if (left != null && edge - left > MAX_CELL_WIDTH) continue;
    amounts.push({ column, value: parseAmountPT(m[0]), start });
    for (let i = start; i < end; i++) masked[i] = ' ';
  }

  const description = masked.slice(fromIndex).join('').replace(/\s+/g, ' ').trim();
  return { description, amounts };
}

export function parseExtratoRows(pages) {
  const transactions = [];
  const unparsedLines = [];

  let cols = null;
  let period = null;
  let account = null;
  let accountNumber = null;
  let pendingDescription = null;

  for (const page of pages) {
    for (const row of page) {
      const text = row.text;

      const headerCols = readColumns(row);
      if (headerCols) {
        cols = headerCols;
        pendingDescription = null;
        continue;
      }

      const periodMatch = text.match(PERIOD);
      if (periodMatch) {
        period = {
          startYear: Number(periodMatch[1]),
          startMonth: Number(periodMatch[2]),
          endYear: Number(periodMatch[4]),
        };
        pendingDescription = null;
        continue;
      }

      const accountMatch = text.match(ACCOUNT);
      if (accountMatch) {
        account = accountMatch[1].replace(/\s+/g, ' ').trim();
        accountNumber = accountMatch[2] || null;
        pendingDescription = null;
        continue;
      }

      const dates = text.match(ROW_DATES);
      if (!dates) {
        // A description-only line belongs to the movement printed just below.
        const trimmed = text.trim();
        if (cols && trimmed && !isNoise(trimmed) && /[A-Za-zÀ-ÿ]{3}/.test(trimmed)) {
          pendingDescription = trimmed;
        } else {
          pendingDescription = null;
        }
        continue;
      }

      if (!cols) {
        unparsedLines.push(text.trim());
        pendingDescription = null;
        continue;
      }

      const { description, amounts } = splitRow(row, cols, dates[0].length);
      const movement = amounts.filter((a) => a.column !== 'balance');

      const month = Number(dates[1]);
      const day = Number(dates[2]);
      const year = resolveYear(month, period);

      const clean = [pendingDescription, description]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pendingDescription = null;

      if (movement.length === 0) continue;
      if (!year || !clean || isNoise(clean)) {
        unparsedLines.push(text.trim());
        continue;
      }

      const entry = movement[0];
      const balance = amounts.find((a) => a.column === 'balance');
      transactions.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        description: clean,
        amount: entry.column === 'debit' ? -entry.value : entry.value,
        account,
        accountNumber,
        balance: balance ? balance.value : null,
      });
    }
  }

  return { transactions, unparsedLines };
}
