# Customizable dashboard

**Date:** 2026-09-10
**Status:** built and merged, 2026-09-10. See “Where the build departed from this” at the foot.

## The problem

The dashboard is a fixed page. Ten charts sit in hardcoded grid rows in a
677-line `Dashboard.jsx`, and the only thing the reader controls is which of
two shapes each one draws in — a choice that is forgotten when the tab closes,
because it lives in `sessionStorage`.

Six specific complaints motivated this work, and each one is answered below:

1. Two menus do one job. A card carries a "lines / bars" segmented control
   *and*, separately, a "chart / table" pair. They both answer "how do I want
   to look at this", and there is no reason for them to be different controls.
2. The dashboard is nearly percentage-free. It shows income and spending as
   two absolute numbers and leaves the reader to work out the net and the share
   in their head.
3. View preferences do not survive a restart.
4. "Spending by category over time" is unreadable. It is an uncapped stack, so
   twenty categories become twenty bands, most of them hairlines.
5. Some ranked views are not ranked — the breakdown bar chart draws categories
   in whatever order the server returned.
6. Four charts answer the same question in four cards: "Where the spending
   goes", "Where the money went", "Spending by area" and "Categories and their
   groups" are all *how is my spending divided up*. They are separate cards
   only because each one was built as an experiment beside the last.

And the names are descriptions, not names. "Where the spending goes" is a
sentence about a chart; it is not what the chart is called.

## What is being built

A dashboard where every chart is a node the reader placed: added, removed,
resized, reordered, duplicated, and set to whichever view they prefer — with
all of that stored on the server so it survives a restart, a cache clear and a
different browser.

---

## 1. The layout model

`server/lib/settings.js` gains a top-level `dashboard` block, a sibling of
`appearance` and `experimental`:

```json
"dashboard": {
  "nodes": [
    { "id": "a3f1c2", "widget": "cashflow",  "view": "line",  "size": 1 },
    { "id": "b7c204", "widget": "breakdown", "view": "table", "size": 1 }
  ]
}
```

Three fields carry the whole feature.

**`id`** is a random handle, generated with `crypto.randomUUID().slice(0, 8)`,
and it is deliberately *not* the widget name. That is what makes duplicates
work: two nodes can both be `breakdown`, one showing a pie and one showing the
same numbers as a table, and the layout can still tell them apart when one is
dragged or deleted.

**`view`** is a property of the node, not of the widget kind and not of the
browser. This is the whole of "remember which visualisation I like" — there is
no separate preference store, because the preference *is* the node. It also
means the two duplicate `breakdown` nodes above genuinely can differ, which a
per-widget preference could not express.

**`size`** is `1`, `2` or `4`:

| size | occupies |
|---|---|
| 1 | one column — half a row |
| 2 | both columns — a full row |
| 4 | both columns, two rows tall |

Nothing else is stored. There is no `options` object held in reserve: a
per-widget setting that does not exist yet should not have a slot waiting for
it.

`loadSettings()` needs its own merge line for `dashboard`, one level deep like
every other block. `settings.test.js` already fails when a top-level key is
left out of that merge, which is exactly the failure this guards against — a
key that survives a full write and vanishes on a partial one looks like a
frontend bug and is not one.

A node naming a widget the catalogue does not define is skipped at render time
rather than throwing, and a node whose `view` is not in its widget's list falls
back to that widget's `defaultView`. A hand-edited settings file, or one written
by a version that had a widget this one has since dropped, must not take the
whole dashboard down with it.

Writes are debounced by roughly 600ms and optimistic: the grid moves first and
the `PUT /settings` follows, the same way the Settings page already handles a
theme click. A layout that waited on a round trip before the card moved would
feel broken during a drag.

---

## 2. The widget catalogue

A new `web/src/dashboard/catalogue.js` holds one entry per widget kind, in the
spirit of `server/framework/builtins.js`: the add-node picker, the renderer and
the test all iterate one list rather than each holding a copy of the same eight
names.

```js
{
  id: 'breakdown',
  icon: 'chartPie',
  views: ['pie', 'bar', 'treemap', 'sunburst', 'table'],
  defaultView: 'pie',
  defaultSize: 1,
}
```

