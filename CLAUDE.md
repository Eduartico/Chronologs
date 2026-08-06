# Chronologs

Personal finance tracker. React/Vite frontend (`web/`), Express backend
(`server/`), event-sourced ledger on disk — no database. Single user
(Eduardo), PT-PT.

**Before making non-trivial changes, check
`~/.claude/projects/e--Repos-Chronologs/memory/MEMORY.md`** — standing
decisions and Eduardo's feedback live there, not here. This file is what
doesn't fit in a memory: architecture and file locations that are cheaper to
document once than to re-derive by reading code every session.

## The event model

`server/ledger/eventStore.js` appends JSON events, one per line, never
mutates or deletes. `server/projections/rebuild.js` replays the whole log
into the in-memory shape every route reads (`server/projections/cache.js`
holds the cached result; call `getProjections()`, never read the ledger
directly from a route).

A movement's identity is its `transaction_id`, not the event that recorded
it — re-ingesting the same statement is safe and idempotent, matched in
`rebuild.js`'s `eventsById` grouping. Category assignments, manual
overrides, and tag events are separate event types keyed by that same id;
`rebuild.js` folds the latest of each onto the base transaction. See
`chronologs-ledger-identity` in memory for the incident this design prevents.

## Where things live

| Concern | File |
|---|---|
| Rule engine v2 (conditions, ordering, stop-processing) | `server/engines/rules.js` |
| Rule advisor (collapse/shadowed/pattern/anomaly findings) | `server/engines/advisor.js` — see `docs/rules-model.md` |
| Internal transfers / PoupeUp vaults | `server/engines/accounts.js` — bank-agnostic via `settings.internal.profile`, see `chronologs-institution-agnostic` |
| Categorization application (writes ledger events) | `server/engines/categorization.js` |
| Travel detection | `server/engines/travel.js` |
| Duplicate detection | `server/engines/duplicates.js` |
| Correlations (ActivoBank ↔ Pricempire matching) | `server/engines/correlation.js` |
| Analytics / dashboard aggregates | `server/engines/analytics.js` |
| ActivoBank ingestion (Gmail, PDF/CSV parsing) | `server/ingestion/activobank/` |
| Pricempire ingestion | `server/ingestion/pricempire/` |
| All HTTP routes | `server/routes/api.js` (one large file, grouped by feature with comment headers) |
| Scheduler (cron-style internal jobs) | `server/lib/scheduler.js` |

`server/config/defaults/*.json` are the shipped defaults (categories,
keywords, rule templates, securities). `user-data/state/*.json` is this
user's actual data — never edit defaults to fix a personal data problem, and
never assume defaults reflect what's actually in `user-data/`.

## Rules are evidence, not receipts

A rule exists because a pattern was *observed*, not because one transaction
was corrected once. `noteCorrection` (in `rules.js`) only reinforces a rule
that already covers a pattern — it never creates one. New rules come from
`server/engines/advisor.js`'s `pattern` finding (3+ concordant manual
decisions, no covering rule) or from a person writing one by hand. Full
reasoning and the incident that motivated this in `docs/rules-model.md`.

## UI conventions

- Dates: always `dd/mm/aaaa`, via `web/src/lib/format.js` — never format a
  date inline.
- Icons: `web/src/components/Icon.jsx`'s inline SVG set. **Never emoji** —
  they carry their own colour and render differently per platform.
- Editable tables/lists: follow the `inline-table-editing` skill
  (`~/.claude/skills/inline-table-editing/SKILL.md`) before building or
  reworking any of them. Chronologs-specific file map in
  `docs/inline-editing.md`.
- Charts: `web/src/components/charts/useSeriesToggle.jsx` — click a legend
  entry to hide it, double-click to isolate it. Reuse this hook rather than
  writing new toggle logic per chart.
- No `border-bottom`/`outline` on `input`/`select`/`textarea` in any state —
  purged globally in `index.css` with `!important` after two rounds of
  scoped overrides kept losing to other global rules. See
  `chronologs-inline-editing-philosophy` in memory before touching that CSS.

## Verification

UI changes are not done until checked with a running browser (Playwright),
not just read back as code — see `chronologs-visual-verification` in
memory for two real bugs code review alone missed. `npm test` before
calling server-side logic done; `npm run build` before calling a frontend
change done.
