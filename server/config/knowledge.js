/**
 * Shared read-only knowledge base: merchant rule templates and the keyword
 * lexicon. Both the rules engine (which proposes rules) and the suggestion
 * engine (which classifies transactions directly) read from here, so neither
 * has to import the other.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let templatesCache = null;
let keywordsCache = null;

export function loadTemplates() {
  if (!templatesCache) {
    templatesCache = JSON.parse(readFileSync(join(__dirname, 'defaults', 'rule-templates.json'), 'utf-8'));
  }
  return templatesCache;
}

export function loadKeywords() {
  if (!keywordsCache) {
    keywordsCache = JSON.parse(readFileSync(join(__dirname, 'defaults', 'keywords.json'), 'utf-8'));
  }
  return keywordsCache;
}

/**
 * Short patterns ("meo ", "irs ", "bp ") would fire on substrings of unrelated
 * words, so anything under 5 characters has to match on a word boundary.
 * Longer patterns stay as plain substring checks — that is what lets
 * "componentes y multimed" match a description truncated by the bank.
 */
export function matchesPattern(haystack, pattern) {
  const p = String(pattern).toLowerCase().trim();
  if (!p) return false;
  if (p.length >= 5) return haystack.includes(p);
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}
