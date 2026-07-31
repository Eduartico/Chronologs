/**
 * Routes an ActivoBank PDF to the parser for its document type.
 *
 * The mailbox carries far more than statements — contracts, price lists,
 * insurance policies, DMIF questionnaires — so an unrecognised PDF is a normal
 * outcome and yields zero transactions rather than an error.
 */
import { extractRows } from './pdfText.js';
import { parseNotaRows } from './nota.js';
import { parseExtratoRows } from './extrato.js';

const NOTA = /Nota\s+de\s+Lan[çc]amento/i;
const EXTRATO = /EXTRATO\s+COMBINADO|EXTRATO\s+DE\s+\d{4}\//i;
const STATEMENT_TABLE = /DESCRITIVO[\s\S]{0,40}D[ÉE]BITO[\s\S]{0,40}CR[ÉE]DITO/i;

export function detectDocumentKind(text) {
  if (NOTA.test(text)) return 'nota';
  if (EXTRATO.test(text) || STATEMENT_TABLE.test(text)) return 'extrato';
  return 'other';
}

export async function parsePdf(buffer) {
  const { pages, text } = await extractRows(buffer);
  const kind = detectDocumentKind(text);

  if (kind === 'nota') {
    const { transactions, unparsedLines } = parseNotaRows(pages);
    return { transactions: transactions.map((t) => ({ ...t, kind })), unparsedLines, kind };
  }

  if (kind === 'extrato') {
    const { transactions, unparsedLines } = parseExtratoRows(pages);
    return { transactions: transactions.map((t) => ({ ...t, kind })), unparsedLines, kind };
  }

  return { transactions: [], unparsedLines: [], kind };
}
