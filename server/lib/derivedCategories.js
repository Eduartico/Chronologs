/**
 * Categories that are computed, never chosen.
 *
 * `travel` is the one there is. A trip is *when and where* money was spent, and
 * the category is *what it bought* — a restaurant in Madrid is food, and it is
 * also part of the Madrid trip, through the trip's tag. Letting a person (or a
 * rule, or a keyword) file something under "travel" put the word back on the
 * category axis, where it overwrote the answer to "what did this buy" and could
 * not say which trip it meant. So the category survives only as what the
 * dashboard's travel overlay reads a claimed transaction as
 * (`travelOverlay` in engines/travel.js), and nothing may assign it.
 *
 * Pure, and in a module of its own, because three layers need the same answer —
 * the projection (to ignore old assignments), the categorisation engine (to
 * refuse new ones) and the rules engine (to skip a rule that would make one) —
 * and the first of those cannot import the other two without a cycle.
 *
 * Matched by id as well as by flag: the flag is backfilled onto an existing
 * install by `ensureDefaultCategories`, and the projection can run before that
 * has. The literal name covers a ledger with no category file at all.
 */
export const DERIVED_CATEGORY_IDS = ['travel'];

export function derivedCategoryNames(categories = []) {
  const names = new Set(['travel']);
  for (const c of categories) {
    if (c && (c.derived || DERIVED_CATEGORY_IDS.includes(c.id))) names.add(c.name);
  }
  return names;
}