Nothing user-visible lives in the file. The name and the sentence under it are
`widget.<id>.name` and `widget.<id>.desc` in the catalogues, and each view's
label is `view.<id>`.

| Widget | Views | Absorbs |
|---|---|---|
| `cashflow` | line, bar, table | — (gains a net series) |
| `balance` | area, line, waterfall, table | "How the balance got here" |
| `trend` | stacked, share, stream, table | "Categories over time" |
| `breakdown` | pie, bar, treemap, sunburst, table | "Spending by area", "Categories and their groups" |
| `merchants` | bar, table | — |
| `savings` | line, table | — |
| `flow` | sankey, table | — |
| `calendar` | heatmap, table | — |

The consolidations are not arbitrary tidying. A waterfall *is* the running
balance decomposed into its per-period steps — the same series, drawn as
increments rather than as a level — so it is a view of `balance`, not a chart
of its own. A streamgraph is the category stack with a centred baseline, so it
is a view of `trend`. A treemap and a sunburst are the breakdown pie with
rectangles and rings instead of slices.

The Sankey stays its own widget. It looks like it belongs with the breakdown
family and does not: it draws income, through the accounts that held it, into
what it paid for — three columns of a flow, not a share of a single total. Its
table has different columns and its numbers answer a different question.

### Retiring the experiment flags

`web/src/experiments.js`, the `experimental` block in settings, and the
Experimental Charts panel in Settings are all deleted. The flags existed so a
chart could be judged in use rather than argued about, and so a losing chart
could be removed without an archaeology dig. The add/remove gesture now does
both jobs directly, and keeping the flags would mean two places to turn the
same chart on.

`web/src/lib/experiments.test.js` is replaced by `web/src/lib/dashboard.test.js`,
which does the same job for the new registry: it fails if a catalogue entry has
no name or description in the shipped catalogues, an icon `Icon.jsx` does not
draw, a view with no label, or a widget id that the server's default node list
references and the catalogue does not define.

`TransferChord` is the one experiment that does not become a dashboard widget —
it charts traffic between the current account and its vaults, which is accounts
data, not dashboard data. It stays on the Accounts page and is now mounted
unconditionally, its flag having gone.

---

## 3. Names

A name identifies; a description explains. The current titles do the second job
in the first job's slot, so the cards are hard to talk about and impossible to
list in a picker. Names move to the title, descriptions to the subtitle.

| Now | Becomes | Subtitle |
|---|---|---|
| Income and spending | **Cashflow** | Income against spending, per {period} |
| Running balance | **Running balance** | Each period's balance, added up |
| Spending by category over time | **Category trend** | Where spending shifted, month by month |
| Where the spending goes | **Spending breakdown** | Share of spending by category |
| Where you spend most | **Top merchants** | The ten you paid most |
| Savings rate | **Savings rate** | Share of income left over in each period |
| Where the money went | **Money flow** | Income, through accounts, into what it paid for |
| Spending by day | **Spending calendar** | One square per day, darker where more went out |
| Between your own accounts | **Account transfers** | Traffic between the current account and each vault |
| Spending by area | *removed* | a view of Spending breakdown |
| Categories and their groups | *removed* | a view of Spending breakdown |
| Categories over time | *removed* | a view of Category trend |
| How the balance got here | *removed* | a view of Running balance |

"Running balance" and "Savings rate" are unchanged because they were already
names.

---

## 4. One toggle, not two

`ChartCard`'s chart/table button pair is deleted, along with the
`usePersistentState` call behind it. `ChartTypeToggle` is renamed `ViewToggle`
and takes the node's whole `views` array; `table` is one more icon in the same
segmented control as `line` and `bar`.

`ChartCard` keeps accepting `view` and `onViewChange` as props. When they are
absent it falls back to its existing `storageKey` behaviour, so the Investments
page — which is not a dashboard node — is untouched by this change. The `table`
option is merged into the single toggle in both cases.

The accessible fallback does not change. The table is still rendered inside
`.sr-only` whenever a chart is showing, because an SVG of `<path>` elements says
nothing to a screen reader regardless of which control switched to it.

---

## 5. The grid

```css
.dash-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
}
```

- size 1 — one column
- size 2 — `grid-column: span 2`
- size 4 — `grid-column: span 2; grid-row: span 2`

