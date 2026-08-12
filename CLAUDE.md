# Chronologs

Personal finance tracker, built as a small core plus modules. React/Vite
frontend (`web/`), Express backend (`server/`), data sources under `modules/`,
event-sourced ledger on disk — no database. Configured for one user (Eduardo),
PT-PT, but the shape is meant to be forked.

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

## Modules

A data source is a folder under `modules/`, discovered by globbing
`modules/*/module.js` at startup. There is no list to register on. Full
authoring manual in `docs/modules.md`; `modules/example-bank/` is a working
template with passing tests, and `npm run new:module <id>` copies it.

- A **module** is code; an **instance** is that code pointed at one account.
  The instance id is written as `source` onto every event it produces, so it is
  permanent — renaming one orphans its history in an append-only ledger. This
  is why Eduardo's instances are called `activobank` and `pricempire`.
- Every capability receives one argument, `ctx`
  (`server/framework/context.js`). A module never imports `paths.js`,
  `eventStore.js` or `notify.js` and never writes its own `source` string;
  `ctx.ledger` stamps it. That is the whole mechanism behind multi-instance.
- The reusable pipelines are `server/framework/kits/`. `documentBank.js` holds
  everything a statement-reading bank needs except the parser — batching, the
  per-instance content-hash gate, the cross-document-kind dedup window, the
  ledger scan discipline, running the rules. `browserSource.js` does the same
  for a site with no API. A new bank supplies `fetch` and `parse`.
- `server/framework/contracts.js` is the contract, and the only place that
  knows it. `contract.test.js` runs it over every installed module.
- Built-in engines (rules, correlations, quotes, securities linking) are
  declared through the same contract in `server/framework/builtins.js`, so the
  scheduler and the settings table iterate one kind of thing.
- Routes are generic: `/api/modules/:instance/{sync,upload,reprocess,connect,
  status,config,action/:name}` in `server/routes/modules.js`. The old
  per-provider routes in `api.js` still exist as two-line delegations — that is
  what kept the frontend unchanged, not a coincidence.
- **Per-instance institution profiles.** Two banks word "money left this
  account" differently; one profile for the whole ledger meant the second
  bank's transfers were counted as spending. `compileProfiles` in
  `engines/accounts.js` resolves per `source`, and `findPrimaryAccounts` finds
  the everyday account *per institution* — a global winner made the second
  bank's current account read as savings.

## Where things live

| Concern | File |
|---|---|
| Rule engine v2 (conditions, ordering, stop-processing) | `server/engines/rules.js` |
| Rule advisor (collapse/shadowed/pattern/anomaly findings) | `server/engines/advisor.js` — see `docs/rules-model.md` |
| Internal transfers / PoupeUp vaults | `server/engines/accounts.js` — one editable profile per bank instance, see `chronologs-institution-agnostic` |
| Categorization application (writes ledger events) | `server/engines/categorization.js` |
| Travel detection | `server/engines/travel.js` |
| Duplicate detection | `server/engines/duplicates.js` |
| Correlations (bank ↔ marketplace matching) | `server/engines/correlation.js` |
| Analytics / dashboard aggregates | `server/engines/analytics.js` |
| ActivoBank ingestion (Gmail, PDF/CSV parsing) | `modules/activobank/` |
| Pricempire ingestion | `modules/pricempire/` |
| Module contract, registry, `ctx`, kits | `server/framework/` |
| Generic module routes | `server/routes/modules.js` |
| All other HTTP routes | `server/routes/api.js` (one large file, grouped by feature with comment headers) |
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
  entry to hide it, double-click to isolate it, hover to dim the others.
  Reuse this hook rather than writing new toggle logic per chart.
- Inline editors are chromeless; ordinary form fields are not. `.editable`,
  `.add-row input` and `input.bare` opt out of the border in `index.css`;
  everything else gets `--field-bg` and `--field-border`. The old blanket
  `!important` purge is gone — it made every input invisible on a light
  theme and suppressed the focus ring app-wide. Never re-add it: scope the
  chromelessness to the editor instead.

## Theming

Never write a colour literal in CSS or JSX. Every colour resolves from four
anchors per theme — background, sidebar, ink, accent — declared in
`web/src/styles/themes.js` and mixed into the full token set by
`web/src/styles/tokens.css` using the percentages in `styles/derive.js`.

- **17 themes**, `guardian` reproducing the pre-theming palette within
  ΔE2000 2.0, enforced by `web/src/lib/theme.test.js`. Re-fit a percentage
  with `node scripts/tune_derivation.js`; never hand-edit one.
- `<html>` carries `data-theme`, `data-mode`, `data-panel`, `data-ramp`,
  `data-finance`, `data-textures`, `data-tables`. `mode`/`panel`/`ramp` are
  properties *of the theme*, looked up from the registry and never stored,
  so an impossible combination cannot be constructed.
- The sidebar runs a **separate** ladder (`--panel-*`). Four themes pair a
  light page with a dark rail; deriving one from the other breaks them.
- Ink on a filled colour is `--on-accent`/`--on-good`/… computed by
  `web/src/lib/contrastInk.js` at theme-apply time. CSS cannot decide this.
- Charts read resolved colours through `ChartThemeProvider`, which probes
  computed style — `getPropertyValue('--x')` returns the unresolved
  `color-mix()` text for an untyped custom property.

## Strict data-visualisation and accessibility rules

