/**
 * Pricempire — a CS2 skin portfolio, read through a real browser.
 *
 * There is no API, so a persistent Playwright profile holds the login and the
 * Cloudflare cookie. Syncing downloads each selected portfolio's own CSV export
 * and imports that; scraping the rendered page is the fallback, and says so,
 * because a silent downgrade to worse data is the failure hardest to notice.
 *
 * Kept as its own module rather than folded into a generic "marketplace" one:
 * the export format and the session dance are specific to this site, and
 * pretending otherwise would produce an abstraction with exactly one member.
 *
 * Single-instance on purpose, and the capabilities below therefore do not thread
 * `ctx` through to the ingestion code the way a bank module does. That code
 * writes two distinct source strings — `pricempire` for scraped holdings and
 * `pricempire-csv` for imported exports — and both are already in the ledger and
 * are read by name in engines/portfolio.js. Rewriting them to one instance id
 * would silently split the portfolio in half at the changeover.
 */
/**
 * Nothing heavy is imported at the top of a manifest.
 *
 * Every manifest is loaded at startup to find out what exists, and this one
 * pulls in Playwright — thirteen seconds of it, on every boot and in every test
 * run, for a browser that most of the time is never launched. Capabilities
 * import what they need when they are called.
 */
const ingestion = () => import('./ingest.js');
const browser = () => import('./browser.js');

export default {
  id: 'pricempire',
  kind: 'source',
  family: 'marketplace',
  label: 'module.pricempire.label',
  icon: 'gaming',
  multiInstance: false,
  emits: ['transaction', 'investment_transaction', 'asset_snapshot', 'price_update'],
  schedule: { preset: 'every6h', cron: '0 */6 * * *' },

  configSchema: [
    {
      key: 'selectedPortfolios',
      type: 'list',
      label: 'module.pricempire.config.portfolios',
      default: [],
    },
  ],

  capabilities: {
    sync: async () => (await ingestion()).syncPricempire(),

    upload: async (ctx, files) => {
      const [file] = files;
      if (!file) throw new Error('no file');
      const { importPricempireCsv } = await import('./importer.js');
      return importPricempireCsv(file.buffer, { filename: file.filename });
    },

    connect: async () => {
      const { ensureSession } = await browser();
      await ensureSession({ interactive: true });
      return { sessionOk: true };
    },

    status: async () => (await browser()).loadPricempireState(),

    actions: {
      /**
       * Listing portfolios drives a browser through a Cloudflare check and a
       * `networkidle` wait — around ten seconds. The result is cached, and only
       * refreshed when asked, because doing that on every page visit made
       * choosing a portfolio feel broken.
       */
      portfolios: async (ctx, { refresh = false } = {}) => {
        const { loadPricempireState, savePricempireState } = await browser();
        const state = loadPricempireState();
        if (!refresh && Array.isArray(state.portfolios)) {
          return { portfolios: state.portfolios, fetchedAt: state.portfoliosFetchedAt ?? null, cached: true };
        }
        const portfolios = await (await ingestion()).fetchPortfolioList();
        const fetchedAt = new Date().toISOString();
        savePricempireState({ portfolios, portfoliosFetchedAt: fetchedAt });
        return { portfolios, fetchedAt, cached: false };
      },

      selectPortfolios: async (ctx, { selected }) => {
        if (!Array.isArray(selected)) throw new Error('selected must be an array');
        return (await browser()).savePricempireState({ selectedPortfolios: selected });
      },

      /** The old scraper, kept reachable for debugging a broken export. */
      scrape: async () => (await ingestion()).ingestPricempire(),
    },
  },
};
