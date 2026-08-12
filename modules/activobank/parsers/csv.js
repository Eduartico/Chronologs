/**
 * Parses CSV/TSV exports of ActivoBank movements. Header names are matched
 * case- and diacritic-insensitively: data, descricao/descrição/movimento,
 * montante/valor/importancia, or separate debito + credito columns.
 * Returns { transactions, unparsedLines }.
 */
import { parse } from 'csv-parse/sync';
import { parseAmountPT } from '../normalize.js';

function normalizeHeader(h) {
  return String(h)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function findColumn(headers, candidates) {
  return headers.findIndex((h) => candidates.some((c) => h.includes(c)));
}

function toIsoDate(str) {
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function parseCsv(input) {
  const content = Buffer.isBuffer(input) ? input.toString('utf-8') : input;
  const delimiter = content.split('\n')[0]?.includes(';') ? ';' : ',';

  let records;
  try {
    records = parse(content, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return { transactions: [], unparsedLines: [`CSV parse error: ${err.message}`] };
  }

  if (records.length === 0) return { transactions: [], unparsedLines: [] };

  const headers = records[0].map(normalizeHeader);
  const dateCol = findColumn(headers, ['data']);
  const descCol = findColumn(headers, ['descricao', 'movimento', 'description']);
  const amountCol = findColumn(headers, ['montante', 'valor', 'importancia', 'amount']);
  const debitCol = findColumn(headers, ['debito']);
  const creditCol = findColumn(headers, ['credito']);

  if (dateCol === -1 || descCol === -1 || (amountCol === -1 && debitCol === -1)) {
    return {
      transactions: [],
      unparsedLines: [`Unrecognized CSV header: ${records[0].join(delimiter)}`],
    };
  }

  const transactions = [];
  const unparsedLines = [];

  for (const row of records.slice(1)) {
    const date = toIsoDate(row[dateCol]);
    const description = (row[descCol] || '').trim();
    let amount = null;

    if (amountCol !== -1 && row[amountCol]) {
      amount = parseAmountPT(row[amountCol]);
    } else {
      const debit = debitCol !== -1 && row[debitCol] ? parseAmountPT(row[debitCol]) : null;
      const credit = creditCol !== -1 && row[creditCol] ? parseAmountPT(row[creditCol]) : null;
      if (Number.isFinite(debit) && debit !== 0) amount = -Math.abs(debit);
      else if (Number.isFinite(credit)) amount = Math.abs(credit);
    }

    if (date && description && Number.isFinite(amount)) {
      transactions.push({ date, description, amount });
    } else if (row.join('').trim()) {
      unparsedLines.push(row.join(delimiter));
    }
  }

  return { transactions, unparsedLines };
}
