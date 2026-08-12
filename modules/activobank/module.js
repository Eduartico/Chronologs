/**
 * ActivoBank — current account, PoupeUp savings account, and the exchange order
 * receipts that arrive as their own mail.
 *
 * Documents arrive two ways: fetched from Gmail by label, or dropped on the
 * connection card by hand. Both go through the same pipeline, because a
 * statement is a statement regardless of how it got here.
 *
 * The instance id is `activobank` and must stay that way — it is the `source`
 * string on some ten thousand events already in the ledger, and the ledger is
 * append-only. Configuring a *second* ActivoBank account (a joint account, a
 * second holder) means a second instance with a new id of its own; this one
 * keeps its history.
 */
/**
 * Nothing heavy at the top of a manifest: every manifest is loaded at startup
 * just to find out what exists, and the PDF stack behind these parsers has no
 * business being resolved before anyone asks for a document.
 */
const ingestion = () => import('./ingest.js');

export default {
  id: 'activobank',
  kind: 'source',
  family: 'bank',
  label: 'module.activobank.label',
  icon: 'accounts',
  multiInstance: true,
  emits: ['transaction', 'security_order', 'document_ingested'],
  schedule: { preset: 'weekly', cron: '0 8 * * 1' },

  /**
   * `profile` is how this institution spells "money left this account", "this is
   * the savings product" and "this was cash at an ATM". Null means the shipped
   * ActivoBank wording (DEFAULT_PROFILE in engines/accounts.js). It lives on the
   * instance rather than in the module so a fork can point this same parser at a
   * bank that words things differently without touching code.
   */
  configSchema: [
    { key: 'gmailLabel', type: 'text', label: 'module.activobank.config.gmailLabel', default: null },
    { key: 'profile', type: 'institutionProfile', label: 'module.activobank.config.profile', default: null },
  ],

  capabilities: {
    sync: async (ctx) => (await ingestion()).ingestActivobank({ ctx, origin: 'gmail' }),

    upload: async (ctx, files) => (await ingestion()).ingestActivobank({ ctx, origin: 'upload', files }),

    // Gmail hands over each message exactly once, so an improved parser would
    // never see the existing mailbox again without this.
    reprocess: async (ctx) => (await ingestion()).reprocessStoredDocuments({ ctx }),

    status: async () => {
      const [{ getStatus }, { loadSyncState }] = await Promise.all([
        import('../../server/lib/googleAuth.js'),
        import('./gmail.js'),
      ]);
      const google = getStatus();
      return {
        connected: google.connected,
        hasCredentials: google.hasCredentials,
        lastSyncAt: loadSyncState().lastSyncAt ?? null,
      };
    },

    /**
     * Re-reads one stored document, with stable ids already on the rows. The
     * duplicate checker and the account backfill both need this, and neither of
     * them should have to know which bank wrote the file they are holding.
     */
    parseDocument: async (ctx, document) => (await ingestion()).parseAndNormalize(document),
  },
};
