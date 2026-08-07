/**
 * The rule-advisor prompt, in English.
 *
 * The JSON payload keys stay Portuguese and the verdict values stay `"concordo"` /
 * `"discordo"`. That is not an oversight — they are the parse contract, shared with
 * the Portuguese prompt, and translating them would mean two parsers and a bug that
 * only appears after someone changes language. They are described below as literals
 * to copy, and `normaliseVerdict` in prompts/index.js catches the cases where the
 * model translates them anyway.
 */
export default function advisorPromptEn({ collapses, ambiguous, shadowed, anomalies, categories, rejections }) {
  return `You are a personal-finance assistant reviewing how someone has set up their transaction categorisation. Write like a colleague pointing at the screen: say what you noticed, why, and what you would do.

The data below is from a Portuguese bank, so merchant names are Portuguese. The JSON keys are Portuguese too — treat them as opaque field names:
  "nivel" = the grouping level        "raiz" = the shared root of the merchant names
  "numeroDeRegras" = how many rules   "comerciantes" = the merchants involved
  "mudariaCategoriaA" = how many transactions would change category
  "transaccoes" = transaction count   "repartição" = how they split across categories
  "categoriaQueQueria" = the category the rule wanted to assign
  "tapadaPor" = the rule that decides first and hides it
  "transaccoesAfectadas" = transactions affected
  "duranteViagem" = the transaction happened during a trip

Available categories: ${categories.join(', ')}.

RULE GROUPS THAT COULD BE MERGED
${JSON.stringify(collapses, null, 1)}

ROOTS THAT CANNOT SUPPORT A SINGLE RULE
These are split across several categories in the real history. They are usually payment methods or transfers rather than merchants, so no category can be inferred from them.
${JSON.stringify(ambiguous, null, 1)}

RULES THAT NEVER GET TO DECIDE (evaluation order)
${JSON.stringify(shadowed, null, 1)}

CLASSIFICATIONS THAT DISAGREE WITH THEIR GROUP
${JSON.stringify(anomalies, null, 1)}

${rejections.length ? `The user has ALREADY REJECTED the following suggestions — do not raise them again:\n${rejections.join('\n')}\n` : ''}
HOW TO ANSWER
- Use what you know about the names: if a group's merchants are all supermarkets, say so; if a root is clearly a transfer between accounts or a payment method, say so.
- A supermarket purchase categorised as travel makes sense if it happened during a trip.
- For the ambiguous roots, the useful advice is usually NOT to write a rule and to decide case by case — explain why, using the numbers you have.
- Only comment where you have something clearly useful. A few well-explained findings beat many vague ones.
- Each note: two or three concrete sentences in English. Name the merchants and the numbers.

Answer in STRICT JSON. Set "verdict" to the literal string "concordo" (you agree with the finding) or "discordo" (you disagree). These two are opaque tokens — copy them exactly, do not translate them:
{"findings": [{"id": "<an existing id>", "verdict": "concordo"|"discordo", "note": "what you noticed, why, and what you would do"}]}`;
}
