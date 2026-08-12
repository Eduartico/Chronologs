/**
 * A complete, working bank module in about a hundred lines.
 *
 * This is the file to copy. It is not a sketch: enable an instance of it, drop a
 * CSV on its card, and the movements land in the ledger, get categorised by the
 * rules engine, show up in the charts and count towards the vault reconciliation
 * exactly like ActivoBank's do. `example-bank.test.js` next door proves it.
 *
 * It is installed but has no instance of its own — `enabledByDefault: false` —
 * so it stays out of your connections screen and out of your ledger until you
 * ask for it. Asking for it is the same request as adding a second bank:
 *
 *   PUT /api/modules/my-bank/config  { "module": "example-bank" }
 *
 * Read `docs/modules.md` alongside this.
 */

// Nothing heavy at the top of a manifest: every manifest is loaded at startup
// just to find out what exists, so the parser is imported when it is needed.
// The catalogues are two plain objects and are cheap enough to import outright.
import en from './i18n/en.js';
import pt from './i18n/pt.js';

const ingestion = () => import('./ingest.js');

export default {
  /**
   * Permanent. This is the module's name; an instance of it gets an id of its
   * own, and *that* is what is written as `source` on every event. Renaming an
   * instance orphans its history, because the ledger is append-only.
   */
  id: 'example-bank',

  /** 'source' brings data in. 'engine' reads what is already there. */
  kind: 'source',

  /**
   * What sort of thing this is. `bank` is the one the framework treats
   * specially: bank instances carry an institution profile, and their internal
   * transfers are paired with each other's.
   */
  family: 'bank',

  /** A translation key, never a sentence. Defined in ./i18n/. */
  label: 'module.exampleBank.label',

  /** A name from web/src/components/Icon.jsx. Never an emoji. */
  icon: 'accounts',

  /** Two accounts at this institution means two instances of this module. */
  multiInstance: true,

  /** Installed, but not configured until someone asks. Delete this line in a real module. */
  enabledByDefault: false,

  /** Every event type this module can write. Checked against what projections read. */
  emits: ['transaction', 'document_ingested'],

  /** The default cron for a new instance. The user can change it in Settings. */
  schedule: { preset: 'daily', cron: '0 7 * * *' },

  /**
   * What an instance needs to know, and what the generic card renders.
   *
   * `institutionProfile` is a type the framework understands: five regular
   * expressions saying how *this* bank words "money left this account", "this is
   * the savings product" and "this was cash at an ATM". Leave it null and the
   * shipped ActivoBank wording is used, which is almost certainly wrong for
   * anyone else — see docs/modules.md for how to find yours.
   */
  configSchema: [
    { key: 'profile', type: 'institutionProfile', label: 'module.exampleBank.config.profile', default: null },
  ],

  /** Strings this module brings. Merged into the catalogue; core keys win. */
  i18n: { en, pt },

  /**
   * What can be done with this module. Declaring one is offering it: the
   * connection card grows exactly the buttons these earn, and nothing else.
   */
  capabilities: {
    /**
     * Take files the user dropped on the card.
     *
     * The whole pipeline behind this — batching, keeping the originals, not
     * ingesting the same file twice, not counting a movement twice when two
     * documents report it, running the rules over what is new — comes from
     * `framework/kits/documentBank.js`. This module supplies a parser.
     */
    upload: async (ctx, files) => (await ingestion()).ingestFiles(ctx, files),

    /** Re-read everything already stored, through the current parser. */
    reprocess: async (ctx) => (await ingestion()).reprocessStored(ctx),

    /**
     * Read one stored document, with stable ids already on the rows.
     *
     * Worth declaring even for a module with no automatic sync: it is what lets
     * the duplicates screen re-read the original to count how many times a
     * movement really appears, and what lets the account backfill work.
     */
    parseDocument: async (ctx, document) => (await ingestion()).parseAndNormalize(document),

    /** What the card shows. Everything here is this module's own business. */
    status: async (ctx) => {
      const { lastImport } = (await ingestion()).readState(ctx);
      return { connected: true, lastSyncAt: lastImport ?? null };
    },
  },
};
