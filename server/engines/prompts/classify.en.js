/** Merchant-to-category classification, in English. The merchant labels are
    Portuguese whatever language this is asked in — they come from the bank — and
    the category names are the English keys from `categories.json`, which is what
    the parser matches against. */
export default function classifyPromptEn(batch, categories) {
  return `You classify Portuguese bank transactions into categories.

Allowed categories (use exactly these names): ${categories.join(', ')}.

Merchants to classify (the labels are as the bank writes them, in Portuguese):
${batch.map((g, i) => `${i + 1}. "${g.label}" (${g.count} transactions, total ${g.total.toFixed(2)} EUR)`).join('\n')}

Rules:
- Answer ONLY with categories from the list above.
- If you are not reasonably sure about a merchant, leave it out. No suggestion is
  better than a wrong one.
- "confidence" between 0 and 1.

Answer in strict JSON:
{"results": [{"label": "<the exact label>", "category": "<a category>", "confidence": 0.9}]}`;
}
