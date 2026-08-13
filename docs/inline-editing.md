# Inline table editing — the Chronologs implementation

This is the project-local reference for the editing philosophy behind every
table in the app (Categorias, Subcategorias, Regras, and anywhere else a row
gets renamed, restyled, reordered, or deleted). The general, project-agnostic
version of this document lives as a Claude Code skill —
`~/.claude/skills/inline-table-editing/SKILL.md` — and gets pulled in
automatically on any future project that builds an editable table. This copy
adds the concrete file paths and the history of what each rule replaced,
specific to this codebase.

## The primitives

| Primitive | File | Does |
|---|---|---|
| Row state machine | [`web/src/lib/useRowEditor.js`](../web/src/lib/useRowEditor.js) | `idle` / `editing` / `armed-to-delete`, with the disarm timer (`DISARM_MS`, currently 1000ms) |
| Row action buttons | [`web/src/components/ui/RowActions.jsx`](../web/src/components/ui/RowActions.jsx) | Renders the pencil/bin pair, the check/close pair while editing, and — while armed — a disabled pencil plus check-in-place-of-bin, keyed by state for the entrance animation (§10) |
| Icon-only button | [`web/src/components/ui/IconButton.jsx`](../web/src/components/ui/IconButton.jsx) | The shared `onMouseDown={(e) => e.preventDefault()}` guard lives here, once, for every button on the site |
| Editable field | [`web/src/components/ui/EditableField.jsx`](../web/src/components/ui/EditableField.jsx) | Text/number/select/date variants, all using `.autosize` |
| Floating panel | [`web/src/components/ui/Popover.jsx`](../web/src/components/ui/Popover.jsx) | Portal + flip-to-fit + the scroll-close fix |
| Icon + colour, merged | [`web/src/components/ui/StylePicker.jsx`](../web/src/components/ui/StylePicker.jsx) | One trigger, one popover, both choices — see §5 below |
| Sortable column header | [`web/src/components/ui/SortHeader.jsx`](../web/src/components/ui/SortHeader.jsx) | Click the header, click again to reverse |

CSS for the `.autosize` grid-mirror trick, the `.editable`/`tr.is-editing`
rules, and the `.icon-btn-armed` styling all live in
[`web/src/index.css`](../web/src/index.css) — search for the block comments
titled "The field is the text" and "The grid-mirror autosize trick."

## Where each rule came from

The numbered rules below map onto the general skill's sections 1–10. What
follows is the Chronologs-specific "what broke, in this app, before this was
the rule" — kept short since the skill itself has the generalizable reasoning.

1. **Two-click delete, same button.** Subcategorias and Regras both used to
   arm a red bin *and* spawn a second cancel button beside it. Confirming
   several deletes in a row meant alternating clicks left/right for no
   reason. Fixed in `RowActions.jsx`: the armed state renders `check`, tone
   `armed`, in the bin's exact position — and, as of the next round of
   feedback, the pencil stays too (disabled, same slot), because hiding it
   left no obvious way out for an accidental arm besides waiting out the
   timer. `.icon-btn-armed` in `index.css` also lost its filled red
   background: a solid block of colour read as a status pill rather than a
   button, so the armed state now carries the danger colour only on the
   glyph, the same as any other `icon-btn-danger`.

2. **Modal instead of two-click, for Categorias.** A category can carry
   hundreds of transactions; deleting it reassigns all of them to
   `uncategorized` and repoints any rule that named it. That's
   [`ConfirmDialog.jsx`](../web/src/components/ui/ConfirmDialog.jsx),
   reached via `RowActions`'s `deleteMode="modal"` prop, with the exact count
   fetched before the dialog opens (`api.getCategoryUsage`). Subcategorias,
   Regras and the exchange-rate table in Definições stay on the plain
   armed-button gesture — nothing else references what they hold. Clearing a
   typed rate only drops back to the fetched one, which is a second's work to
   redo; that is the test for which gesture a row deserves.