`minmax(0, 1fr)` rather than `1fr`: a recharts `ResponsiveContainer` in a `1fr`
track will not shrink below its content's intrinsic width, so a wide chart
pushes the column instead of fitting it.

Below 720px the grid collapses to a single column and every span resets to 1 —
a half-width card at phone width is not readable, and a two-row-tall one is a
scroll trap.

Chart height derives from size rather than being stored: 280px at size 1, 300px
at size 2, 620px at size 4. Storing a height would let a node exist at a size
its height contradicts.

---

## 6. Editing a node

This follows the `inline-table-editing` skill, reusing its four primitives
rather than growing a fifth bespoke copy of each. A dashboard node is a row: it
is at rest, or being edited, or armed for deletion, and never two of those.

- **`useRowEditor`** owns the state machine and the 1000ms disarm timer,
  unchanged.
- **`IconButton`** carries the `onMouseDown` guard, so clicking a control
  beside an active edit does not blur-cancel it.
- **`Popover`** portals the widget picker to `document.body` with the
  flip-when-there-is-no-room-below and the scroll-close fix. A picker rendered
  inline in a card would resize the card it opened from, which is precisely the
  bug that primitive exists to prevent — and on a dashboard it would reflow the
  grid.
- The control cluster is **keyed by state** so React remounts it, which is what
  makes the CSS entrance animation play on every swap.

The gesture:

- A pencil sits in the card's top-right, beside the view toggle, at rest.
- Clicking it tints the card faintly — the card's own background is the only
  signal that it is live — and the control cluster remounts into: the widget
  picker trigger, a three-icon size control, move-left and move-right, a bin,
  and confirm/cancel.
- The bin arms in place. It becomes a tick in the identical position, and a
  second press there removes the node. The pencil stays visible but disabled
  while armed, so someone who armed by mistake still sees a way out.
- Motion is entrance-only and gated behind `prefers-reduced-motion`. A button
  that lingers while fading is a button that can still be clicked, which means
  the wrong action if the next click lands where the old one was.

### One deliberate deviation from the skill

Skill §3 prescribes a blanket `!important` rule stripping borders and outlines
from every `input` and `select` in the app. That rule is **not** re-added here.
It was tried in Chronologs, and it made every input invisible on light themes
and suppressed the focus ring application-wide; CLAUDE.md now forbids it by
name. Chromelessness stays scoped to the `.editable` and `input.bare` classes,
which is the same outcome reached without the collateral damage.

---

## 7. Reordering

Cards are draggable **by their header only**. Making the whole card a drag
source would fight every interaction inside it — clicking a legend entry to
hide a series, hovering to isolate one, selecting a number out of a table.

HTML5 drag events carry the node id in `dataTransfer`. Each card and the grid's
tail are drop targets, with insert-before semantics and a visible gap where the
card will land.

The reflow animates with FLIP — measure every card's rect before the state
change, measure again after, and play the difference back with
`element.animate()`. A CSS `transition` cannot do this: grid items do not
transition when the track assignment changes underneath them. Roughly forty
lines, and gated behind `prefers-reduced-motion` like every other decoration.

Drag alone is not accessible. The move-left and move-right buttons in the edit
cluster are the keyboard path, and they are the reason those two buttons exist.

---

## 8. The add-node button

A node-shaped button, always last in the grid, spanning both columns at about
half the height of a real card: dashed border, transparent fill, a large `+`
centred.

Clicking it appends a node using the first catalogue widget at `size: 1`,
already in edit mode with its widget picker open. Picking a widget from that
picker is then the first thing the reader does.

It deliberately does not create an "unconfigured" node. A node with a null
widget would have to be tolerated by the server's merge, by the renderer, and
by anything that ever reads the layout — an invalid state persisted to disk in
exchange for nothing, since the picker opens either way.

---

## 9. Readability and percentages

### Category trend

Four changes, all client-side:

- **Capped to the top 8 categories plus "Other"**, using the same `capSeries`
  the breakdown pie already uses. This is the root cause of the complaint: the
  stack is currently uncapped, so a ledger with twenty categories draws twenty
  bands and most of them are hairlines.
