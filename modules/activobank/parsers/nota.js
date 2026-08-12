/**
 * Parses ActivoBank "Nota de Lançamento" advice notes — one per movement, sent
 * as a PDF attachment. These are the bank's most precise record: exact amount,
 * exact date and the same descriptive text that later shows up on the monthly
 * statement.
 *
 * A single PDF may bundle several notes, so the text is split on each
 * "Nota de Lançamento" heading.
 *
 * Two layouts exist:
 *
 *  a) Labelled form (the common one, ~2020 onward)
 *       Operação: PAGAMENTO DE SERVICOS
 *       Montante Debitado 10,00 EUR
 *       Descritivo do Movimento PAG. 910030681 - VODAFONE
 *       Data do Movimento 2020/05/05
 *
 *  b) Foreign payment order (ORDEM DE PAGAMENTO SOBRE O ESTRANGEIRO)
 *       ASSUNTO : ORDEM DE PAGAMENTO SOBRE O ESTRANGEIRO - EMISSAO
 *       BENEFICIARIO : Binance
 *       TOTAL DEBITADO EUR 20,00
 *       DATA VALOR 2021/04/22
 *
 * Labels carry their value either inline or on the following line, so every
 * lookup falls back to the next non-empty line.
 */
import { parseAmountPT } from '../normalize.js';

const NOTE_HEADING = /^Nota\s+de\s+Lan[çc]amento\b/i;

// Most notes use the Portuguese "1.234,56"; the foreign-payment layout uses
// "20.00" instead, so both decimal separators have to be accepted.
const AMOUNT_WITH_CURRENCY = /(?:EUR\s*)?(-?\d{1,3}(?:[. ]\d{3})*[,.]\d{2})(?:\s*EUR)?/i;
const ISO_DATE = /(\d{4})[/-](\d{2})[/-](\d{2})/;
const PT_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/;

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const LETTER_DATE = new RegExp(`(\\d{1,2})\\s+de\\s+(${MONTHS_PT.join('|')})\\s+de\\s+(\\d{4})`, 'i');

