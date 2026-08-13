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
import { LOCALES, DEFAULT_LOCALE } from '../../../web/src/lib/locale.js';

const PROMPTS = {
  advisor: { pt: advisorPt, en: advisorEn },
  classify: { pt: classifyPt, en: classifyEn },
  ruleSuggest: { pt: ruleSuggestPt, en: ruleSuggestEn },
};

/**
 * Ask for the answer in the reader's language.
 *
 * Two prompt families are written by hand, and the app ships fourteen languages
 * — so most readers get the English prompt. The old fallback ended there, which
 * meant a German interface showing English advisor notes: the one place a model's
 * output lands verbatim on screen is also the one place the fallback was visible.
 *
 * Appended rather than woven in, because the prompt files carry the parse
 * contract and this must not disturb it. The tokens named here are exactly the
 * ones `normaliseVerdict` and the JSON readers depend on, and a model told to
 * answer in Japanese will otherwise cheerfully translate `"concordo"` too.
 */
function languageDirective(locale) {
  const name = LOCALES[locale]?.name;
  if (!name) return '';
  return [
    '',
    '',
    `LANGUAGE: write every human-readable sentence in ${name}.`,
    'This does NOT apply to the machine-readable parts: JSON keys, category names,',
    'and the verdict values "concordo" and "discordo" are opaque tokens. Copy them',
    'exactly as written above, in the Latin alphabet, whatever language you answer in.',
  ].join('\n');
}

/**
 * Pick a prompt builder.
 *
 * A locale with its own prompt file gets it. Everything else gets the English
 * prompt with a directive telling the model which language to answer in — which
 * is a far better result than English notes in a Korean interface, and costs
 * nothing to add a locale.
 */
export function pick(name, locale = DEFAULT_LOCALE) {
  const family = PROMPTS[name];
  if (!family) throw new Error(`Unknown prompt: ${name}`);
  if (family[locale]) return family[locale];

  const directive = languageDirective(locale);
  if (!directive) return family.en;
  return (...args) => `${family.en(...args)}${directive}`;
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