- **Bands ordered by total, largest on the baseline.** They are currently drawn
  in whatever order the server returned. The band a reader actually tracks
  should sit on the flat axis rather than riding on top of five others.
- **A `share` view**, 100% stacked. The absolute stack genuinely cannot answer
  "is groceries growing, or is everything growing" — every band rises when the
  total does.
- **Direct labels at the right edge** of each band, so a category is read where
  it is drawn instead of matched to a legend swatch.

All four happen in the frontend, so `/analytics` stays byte-identical and
`npm run snapshot:verify` should report no differences.

### Sorting

The breakdown bar view sorts descending by value. It currently does not, which
makes a ranked chart that is not ranked.

### Percentages

- **Summary tiles** gain the net figure and the savings rate, and the change
  against the previous equivalent period.
- **Breakdown** gains share-of-total on slice labels and as a table column.
- **Top merchants** show each merchant's share of total spending beside the
  amount.
- **Cashflow** gains a net series — income minus spending per period — and a
  net total, so "did I make money this month" is on the chart rather than
  arithmetic the reader does themselves.

Every one of these goes through `Value.jsx`. Shares pass `symbol="none"`: a
category being 30% of spending is not a gain or a loss, and colouring it as one
says something the data does not.

---

## 10. File layout

`Dashboard.jsx` currently holds the page furniture, ten chart definitions and
every piece of state behind them. It drops to roughly 180 lines — header,
filter bar, summary tiles, and `<DashboardGrid>` — with each widget in its own
file.

```
web/src/dashboard/
  catalogue.js           the widget registry
  useDashboardLayout.js  node list, server persistence, add/remove/move/resize/setView
  DashboardGrid.jsx      the grid, drag and drop, FLIP, the add button
  DashboardNode.jsx      one card: header controls, edit state, size and widget pickers
  widgets/
    Cashflow.jsx  RunningBalance.jsx  CategoryTrend.jsx  SpendingBreakdown.jsx
    TopMerchants.jsx  SavingsRate.jsx  MoneyFlow.jsx  SpendingCalendar.jsx
```

The existing components under `web/src/components/charts/experimental/` move
into `widgets/` and become views of the widget that absorbed them.
`TransferChord.jsx` stays where it is, since it remains an Accounts-page chart.

Data flow is unchanged in shape. The page fetches `/analytics` once and passes
the result down; `MoneyFlow` and `SpendingCalendar` keep fetching their own
aggregates from `/analytics/flow` and `/analytics/daily`, so a layout with
neither node makes neither request.

The filter bar and the three summary tiles stay fixed above the grid. They are
not nodes: they drive every node beneath them, so a layout that removed the
filter bar would leave the rest of the dashboard unsteerable.

---

## 11. This installation's layout

The shipped default in `DEFAULT_SETTINGS` is the six core charts in today's
arrangement — a fair default for a fresh install, which has no experiments
switched on.

This user has all seven experiment flags on, so their current dashboard is
twelve charts. Their `user-data/state/settings.json` gets its own `dashboard.nodes`
list reproducing exactly that, with the consolidations arriving as duplicate
nodes:

| Position | Node | size |
|---|---|---|
| 1 | `cashflow`, view `line` | 1 |
| 2 | `balance`, view `area` | 1 |
| 3 | `trend`, view `stacked` | 2 |
| 4 | `breakdown`, view `pie` | 1 |
| 5 | `merchants`, view `bar` | 1 |
| 6 | `savings`, view `line` | 2 |
| 7 | `flow`, view `sankey` | 2 |
| 8 | `balance`, view `waterfall` | 2 |
| 9 | `trend`, view `stream` | 2 |
| 10 | `breakdown`, view `treemap` | 1 |
| 11 | `breakdown`, view `sunburst` | 1 |
| 12 | `calendar`, view `heatmap` | 2 |

Nodes 8 through 11 are the four retired experiments arriving as duplicates of
the widgets that absorbed them, which is the duplicate-node feature doing real
work on its first day.

The shipped defaults are not edited to produce this. Defaults describe a fresh
install; this is one user's data, and it belongs in `user-data/`.

---

## 12. Verification

- `npm test` — includes the new `dashboard.test.js` and the updated
  `settings.test.js` and `i18n.test.js`.