**Never use colour alone to convey financial data.** These are requirements,
not preferences; a component that breaks one is not finished.

- **Financial values go through `web/src/components/ui/Value.jsx`.** It
  encodes direction three independent ways: hue, an explicit `+`/`−` or
  `▲`/`▼`, and font weight (up is semibold, down regular), plus a
  screen-reader word. Never colour a number by hand. Pass
  `symbol="none"` for amounts that are not gains or losses — a large expense
  is not "bad", and colouring it says something the data does not.
- **Every new component must support the blue/orange accessibility state.**
  Money uses `--pnl-up`/`--pnl-down`, which `[data-finance='cvd']` swaps;
  status uses `--good`/`--bad`, which it must not. An error message stays
  red when finance colours change.
- **Every chart passes a `table={{ rows, columns }}` spec to `ChartCard`.**
  It renders as a visible table on request and inside `.sr-only` otherwise —
  an SVG of `<path>` elements says nothing to a screen reader. A chart
  without one warns in dev; that warning is a bug, not noise.
- **Series carry non-colour channels**: `DASH` and `MARKER` from
  `chartTheme.js` on lines, `stroke="var(--surface-1)" strokeWidth={2}`
  between pie slices and stacked bars so segments read as separated.
- **Texture fills** come from `seriesFill(theme, i, colour)` when
  `data-textures="on"` — area marks only, never lines, and always keeping
  the solid `stroke`.
- **Hover isolation** uses `dimOf`/`widthOf`/`focusProps` from
  `useSeriesToggle`. Dimming is information and survives
  `prefers-reduced-motion`; only the transition is dropped.
- **Prefer direct labels to a detached legend** where the chart allows it.
- The eight-colour series ramps are validated as *sets* by
  `scripts/validate_palette.js` (pairwise ΔE2000 under normal vision and
  three kinds of colour blindness, plus contrast against the worst surface
  each ramp has to sit on). Never edit one value in isolation — run it.

## Language

Two locales, `en` (shipped default) and `pt` (Eduardo's). No i18n library:
`web/src/i18n/index.js` is ~120 lines, and the catalogue is a plain ESM
object so the *server* can import it for English notification fallbacks.

- **No user-visible string literals in JSX.** `t('key')`, or `tx()` when the
  sentence contains markup. `node scripts/find_untranslated.js` lists what is
  left — currently ~20 hits, all of them identifiers, product names, or
  Google-console labels that would send the reader hunting for a menu item
  that does not exist if translated.
- **Never call `t()` at module scope.** A column descriptor written as
  `const COLUMNS = [{ label: t('x') }]` builds fine and throws
  `t is not defined` at *import* time, so nothing renders at all and the stack
  points somewhere unrelated. Make it `const COLUMNS = (t) => [...]` and call
  it from the component under `useMemo`. Enforced by
  `web/src/lib/i18nScope.test.js`, which also bans `get: (t) => t.amount` —
  that shadows the translator.
- **A default prop cannot call a hook.** Write `label` with no default and
  resolve at use: `label ?? t('common.delete')`.
- `pt.js` is **pre-AO90** — "transacções", "actualizar", "correcção". That
  is Eduardo's register, not a typo; `i18n.test.js` fails if the post-1990
  spellings appear.
- Locale lives in `web/src/lib/locale.js` — never write `'pt-PT'` anywhere
  else, and never build an `Intl` formatter outside `nf()`/`df()`.
- **Server-side text is keys, not sentences.** `fail(res, 404, 'api.error.x')`
  from `server/lib/httpError.js`; `notify(type, 'notify.x', params)` stores
  `{key, params}` so a notification reads in whatever language is current
  when it is opened. `notify.test.js` fails on a key with no catalogue entry.
- **LLM prompts follow the reader's language** (`server/engines/prompts/`),
  but the wire format never does: the advisor's `"concordo"`/`"discordo"`
  verdicts and its Portuguese JSON keys are the parse contract in both
  languages, and `normaliseVerdict()` catches a model that translates them
  anyway.

## Verification

UI changes are not done until checked with a running browser (Playwright),
not just read back as code — see `chronologs-visual-verification` in
memory for two real bugs code review alone missed. `npm test` before
calling server-side logic done; `npm run build` before calling a frontend
change done.

`npm test` runs `scripts/validate_palette.js` first, then the node test
runner over `server/**/*.test.js`, `web/src/lib/**/*.test.js` and
`modules/**/*.test.js` — the frontend glob is why `theme.test.js`,
`contrastInk.test.js` and `i18n.test.js` live under `lib/` rather than beside
what they test.

**`npm run snapshot:verify` before calling any refactor done.** It replays the
real ledger and re-requests every read-only endpoint, comparing against a
capture taken with `npm run snapshot:baseline` — 2912 movements and 900-odd
documents, which is a far stronger statement than any test. Differences that
are *intended* go in `scripts/accepted-diffs.json` with the reason, rather than
re-taking the baseline: re-taking it resets the comparison and hides whatever
drifted alongside. The baseline lives in `user-data/snapshots/` and is
gitignored, because it is a capture of real money.

A theme or accessibility change needs the browser twice: once on a dark
theme and once on a light one. Guardian and Calus's Selected are the two
extremes (dark rail on dark page; light rail on white page); Dreaming
Spectrum is the awkward one, a dark rail against a beige page.
