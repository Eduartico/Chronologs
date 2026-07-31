/**
 * Merchant-name normalization for ActivoBank descriptions.
 *
 * Pure string handling with no engine dependencies, so both the suggestion
 * engine and the rules engine can use it without importing each other.
 */

// Trailing tokens that identify where a purchase happened, not what it was.
const PLACES = new Set([
  'porto', 'port', 'lisboa', 'lisbon', 'lisbo', 'maia', 'matosinhos', 'gaia',
  'braga', 'coimbra', 'amadora', 'canidelo', 'sintra', 'cascais', 'almada',
  'faro', 'aveiro', 'leiria', 'viseu', 'guimaraes', 'barcelos', 'setubal',
  'funchal', 'evora', 'tallinn', 'london', 'lond', 'amsterdam', 'koln',
  'madrid', 'murcia', 'cordoba', 'barcelona', 'stockholm', 'dublin', 'paris',
  'milano', 'berlin', 'warszawa', 'vilnius', 'luxembourg', 'internet',
]);

const LINKERS = new Set(['do', 'da', 'de', 'dos', 'das', 'no', 'na', 'em', 'of', 'the']);

const COUNTRIES = new Set([
  'pt', 'es', 'de', 'gb', 'ee', 'lt', 'be', 'se', 'nl', 'fr', 'it', 'us',
  'lu', 'ie', 'dk', 'pl', 'fi', 'at', 'cz', 'ch', 'no', 'mt', 'cy',
]);

export function stripAccents(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Reduces an ActivoBank description to the merchant itself. The card number in
 * "COMPRA 3987 ..." rotates between physical and virtual cards, so the same
 * shop shows up under several prefixes unless it is stripped — that single
 * substitution is what lets purchases group at all.
 */
export function cleanDescription(raw) {
  let s = stripAccents(String(raw || '')).toUpperCase();

  s = s
    .replace(/^COMPRA\s+\d{3,4}\s+/, '')
    .replace(/^LEV(?:ANTAMENTO)?\.?\s+ATM\s+\d{3,4}\s+/, '')
    .replace(/^PAG(?:\.|SERV)?\s*\d{6,}\s*-\s*/, '')
    .replace(/^PAG\s+SERV\s+/, '')
    .replace(/^PAGSERV\s+/, '')
    .replace(/^DD[A-Z]{2}\d+\s+/, '')
    .replace(/^CRED\.?\s+\d{3,4}\s+/, '')
    .replace(/^TRF\.?\s+(?:P\/O|P\/|DE)\s+/, '')
    .replace(/^TRANSFERENCIA\s*-\s*/, '');

  // Foreign-currency purchases carry the exchange rate used, which differs on
  // every single transaction: "dmarket.com Lond USD TC 0.8650793".
  s = s.replace(/\s+(?:USD|EUR|GBP|BRL|CHF)?\s*TC\s+[\d.,]+\s*$/, '');
  s = s.replace(/\s+CONTACTLESS\s*$/, '');
  s = s.replace(/\b\d{4}-\d{3,4}\b/g, ' ');
  s = s.replace(/\b\d{5,}\b/g, ' ');

  // Order references mix letters and digits ("OP19XCEE1", "03SEP", "INTE1862").
  // One digit is kept so genuine names like "H3" or "CS2" survive.
  s = s
    .split(/\s+/)
    .filter((tok) => !(/[A-Z]/.test(tok) && (tok.match(/\d/g) || []).length >= 2))
    .join(' ');

  // Stripping the numeric parts of a service reference ("PAG SERV 10316/208858552
  // UNIVERSIDADE DO PORTO") leaves the separator behind, so orphaned
  // punctuation is swept up before the label is built.
  s = s.replace(/(^|\s)[/\-.,;:]+(?=\s|$)/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  for (let i = 0; i < 3; i++) {
    const parts = s.split(' ');
    if (parts.length < 2) break;
    const last = parts[parts.length - 1].toLowerCase();
    if (!COUNTRIES.has(last) && !PLACES.has(last)) break;
    // A place name introduced by a preposition belongs to the merchant's own
    // name ("UNIVERSIDADE DO PORTO"), unlike a bare trailing location
    // ("CONTINENTE BOM DIA PORTO").
    if (LINKERS.has(parts[parts.length - 2].toLowerCase())) break;
    parts.pop();
    s = parts.join(' ');
  }

  return s.trim();
}

/**
 * Grouping key for a transaction. The label keeps the full cleaned description
 * for display; the key is deliberately coarser so "CONTINENTE BOM DIA PORTO"
 * and "CONTINENTE BOM DIA PORT CONTACTLESS" land in the same bucket.
 */
export function normalizeMerchantKey(tx) {
  const label = cleanDescription(tx.description || tx.merchant || '');
  const key = label.split(' ').slice(0, 3).join(' ').slice(0, 24).trim();
  return { key: key || 'OUTROS', label: label || tx.description || 'Sem descrição' };
}
