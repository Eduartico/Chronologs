# Writing a module

Chronologs is a small core plus modules. A module is one folder under
`modules/`, holding both of its halves — the code that brings data in, and the
card that configures it. Adding a bank means adding a folder. Nothing in
`server/`, `web/` or `package.json` needs editing, and there is no list to
register yourself on.

Start by reading `modules/example-bank/`. It is a complete working bank module
of about a hundred lines, with its own tests, and it is meant to be copied.

```
npm run new:module my-bank      # copies the template and renames it
```

---

## The shape

```
modules/my-bank/
  module.js        the manifest — the contract, and the only required file
  ingest.js        your parser and whatever it needs
  ui.jsx           optional: your own card, when a described one won't do
  i18n/en.js       optional: your own strings
  i18n/pt.js
  my-bank.test.js  run by `npm test` along with everything else
```

## Two kinds of module

**`kind: 'source'`** brings facts into the ledger — a bank, a broker, a crypto
wallet, a marketplace. It declares *capabilities*.

**`kind: 'engine'`** reads what is already there — a scheduled job, an extra
rule condition, a pass over the finished projection. It declares *hooks*. The
rules engine, correlation detection and quote refreshing are engines, declared
in `server/framework/builtins.js` through this same contract.

## Modules and instances

A module is code. An **instance** is that code pointed at one account, with its
own configuration, its own folders, and its own `source` string in the ledger.

```jsonc
// user-data/state/settings.json
"modules": {
  "santander":  { "module": "my-bank", "config": { "profile": { … } } },
  "millennium": { "module": "my-bank", "config": { "profile": { … } } }
}
```

Two accounts at the same institution are two instances of one module. Create one
with:

```
PUT /api/modules/santander/config   { "module": "my-bank", "config": { … } }
```

> **The instance id is permanent.** It is written as `source` onto every event
> that instance produces, and the ledger is append-only. Renaming an instance
> orphans its entire history. Choose the id once and leave it alone. This is
> why Eduardo's ActivoBank instance is called `activobank`: that string is
> already in ten thousand events, and the framework was shaped to fit it.

---

## The manifest

Every field, with what it is for. `server/framework/contracts.js` is the
authority; `validateManifest` there is what rejects a broken one at startup with
a sentence saying which rule it broke.

| Field | Meaning |
|---|---|
| `id` | Lowercase slug, matching the folder name. |
| `kind` | `'source'` or `'engine'`. |
| `family` | `bank`, `broker`, `crypto`, `marketplace`, … `bank` gets institution profiles and internal-transfer pairing. |
| `label` | A **translation key**, never a sentence. |
| `icon` | A name from `web/src/components/Icon.jsx`. Never an emoji. |
| `multiInstance` | Whether more than one account can be configured. |
| `enabledByDefault` | `false` means installed but not configured until asked. Templates use it. |
| `emits` | Event types you write. Checked against what the projections actually read, so a typo is caught rather than silently ignored. |
| `schedule` | The default cron for a new instance. |
| `configSchema` | What an instance needs to know. Drives the generic card. |
| `i18n` | `{ en, pt }` — your own strings. |
| `capabilities` / `hooks` | What can be done with you. |

### Capabilities

Declaring one *is* offering it — the connection card grows exactly the buttons
these earn, and no others. There are no feature flags to keep in sync with
reality.

| Capability | Signature | What it is |
|---|---|---|
| `sync` | `(ctx) => result` | Pull whatever is new. The scheduler runs this. |
| `upload` | `(ctx, files) => result` | Take files the user handed over. |
| `reprocess` | `(ctx) => result` | Re-read stored documents through the current parser. |
| `connect` | `(ctx, input) => result` | Establish or refresh authentication. |
| `status` | `(ctx) => object` | What the card shows. `connected` and `lastSyncAt` are understood; anything else is yours. |
| `parseDocument` | `(ctx, {filename, buffer, date}) => parsed` | Re-read one stored document, **with stable ids on the rows**. |
| `actions` | `{ name: (ctx, input) => result }` | Anything else, reached by name. |

`parseDocument` is worth declaring even for a module that never syncs. It is
what lets the duplicates screen re-read the original document to count how many
times a movement genuinely appears — the strongest signal that screen has — and
what lets the account backfill work.

### Hooks (engine modules)

| Hook | When |
|---|---|
| `scheduledJob` | On a cron, and from the "run now" button. |
| `afterIngest(ctx, result)` | After any source finishes a batch, with that source's result. |
| `afterProjection(projections)` | Over the finished projection, before any route sees it. |
| `ruleConditions` | Extra fields the rules engine can match on. |
| `ruleActions` | Extra things a rule can do when it matches. |

---

## `ctx` — everything you are allowed to touch

Every capability gets one argument.

```js
ctx.instanceId          // 'santander' — also the `source` on your events
ctx.config              // this instance's settings
ctx.paths.documents(…)  // documents/<instance>/…
ctx.paths.browser(sfx)  // browser/<instance>[-suffix] — a Playwright profile
ctx.paths.state(name)   // state/<instance>-<name>.json
ctx.paths.secrets(…)    // secrets/<instance>/… — never logged
ctx.ledger.append(type, payload, links)
ctx.ledger.appendIfNew(type, payload, links)
ctx.ledger.open()       // batch form: one ledger scan, then appendIfNew per row
ctx.notify(level, key, params, meta)
ctx.settings()
ctx.log(…)
```

**Never import `paths.js`, `eventStore.js` or `notify.js` directly, and never
write your own `source` string.** `ctx.ledger` stamps `source = instanceId` for
you, and that single fact is what makes two instances of one module possible
without a line of your code knowing.

