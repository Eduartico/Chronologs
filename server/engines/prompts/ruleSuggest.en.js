/** Propose categorisation rules from a sample of uncategorised movements. */
export default function ruleSuggestPromptEn(samples, categories) {
  return `You are helping categorize personal-finance transactions.
Available categories: ${categories.join(', ')}.
Sample uncategorized transactions (Portuguese bank data):
${JSON.stringify(samples, null, 1)}

Propose AT MOST 5 high-confidence categorization rules — quality over quantity.
Only suggest a rule when the merchant/keyword is unambiguous. You may also
include well-known Portuguese merchants that are missing from the samples.
Reply with STRICT JSON: {"rules": [{"name": "...", "patterns": ["keyword"], "category": "one of the categories"}]}`;
}