3. **No chrome on the editing field.** Went through four rounds before it
   stuck. Filled background + border: removed outright. A `border-bottom`
   that also showed on hover: scoped to `:focus` only. A leftover blue
   `:focus-visible` ring from the *global* accessibility rule (autofocus on
   mount reads as keyboard-worthy focus to Chromium): scoped
   `.editable.is-editing:focus-visible { outline: none; }` next to the
   general rule. Each of those held for a while and then a *different*
   selector — a `:hover` rule on plain `input`, later a `:focus-within` on a
   wrapping `tr` — independently reintroduced the same hairline from a
   direction the scoped fix hadn't covered. The fix that actually stuck:
   one `!important` rule in `index.css`, scoped to `input`/`select` across
   every state at once (rest, hover, focus, focus-visible, focus-within),
   sitting right after the base `input, select, textarea` rule — see the
   comment there ("Won by nothing else") for the reasoning. `textarea` keeps
   its own `border-bottom` out of that rule, since it's the one place a real
   border earns its keep (§3's escape hatch) and `!important` would have
   beaten its own box border too.

4. **Autosize, not `width: 100%`.** Editing "Carol" (a subcategory name) used
   to stretch the input to fill the row via `width: 100%` inside the
   `.category-edit` flex container, flinging the colour swatch to the far
   edge. `EditableField.jsx` now wraps text/number/money inputs in
   `.autosize`; `index.css` carries the `::after`-mirror CSS.

5. **Icon and colour merged into one trigger.** Used to be `IconPicker.jsx`
   on the left of the name and a separate bare colour dot
   (`ColorPicker.jsx`) on the right — which is exactly what rule 4's bug
   flung across the row. `StylePicker.jsx` supersedes both for Categorias
   and Subcategorias: one swatch button, already tinted, opening one popover
   with the icon grid on top and the colour palette underneath. `IconPicker`
   and `ColorPicker` remain as standalone files (the latter's `PALETTE`
   constant is still the source of truth `StylePicker` imports from) but
   neither is wired into a table row directly any more.

6. **Popover portal + the scroll-close bug.** The category picker used to
   render inline in the transaction table's cell — opening it on the last
   visible row pushed the pagination footer off-screen, and the row's own
   height changed between open and closed. `Popover.jsx` fixed the layout
   problem via a portal to `document.body` with measured flip-to-fit. It
   introduced a second bug fixed later: the capture-phase `scroll` listener
   used to close the panel that was itself being scrolled (icon grid,
   subcategory list), so the mouse wheel and the scrollbar thumb both closed
   the menu instead of scrolling it. The fix is the
   `panel.current?.contains(e.target)` guard inside `Popover.jsx`'s scroll
   handler. `SubcategoryPicker.jsx` additionally switched from a vertical
   `<select>`-style list to the same wrapped grid `CategoryPicker.jsx`
   already used, once scrolling worked and a grid could show more at once.

7. **`onMouseDown` guard, centralized.** Without it, clicking Save on a row
   mid-edit — or clicking the `StylePicker` swatch while the name field is
   still focused — would blur-cancel the edit before the click's own handler
   ran. `IconButton.jsx` applies `onMouseDown={(e) => e.preventDefault()}` to
   every icon button on the site, so no individual call site has to
   remember to add it. `Calendar.jsx` (the date-picker popover) uses the
   same trick directly on its day buttons for the same reason.

8. **Blocked delete stays visible.** `RowActions.jsx`'s `canDelete={false}`
   path renders a disabled, greyed bin with `deleteBlockedReason` as the
   tooltip — used for system categories (`uncategorized`, `internal
   transfer`) — instead of leaving a lone pencil where a pair sits on every
   other row.

9. **Direct manipulation elsewhere.** `SortHeader.jsx` (click the column,
   click again to reverse) replaced three separate "ordenar por…" dropdowns
   across Categorias, Regras and the transactions table. The Dashboard's
   stacked-area chart already used legend-click-to-isolate before this pass;
   `useSeriesToggle.jsx` generalized that pattern for reuse on other charts,
   which also grew a second gesture: double-click a legend entry to isolate
   just that series, double-click again to restore everything (`isolate()`
   in `useSeriesToggle.jsx`, wired into every multi-series chart in
   `Dashboard.jsx` and `Investments.jsx`; a pie's slices come from filtering
   the data array itself, since `<Pie>` has no per-slice `hide` prop the way
   `<Area>`/`<Bar>`/`<Line>` do).

10. **Motion between states.** The button cluster used to cut instantly
    between pencil+bin, check+cross, and pencil+armed-check — a state change
    with zero transition, in the middle of a table row. `RowActions.jsx` now
    keys its returned `<div className="row-actions">` by state
    (`key={editing ? 'edit' : deleting ? 'armed' : 'rest'}`), forcing a
    remount on every swap instead of a prop diff, which is what lets the
    `.row-actions .icon-btn { animation: row-action-in … }` rule in
    `index.css` actually fire — a diffed prop change doesn't retrigger a CSS
    animation, a remount does. Entrance only, ~120ms; nothing animates on
    the way out, since a fading-but-still-clickable button is worse than an
    instant cut. Gated behind `prefers-reduced-motion: reduce`.

## Verifying a change to any of this

There is no unit-testable "does the UI look right" — verification here is
Playwright, driven interactively, checking the specific failure modes each
rule above exists to prevent:

- Screenshot the same row in resting and editing state; the two images
  should differ *only* in the row's background tint and the action icons —
  never in field width, border, or the position of any sibling control.
- Open a floating picker on the *last visible row* of a table and confirm it
  flips upward and does not change that row's `getBoundingClientRect()`
  height.
- Inside a picker with a scrollable option list, scroll with the mouse wheel
  and by dragging the scrollbar thumb; the picker must stay open both ways.
- Arm a delete button, wait past `DISARM_MS`, and confirm it reverts to the
  resting bin icon on its own.
- Click a Save/Cancel button (or an ancillary picker trigger) while a field
  is focused and mid-edit; the click must register normally, never get
  eaten by a stray blur-cancel.
