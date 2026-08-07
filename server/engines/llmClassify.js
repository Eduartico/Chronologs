/**
 * Optional Ollama-backed classification of merchant groups.
 *
 * Classifying 1300 transactions one by one would be both slow and wasteful —
 * they collapse into roughly 300 distinct merchants. This asks the model about
 * the merchants instead, in small batches, and every failure degrades to "no
 * suggestion" rather than breaking the page.
 */
import { generateJSON, llmEnabled } from '../lib/ollama.js';

const BATCH_SIZE = 30;

/**
 * Fixed confidence for every model answer, deliberately below the weakest
 * deterministic source (the keyword lexicon starts at 0.6).
 *
 * Measured against llama3.1:8b on 195 real merchants: the model answered 184 of
 * them and reported 0.85 for every single one, including "POUPEUP" (a savings
 * account) as shopping and a supermarket as transport. Its self-reported
 * confidence carries no information, so it is discarded rather than trusted —
 * these are ranked last and labelled as guesses in the UI.
 */
const LLM_CONFIDENCE = 0.55;

/** The prompt follows the reader's language — see server/engines/prompts/. The
    category names inside it are the English keys from categories.json either way,
    because those are what the parser matches the answer against. */
async function buildPrompt(batch, categories) {
  const { pick } = await import('./prompts/index.js');
  const { currentLocale } = await import('../lib/settings.js');
  return pick('classify', currentLocale())(batch, categories);
}

/**
 * Returns a Map of group key -> { category, confidence }. Groups already
 * carrying a high-confidence suggestion are skipped, so the model spends its
 * effort on the merchants nothing else could identify.
 */
export async function classifyMerchantGroups(groups, categories) {
  const out = new Map();
  if (!llmEnabled() || groups.length === 0) return out;

  const allowed = new Set(categories);
  const byLabel = new Map(groups.map((g) => [g.label, g]));

  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    const batch = groups.slice(i, i + BATCH_SIZE);
    let parsed;
    try {
      parsed = await generateJSON(await buildPrompt(batch, categories));
    } catch {
      continue; // Ollama down or model missing — the other sources still stand.
    }

    const results = Array.isArray(parsed) ? parsed : parsed?.results;
    if (!Array.isArray(results)) continue;

    for (const r of results) {
      if (!r || typeof r.label !== 'string' || !allowed.has(r.category)) continue;
      const group = byLabel.get(r.label);
      if (!group) continue;
      out.set(group.key, { category: r.category, confidence: LLM_CONFIDENCE });
    }
  }

  return out;
}
