# Rules are evidence, not receipts

## What broke

`learnFromCorrection` (now `noteCorrection`, see below) used to write a
brand-new `learned` rule on every single correction — accept a suggestion,
override a category, bulk-categorize a group — using the *whole cleaned
description* as the rule's one pattern. A real ledger, after months of use,
ended up with 466 rules, 459 of them `learned`, most matching exactly one
transaction ever recorded. Correcting "spar supermarket cais do sodré" to
`food` didn't teach the system anything about Spar; it created a rule that
would never fire again, because no future transaction has that exact
description.

This produced specific, reproducible nonsense in
[`server/engines/advisor.js`](../server/engines/advisor.js)'s shadowed-rule
detector: it would find "pingo doce cais do s li" (one transaction) sitting
below "pingo doce" (the real, broad merchant rule) and offer only "subir na
ordem" — promote the specific rule above the general one — when what anyone
actually wants there is to delete the one-off rule outright. It offered no
way to delete a redundant *specific* rule when the two already agreed, no
way to say "the general rule is right, the one under it is just noise," and
every "collapse these rules" suggestion trended toward one giant rule per
payment method (MB WAY, bank transfers) because those were the only roots
with enough single-pattern rules clustered together to clear the merge
threshold — exactly the roots too ambiguous to deserve one rule at all.

## The model

**A rule is evidence of an observed pattern, not a record of a single
decision.** The decision itself — "this transaction is `food`" — belongs to
the ledger, via a `category_assignment` or `manual_override` event (see
[`server/ledger/eventStore.js`](../server/ledger/eventStore.js)). It already
lived there before this change; nothing about where decisions are stored
changed. What changed is that a correction no longer *also* writes a rule.

A rule earns its existence one of two ways:

1. **A person writes it.** Nothing here restricts manual rule creation via
   the Regras page — advanced users who know a pattern is real can still say
   so directly.
2. **The ledger agrees with itself enough times.** `patternCandidates()` in
   `advisor.js` groups categorized transactions by merchant root (the same
   `rootOf()` two-token heuristic `ambiguousRoots()` and `collapseCandidates()`
   already used), and proposes a rule once a root has **3 or more**
   transactions with **at least 75%** landing in the same category — the
   same `MAJORITY_RATIO` threshold `anomalyCandidates()` uses for the
   opposite question. Below that bar, it isn't a pattern yet, it's a
   coincidence; the finding simply doesn't appear.

`noteCorrection()` in [`server/engines/rules.js`](../server/engines/rules.js)
is what's left of the old reactive path: it looks for a rule that **already**
covers this exact pattern and category, and nudges its `confidence` up if
one exists. It returns `null` and writes nothing when no such rule exists.
The three call sites in
[`server/routes/api.js`](../server/routes/api.js) (`/categorize`,
`/categorize/bulk`, `/categorize/override`) are unchanged in shape — same
three places, same arguments — only the function underneath stopped
creating rules.

## Compacting what already exists

The 459-rule backlog from before this model doesn't clean itself up.
`compactLearnedRules()` groups every `learned` rule by the same merchant
root, and for any root with 2+ rules, replaces them with **one** rule whose
category is whichever the real ledger mostly agrees on — computed via
`majorityCategoryFor()`, not inherited from whichever correction happened
first. Roots `ambiguousRoots()` flags (MB WAY, bank transfers — a payment
method, not a shop) are left untouched entirely; forcing one category onto
those would be wrong more often than the mess they're already in. The
preview (`GET`-shaped as a `POST` because it has to run the rule engine over
the whole ledger to compute it) shows the before/after rule count and every
transaction that would change category, before anything is written — see
`RuleAdvisor.jsx`'s `CompactionPreview` component.

## The conflict-resolution model

The other half of the same complaint: a shadowed-rule finding used to offer
exactly one fix, computed by a guess (same category as the rule stealing its
transactions → offer delete; different category → offer promote). Real
ledgers turned up cases the guess got wrong — two rules with the *same name*
and different categories, or a case where deleting the *specific* rule was
correct even though it disagreed with the general one. `applyShadowedFix()`
now exposes every fix that could apply to a given finding at once, and the
UI renders whichever subset is eligible:

- **Delete the specific rule** — always offered. It never wins today (that's
  what "shadowed" means), so this can never change a single existing
  categorization; it only stops the rule existing for future transactions.
- **Delete the general rule instead** — offered when the rule doing the
  shadowing is itself `learned` (not hand-written), on the theory that a
  one-correction rule earns less benefit of the doubt than one a person
  wrote on purpose.
- **Promote** — move the specific rule above the general one, unchanged from
  before.
- **Retarget** — redirect the general rule to whatever category its own real
  matches mostly resolve to, unchanged from before.
- **Explain / reject** — the existing note-and-reject flow, now framed as
  "explain why," since the note is what feeds the next request to the local
  model.

Every mutating action, when the caller passes transactions, runs a real
before/after simulation (`diffCategorization()`) and reports how many
transactions actually changed category — not a guess based on match counts.

Anomaly findings gained the mirror action: `applyAnomalyInverse()` handles
the case where the flagged transaction was right and the *majority* of its
merchant group was wrong, moving the group to match it instead of the other
way around.

## Where this shows up

| Concern | File |
|---|---|
| No longer creates rules | [`server/engines/rules.js`](../server/engines/rules.js) — `noteCorrection` |
| Proposes a rule from observed agreement | [`server/engines/advisor.js`](../server/engines/advisor.js) — `patternCandidates`, `applyPattern` |
| Collapses the pre-existing backlog | `advisor.js` — `compactLearnedRules`, `applyCompaction` |
| Multi-option conflict resolution | `advisor.js` — `applyShadowedFix`, `applyAnomalyInverse` |
| UI for all of the above | [`web/src/components/RuleAdvisor.jsx`](../web/src/components/RuleAdvisor.jsx) |
| Pre-resolves the review queue against current rules | [`web/src/pages/PendingReview.jsx`](../web/src/pages/PendingReview.jsx) — the "já têm resposta nas tuas regras" banner |