- `npm run build`.
- `npm run snapshot:verify` — expecting zero differences. Every behavioural
  change here is client-side; a diff in `/analytics` would mean something moved
  to the server that should not have.
- Playwright, twice: Guardian and Calus's Selected. This touches card
  chrome, an editing tint and a dashed placeholder, all of which are theming
  surfaces, and a dark-rail-on-dark-page theme and a light-rail-on-white one
  are the two extremes.
- Playwright checks specifically: drag reorder persists across a reload; a
  duplicate node holds a different view from its twin; a size-4 node spans two
  rows; the armed bin reverts on its own; the grid collapses to one column
  under 720px.

### The i18n cost

Fourteen catalogues need roughly thirty new keys each — eight widget names,
eight descriptions, eleven view labels, and the edit-mode labels — and the
`settings.experimental.*` and `experimental.*` keys come out. `i18n.test.js`
names every key a catalogue is missing, and the plural test holds each one to
the categories `Intl.PluralRules` actually selects. This is the largest
mechanical chunk of the work and it is unavoidable given the rename.

`pt.js` stays pre-AO90.

---

## Where the build departed from this

Four decisions changed once the thing was on screen. They are recorded here
rather than edited into the text above, so the spec stays a record of what was
agreed and this stays a record of what survived contact.

**The view switch is hidden while a card is being edited.** §6 had the pencil
sitting beside the view toggle and the cluster swapping around it. In practice a
size-1 card then carried twelve buttons in one header, which wrapped to a second
line and — because `.chart-head` was `space-between` — left the card's own title
stranded in the middle of the page. The cluster now *replaces* the view switch,
which is what §6 said about every other control and should have said about this
one. `.chart-head` holds its controls right with an auto margin instead, so a
wrap no longer moves the title.

**The period-on-period figure measures spending, not the net.** §9 put a change
against the previous period on the summary tiles without saying which number it
was a change *in*. Computed on the net it read "1,839.1% against the period
before" on real data, because the net crosses zero routinely — one month of
tuition against one of salary — and a percentage change across zero is
arithmetic rather than information. It sits on the Spending tile now, where the
quantity is always positive and always comparable.

**The direct labels are one layer, not a `LabelList` per band.** §9 asked for
labels at the right edge of each band and did not say how. A `LabelList` only
knows about its own series, so four thin bands at the top of the stack printed
four names on top of each other. They are drawn through recharts' `Customized`,
which hands over the real axis scales — so the stack is re-walked once, every
label's position is known at the same time, and the column can be spread apart
where it is crowded.

**The calendar keeps its own height.** §5 derives every card's height from its
size. A calendar cannot spend extra room: a day is a fixed 12px square and a
long range scrolls sideways rather than growing, so the size-2 height left a
hundred and sixty pixels of empty ground under the squares. It is the only card
that overrides the size-derived height, and it is the only one whose content has
a natural size.

## What was found while building it, and fixed

Three bugs, all older than this work, all in code the dashboard leans on.

- **`Value` with `symbol="none"` coloured anyway.** It dropped the `+`/`−` and
  kept the hue and the weight, so a column of expenses came out green because
  the amounts happened to be positive. "This number has no direction" now means
  all three encodings, not two of them.
- **`Popover` threw on every resize.** Its scroll handler is reused as the
  resize listener, and a resize event's target is `window` — which
  `Node.contains()` refuses outright rather than returning false. The panel
  never closed on a resize and an uncaught TypeError went to the console each
  time.
- **The debounced layout write was cancelled on unmount rather than flushed.**
  Dragging a card and clicking another page inside the 600ms window threw the
  move away with no error anywhere. It flushes on unmount and on
  `visibilitychange` now. The mutations also read the node list from a ref
  updated synchronously by `commit`, so two gestures inside one frame compose
  instead of the second overwriting the first.

A fourth was found by a test written for the occasion:
`web/src/lib/i18nKeys.test.js` checks that every literal `t('key')` in the source
resolves. `i18n.test.js` holds the fourteen catalogues to each other and cannot
see a key that no catalogue has — `t()` returns the key itself, so the failure is
a raw dotted name on screen that survives every other check. It immediately found
`widget.calendar.title` on the spending calendar's SVG label.
