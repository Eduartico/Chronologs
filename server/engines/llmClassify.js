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

function buildPrompt(batch, categories) {
  return `Classificas transacções bancárias portuguesas por categoria.

Categorias permitidas (usa exactamente estes nomes): ${categories.join(', ')}.

Comerciantes a classificar:
${batch.map((g, i) => `${i + 1}. "${g.label}" (${g.count} transacções, total ${g.total.toFixed(2)} EUR)`).join('\n')}

Regras:
- Responde SÓ com categorias da lista acima.
- Se não tiveres a certeza razoável sobre um comerciante, omite-o. Preferimos
  nenhuma sugestão a uma sugestão errada.
- "confidence" entre 0 e 1.

Responde em JSON estrito:
{"results": [{"label": "<label exacto>", "category": "<categoria>", "confidence": 0.9}]}`;
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
      parsed = await generateJSON(buildPrompt(batch, categories));
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
