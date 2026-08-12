/**
 * Parses ActivoBank "Comprovativo de Operação" — the receipt for a stock or ETF
 * order placed through the app.
 *
 * These are not bank movements and must not become transactions: the money
 * leaves the account later, and the statement already books it as
 * "COMPRA BOLSA..OP.390545877 DE ISH CORE MSCI W". What the receipt adds is
 * everything the statement truncates away — the full security name, the market,
 * the quantity, and the quote at the time.
 *
 * pdf-parse renders this form's two columns with no separator, so labels and
 * values arrive glued together:
 *
 *   Tipo de OrdemOrdem de Compra
 *   MercadoAMS
 *   TítuloiShares Core MSCI World ETF USD Acc
 *   Quantidade1,00
 *   Valor da Última Cotação120,33
 *
 * Every field is therefore read as "the text immediately after this label",
 * with a fallback to the next line for the layouts that do break.
 */
import { parseAmountPT } from '../normalize.js';

const RECEIPT = /Comprovativo\s+de\s+Opera[çc][ãa]o/i;
const EXCHANGE_ORDER = /Ordem\s+Compra\s*\/\s*Venda\s+Bolsa/i;

const PT_DATETIME = /(\d{2})-(\d{2})-(\d{4})/;

export function isComprovativo(text) {
  return RECEIPT.test(text) && EXCHANGE_ORDER.test(text);
}

/**
 * Reads a glued label/value pair. Returns whatever follows the label on the
 * same line, or the next non-empty line when the value wrapped.
 *
 * Label patterns must not end in `\b`: there is no word boundary between
 * "Título" and "iShares" when the renderer runs them together, so a trailing
 * boundary makes every field fail to match.
 */
function field(lines, labelRegex) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRegex);
    if (!m) continue;
    const inline = lines[i].slice(m.index + m[0].length).replace(/^[\s:.-]+/, '').trim();
    if (inline) return inline;
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      if (lines[j].trim()) return lines[j].trim();
    }
  }
  return null;
}

function toIso(text) {
  const m = String(text || '').match(PT_DATETIME);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function numberFrom(text) {
  if (!text) return null;
  const m = String(text).match(/-?\d{1,3}(?:[. ]\d{3})*[,.]\d+|-?\d+/);
  if (!m) return null;
  const value = parseAmountPT(m[0]);
  return Number.isFinite(value) ? value : null;
}

/**
 * A market order carries "Preço 0,00" because the price is not known when the
 * order is placed — the quote is the only usable number, and the real cost
 * comes from the statement line this receipt gets linked to.
 */
function priceOf(lines) {
  // "Tipo de Preço" (Ao mercado / Limitado) must not be mistaken for the price.
  const explicit = numberFrom(field(lines, /(?<!Tipo\s{0,3}de\s{0,3})Pre[çc]o/i));
  const quote = numberFrom(field(lines, /Valor\s+da\s+[ÚU]ltima\s+Cota[çc][ãa]o/i));
  return {
    price: explicit && explicit !== 0 ? explicit : null,
    quote: quote ?? null,
  };
}

export function parseComprovativoText(text) {
  if (!isComprovativo(text)) return { orders: [], unparsedLines: [] };

  const lines = text.split('\n').map((l) => l.trim());

  // "Conta de Títulos0000045600427404" appears above the security itself, so
  // the plural has to be excluded or the account number is read as the name.
  const security = field(lines, /(?<!Conta\s{0,3}de\s{0,3})T[íi]tulo(?!s)/i);
  const quantity = numberFrom(field(lines, /Quantidade/i));
  const orderType = field(lines, /Tipo\s+de\s+Ordem/i) || '';
  const state = field(lines, /Estado/i) || '';
  const market = field(lines, /Mercado(?!\b\s*$)/i);
  const currency = (field(lines, /Moeda\s+da\s+Opera[çc][ãa]o/i) || 'EUR').slice(0, 3).toUpperCase();
  const date =
    toIso(field(lines, /Data\s*\/\s*Hora\s+do\s+carregamento/i)) ||
    toIso(field(lines, /Validade/i));

  if (!security || !date || !quantity) {
    return {
      orders: [],
      unparsedLines: [
        lines.find((l) => /T[íi]tulo/i.test(l)) || 'Comprovativo sem título legível',
      ],
    };
  }

  const { price, quote } = priceOf(lines);
  const side = /venda/i.test(orderType) ? 'sell' : 'buy';

  return {
    orders: [
      {
        date,
        side,
        security: security.replace(/\s+/g, ' ').trim(),
        market: market || null,
        quantity,
        price,
        quote,
        currency,
        // "Executado" vs "Pendente": only executed orders should ever be
        // reconciled against a bank debit.
        executed: /execut/i.test(state),
      },
    ],
    unparsedLines: [],
  };
}

export function parseComprovativoRows(pages) {
  return parseComprovativoText(pages.flat().map((r) => r.text).join('\n'));
}
