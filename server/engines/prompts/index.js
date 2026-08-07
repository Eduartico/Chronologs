/**
 * Prompts, per language.
 *
 * The model answers in whatever language it is asked in, and the advisor's notes go
 * straight onto the screen — so the prompt language has to follow the reader's,
 * not stay pinned to Portuguese.
 *
 * What does *not* change with the language is the wire format. The advisor's
 * verdict is parsed against the literal strings `"concordo"` and `"discordo"`, and
 * its payload uses Portuguese-named JSON keys (`nivel`, `raiz`, `mudariaCategoriaA`
 * …). Translating those would mean two parsers and a locale-dependent bug the day
 * someone switches language. So the English prompt keeps them verbatim and
 * describes them as opaque tokens to copy; only the instructions are in English.
 *
 * `normaliseVerdict` exists because "copy this literal" is a model behaviour, not a
 * guarantee — a model given an English prompt will sometimes answer `"agree"`.
 * Without it, every finding would silently read as rejected.
 */
import advisorPt from './advisor.pt.js';
import advisorEn from './advisor.en.js';
import classifyPt from './classify.pt.js';
import classifyEn from './classify.en.js';
import ruleSuggestPt from './ruleSuggest.pt.js';
import ruleSuggestEn from './ruleSuggest.en.js';

const PROMPTS = {
  advisor: { pt: advisorPt, en: advisorEn },
  classify: { pt: classifyPt, en: classifyEn },
  ruleSuggest: { pt: ruleSuggestPt, en: ruleSuggestEn },
};

/** Pick a prompt builder. Falls back to English, which is the shipped default. */
export function pick(name, locale = 'en') {
  const family = PROMPTS[name];
  if (!family) throw new Error(`Unknown prompt: ${name}`);
  return family[locale] || family.en;
}

const AGREE = new Set(['concordo', 'agree', 'agreed', 'yes', 'true', 'sim']);
const DISAGREE = new Set(['discordo', 'disagree', 'no', 'false', 'nao', 'não']);

let unrecognised = 0;

/**
 * Map whatever the model actually said onto the two verdicts the app stores.
 *
 * Returns `null` for anything unrecognised rather than guessing, and counts it, so
 * a model that has quietly stopped following the contract shows up as a number
 * instead of as findings that all look rejected.
 */
export function normaliseVerdict(raw) {
  const word = String(raw ?? '').trim().toLowerCase();
  if (AGREE.has(word)) return 'concordo';
  if (DISAGREE.has(word)) return 'discordo';
  unrecognised += 1;
  console.warn(`[prompts] unrecognised verdict from the model: ${JSON.stringify(raw)} (${unrecognised} so far)`);
  return null;
}

export function unrecognisedVerdicts() {
  return unrecognised;
}