function toIso(text) {
  if (!text) return null;
  const iso = text.match(ISO_DATE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pt = text.match(PT_DATE);
  if (pt) return `${pt[3]}-${pt[2]}-${pt[1]}`;
  const letters = text.match(LETTER_DATE);
  if (letters) {
    const month = MONTHS_PT.indexOf(letters[2].toLowerCase()) + 1;
    return `${letters[3]}-${String(month).padStart(2, '0')}-${letters[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Finds a labelled field. Returns the text that follows the label on the same
 * line, or the next non-empty line when the label sits alone.
 */
function field(lines, labelRegex) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRegex);
    if (!m) continue;
    const inline = lines[i].slice(m.index + m[0].length).replace(/^[\s:.-]+/, '').trim();
    if (inline) return inline;
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const next = lines[j].trim();
      if (next) return next;
    }
  }
  return null;
}

function amountFrom(text) {
  if (!text) return null;
  const m = text.match(AMOUNT_WITH_CURRENCY);
  if (!m) return null;
  const value = parseAmountPT(m[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Tries each amount label in turn and keeps the first that yields a number.
 * Matching on the label alone is not enough: "Total Débito (DB)/Crédito (CR)"
 * is a column heading, not a value.
 */
function amountFromLabels(lines, labels) {
  for (const label of labels) {
    const value = amountFrom(field(lines, label));
    if (value != null && value !== 0) return value;
  }
  return null;
}

// Field values that are never a movement descriptor.
const NOT_A_DESCRIPTOR =
  /^(IBAN|Institui[çc]|Ordenante|Nome do|Banco|Detalhes|Dados da|Tipo de|Data\b|Montante|Total|Nossa Ref|N\/Ref|C[âa]mbio|Descritivo)/i;
// How ActivoBank movement descriptors actually start.
const DESCRIPTOR_SHAPE =
  /^(TRF|PAG|COMPRA|DD\b|LEV|DEVOLU|CONSTIT|LIQ|JUROS|IMPOSTO|TRANSF|MB WAY|CUSTO)/i;

/**
 * The descriptor sits in the right-hand column of a two-column form, which
 * places it on the line *before* its label as often as after it.
 */
function descriptorField(lines, labels) {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(label);
      if (!m) continue;

      const inline = lines[i].slice(m.index + m[0].length).replace(/^[\s:.-]+/, '').trim();
      if (inline) return inline;

      const prev = lines.slice(0, i).reverse().find((l) => l.trim());
      const next = lines.slice(i + 1).find((l) => l.trim());
      const candidates = [prev, next].filter((c) => c && !NOT_A_DESCRIPTOR.test(c.trim()));

      const shaped = candidates.find((c) => DESCRIPTOR_SHAPE.test(c.trim()));
      if (shaped) return shaped.trim();
      if (candidates.length) return candidates[0].trim();
    }
  }
  return null;
}

/**
 * Works out the sign. ActivoBank always states the direction in words, either
 * on the amount label itself ("Montante Debitado") or on the operation type
 * ("TRANSFERÊNCIA PONTUAL A DÉBITO").
 */
function directionOf(lines) {
  const text = lines.join('\n');
  // The foreign-payment layout states the direction as a DB/CR suffix on the
  // posted total: "Total a movimentar 20.00 DB".
  const movimentar = field(lines, /\bTotal\s+a\s+movimentar\b/i);
  if (movimentar && /\bDB\b/.test(movimentar)) return -1;
  if (movimentar && /\bCR\b/.test(movimentar)) return 1;
  if (/\bTotal\s+Debitado\b/i.test(text) || /\bTOTAL\s+DEBITADO\b/.test(text)) return -1;
  if (/\bTotal\s+Creditado\b/i.test(text) || /\bTOTAL\s+CREDITADO\b/.test(text)) return 1;
  if (/\bMontante\s+Debitado\b/i.test(text)) return -1;
  if (/\bMontante\s+Creditado\b/i.test(text)) return 1;
  if (/\bA\s+D[ÉE]BITO\b/i.test(text)) return -1;
  if (/\bA\s+CR[ÉE]DITO\b/i.test(text)) return 1;
  if (/\bRecebida\b/i.test(text)) return 1;
  if (/\bDEVOLU[ÇC][ÃA]O\b/i.test(text)) return 1;
  if (/\bEmiss[ãa]o\b/i.test(text)) return -1;
  return -1; // Advice notes overwhelmingly report debits.
}

/**
 * The letterhead identifies the account the note belongs to.
 *
 * An advice note is always about one account, named in a fixed block at the top:
 *
 *   Conta Depósitos à Ordem nº: 45600427404
 *   Moeda da Conta: EUR
 *   EDUARDO DUARTE SILVA          <- the holder, always just above the IBAN
 *   IBAN: PT50002300004560042740494
 *
 * The number matters because it is the only thing that ties this note to the
 * same account on a statement, which calls it "CONTA SIMPLES" instead. The
 * holder matters because the *other* account's statement describes transfers to
 * here as going to that name.
 */
export function parseNoteAccount(lines) {
  const label = /\bConta\s+Dep[oó]sitos\s+[aà]\s+Ordem\s*(?:n[ºo°]?\s*:?)?/i;
  let name = null;
  let number = null;

  for (const line of lines) {
    const m = line.match(label);
    if (!m) continue;
    name = 'Conta Depósitos à Ordem';
    const digits = line.slice(m.index + m[0].length).match(/(\d{6,})/);
    if (digits) number = digits[1];
    if (number) break;
  }

  const ibanIndex = lines.findIndex((l) => /^IBAN\s*:/i.test(l.trim()));
  const holder =
    ibanIndex > 0 ? lines.slice(0, ibanIndex).reverse().find((l) => l.trim())?.trim() || null : null;

  if (!number && ibanIndex >= 0) {
    // PT IBANs end with the account number and two check digits.
    const iban = lines[ibanIndex].replace(/\s+/g, '');
    const m = iban.match(/PT50\d{8}(\d{11})\d{2}/);
    if (m) number = String(Number(m[1]));
  }

  return name || number || holder ? { name, number, holder } : null;
}

function parseNote(lines) {
  const operation =
    field(lines, /Opera[çc][ãa]o\s*:/i) || field(lines, /ASSUNTO\s*:/i) || null;

  // Prefer the total actually posted to the account over the gross amount,
  // since the total already includes any fees or FX spread.
  const magnitude = amountFromLabels(lines, [
    /\bTotal\s+(?:Debitado|Creditado)\b/i,
    /\bTotal\s+a\s+movimentar\b/i,
    /\bTotal\s+d[ao]\s+opera[çc][ãa]o\b/i,
    /\bMontante\s+(?:Debitado|Creditado)\b/i,
    /\bCONTRAVALOR\b/i,
    /\bMontante\s+da\s+Transfer[êe]ncia\b/i,
    /\bMontante\s+Origem\b/i,
    /\bMontante\b/i,
  ]);
  if (magnitude == null) return null;

  const dateText =
    field(lines, /\bData\s+do\s+Movimento\b/i) ||
    field(lines, /\bData\s+Valor\s+da\s+Opera[çc][ãa]o\b/i) ||
    field(lines, /\bDATA\s+VALOR\b/i) ||
    field(lines, /\bData\s+valor\b/i);

  const date =
    toIso(dateText) ||
    // Fall back to the letterhead date ("Lisboa, 5 de maio de 2020").
    toIso(lines.find((l) => LETTER_DATE.test(l)) || '');
  if (!date) return null;

  const descriptor = descriptorField(lines, [
    /\bDescritivo\s+do\s+Movimento\b/i,
    /\bDescritivo\s+da\s+Transfer[êe]ncia\s+na\s+Conta(?:\s+a\s+Debitar)?\b/i,
    /\bDescritivo\b/i,
  ]);

  const beneficiary = field(lines, /\bBENEFICIARIO\b\s*:/i);

  const description =
    [descriptor, !descriptor ? operation : null, !descriptor ? beneficiary : null]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || operation || 'Movimento ActivoBank';

  return {
    date,
    description,
    amount: directionOf(lines) * Math.abs(magnitude),
    operation: operation || null,
  };
}

/**
 * Splits the document text into one block per advice note.
 *
 * A PDF that carries the same note on two pages — the bank's own duplicate
 * copy, which several of these attachments contain — would otherwise be read as
 * two separate movements. Blocks with identical content are collapsed; a PDF
 * genuinely bundling two different notes still yields two blocks, because their
 * text differs.
 */
function splitNotes(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (NOTE_HEADING.test(line.trim())) {
      if (current && current.length) blocks.push(current);
      current = [];
    }
    if (current) current.push(line);
  }
  if (current && current.length) blocks.push(current);

  const seen = new Set();
  return blocks.filter((block) => {
    const fingerprint = block.join('\n').replace(/\s+/g, ' ').trim();
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function parseNotaText(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const blocks = splitNotes(lines);
  const transactions = [];
  const unparsedLines = [];
  // Every note in one PDF shares a letterhead, so the account is read once.
  const account = parseNoteAccount(lines);

  for (const block of blocks.length ? blocks : [lines]) {
    const note = parseNote(block);
    if (note) {
      if (account) {
        note.account = account.name;
        note.accountNumber = account.number;
        note.accountHolder = account.holder;
      }
      transactions.push(note);
    } else {
      const summary = block.find((l) => /Opera[çc][ãa]o\s*:|ASSUNTO\s*:/i.test(l));
      if (summary) unparsedLines.push(summary);
    }
  }

  return { transactions, unparsedLines };
}

export function parseNotaRows(pages) {
  return parseNotaText(pages.flat().map((r) => r.text).join('\n'));
}