Use `ctx.ledger.open()` for a batch. Scanning the whole ledger once per event
turns a full mailbox import into an O(n²) crawl — this is not hypothetical, it
happened here.

---

## The kits: what you get for free

### `framework/kits/documentBank.js`

For anything that reads statements. You supply `fetch` and `parse`; it supplies
everything else, and every piece of it is there because of a real bug:

- **batch ids and stored originals**, so a better parser can be run over the
  same documents later;
- **a content-hash gate**, because banks send the same template mail every
  month — scoped per instance, so one account's history never suppresses
  another's import;
- **a cross-document-kind window**, because a movement is reported once by its
  advice note on the day and again by the monthly statement, worded differently
  and dated a few days apart — scoped per instance, because two banks can
  perfectly well book the same amount on the same day;
- **one ledger scan per batch**, not per transaction;
- **the document reference in `linked_entities`**, not in the payload, so the
  same movement seen in two documents hashes the same and stays one fact;
- **running the rules** over what is new, then every `afterIngest` hook;
- **filing the batch away** and saying what happened.

```js
import { ingestDocuments, storedDocuments } from '../../server/framework/kits/documentBank.js';

export async function ingestFiles(ctx, files) {
  return ingestDocuments(ctx, {
    origin: 'upload',
    files,
    parse: async ({ buffer }) => parseStatement(buffer.toString('utf-8')),
    normalize: (rows) => rows.map((r) => ({ ...r, transaction_id: idFor(ctx, r) })),
    notifyKeys: { sync: 'notify.myBank.import' },
  });
}
```

### `framework/kits/browserSource.js`

For a site with no API. Persistent profile, a real installed Chrome or Edge
rather than the bundled Chromium (Cloudflare's integrity check fails the latter
for reasons unrelated to automation intent), challenge detection, and a
wait-for-a-human login loop. You supply the login URL and what a logged-in page
looks like.

---

## Two things to get right

### 1. The transaction id

The single most important decision a module makes. It is the movement's identity
for the rest of its life: categories, tags, manual corrections and duplicate
verdicts are all keyed to it.

Derive it **only from what the document says**, so the same document read again
in five years produces the same id:

```js
const digest = createHash('sha1')
  .update(`${tx.date}|${tx.amount.toFixed(2)}|${tx.description}`)
  .digest('hex').slice(0, 10);
return `${ctx.instanceId}-${tx.date}-${digest}`;
```

Never a timestamp, never a random value, never a row number, never anything
derived from the filename. Include the instance id, so two accounts at the same
bank cannot collide.

### 2. The institution profile

Chronologs recognises money moving between your own accounts by matching the
descriptor against five regular expressions. Get these wrong and **every
transfer between your own accounts is counted as real spending** — an error that
once read €13.293 too high in this very ledger.

They live in an instance's `config.profile`, editable from the interface, so a
fork points the same code at a differently-worded bank without touching code.
`null` means the shipped ActivoBank wording, which is almost certainly wrong for
anyone else.

| Key | What it must match |
|---|---|
| `transferOut` | The prefix on "money left this account towards X". |
| `transferIn` | The prefix on "money arrived from X". |
| `savingsProduct` | How the savings product names itself in a descriptor. |
| `savingsAccount` | How the savings *account* is labelled on a statement. |
| `cashWithdrawal` | Cash taken out at an ATM. |

To find yours: open a statement, find one transfer between your own accounts,
and write the regex that matches the words in front of the counterparty. The
preview on the Rules screen reports how many internal movements a candidate
profile finds, over your real data, before you save it.

---

## The interface

A module that declares a `configSchema` gets a card drawn from it by
`ModuleCard`, which already obeys every rule this codebase has: colours from
theme tokens, dates through `format.js`, icons rather than emoji, status shown
as a word as well as a dot, and every string a translation key. **Take this
path.** None of that is knowledge you should have to acquire to add a bank.

Ship `modules/<id>/ui.jsx` with a default-exported component only when the card
genuinely cannot be described — ActivoBank's OAuth flow and Pricempire's
portfolio picker both qualify. If you do:

- import from `web/src/` freely — that is how you get `Icon.jsx`, `format.js`,
  `Value.jsx` and the translator;
- **never write a colour literal.** There are seventeen themes for it to be
  wrong in, and `contract.test.js` fails on one;
- **never use an emoji as an icon.** They carry their own colour and render
  differently per platform;
- financial values go through `Value.jsx`, which encodes direction three
  independent ways.

## Strings

Two locales, `en` and `pt`. Put your keys in `modules/<id>/i18n/`; the browser
globs them, the server reads them from your manifest's `i18n` field, and core
keys win a collision. Every key must exist in **both** languages — one that
exists in only one shows a raw key on screen in the other, and the contract test
fails.

Notifications are stored as `{key, params}` and rendered whenever they are
opened, so they read in whatever language is current *then*. Each needs a
`.title` and a `.body`.

The Portuguese catalogue is deliberately pre-AO90 — "transacções",
"actualizar", "correcção". That is the user's register, not a typo, and
`i18n.test.js` fails if post-1990 spellings appear.

---

## Proving it works

```
npm test                  # your module's tests, the contract check, everything
npm run build             # your card compiles
npm run snapshot:verify   # nothing you did changed anything that already worked
```

`contract.test.js` validates every installed manifest: unique id matching its
folder, capabilities that are functions, `emits` that something reads, an icon
that exists, labels present in both languages, no colour literals.

Write tests for your parser. `modules/example-bank/example-bank.test.js` is the
shape: the parser reads a statement and keeps what it could not, decimals are
read as one number rather than scaled by a thousand, ids depend only on the
document, an upload projects as transactions, the same file twice adds nothing,
and two instances keep separate ledgers.

The last one matters more than it looks. Most of what goes wrong with a second
account goes wrong silently.
