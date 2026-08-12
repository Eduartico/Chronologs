/**
 * The engines that ship with Chronologs, described through the module contract.
 *
 * These are not pluggable and are not meant to be: the rules pass, correlation
 * detection and quote refreshing are the application, not additions to it. They
 * are declared here anyway so that the scheduler, the settings screen and the
 * "run now" button have exactly one kind of thing to iterate over. Before this,
 * `scheduler.js` held a literal object of five entries and every screen that
 * wanted to list them held its own copy of the same five names.
 *
 * Each `scheduledJob` below is the identical function the old registry called,
 * moved rather than rewritten. Anything that reads differently here is a bug.
 */
import { notify } from '../lib/notify.js';

export const BUILTIN_MODULES = [
  {
    id: 'rules',
    kind: 'engine',
    label: 'module.rules.label',
    icon: 'rules',
    schedule: { preset: 'daily', cron: '0 9 * * *' },
    hooks: {
      scheduledJob: async () => {
        const { runRules } = await import('../engines/rules.js');
        const result = await runRules({});
        if (result.categorized > 0 || result.tagged > 0) {
          notify(
            'info',
            'notify.rules.complete',
            { applied: result.categorized, tagged: result.tagged },
            { module: 'rules', ...result }
          );
        }
        return result;
      },
    },
  },

  {
    id: 'correlations',
    kind: 'engine',
    label: 'module.correlations.label',
    icon: 'connections',
    schedule: { preset: 'daily', cron: '30 8 * * *' },
    hooks: {
      scheduledJob: async () => {
        const { runCorrelations } = await import('../engines/correlation.js');
        return runCorrelations();
      },
      // Also runs straight after any ingestion that brought something new: a
      // purchase and the bank debit that paid for it usually arrive minutes
      // apart, and waiting until tomorrow's cron to notice is a day of the
      // review queue showing two rows for one act.
      afterIngest: async (ctx, result) => {
        if (!result.newTransactionIds?.length) return;
        const { runCorrelations } = await import('../engines/correlation.js');
        await runCorrelations();
      },
    },
  },

  {
    id: 'securities',
    kind: 'engine',
    label: 'module.securities.label',
    icon: 'investments',
    hooks: {
      // Order receipts and the statement debits that paid for them arrive in
      // different batches — often different weeks — so reconciliation runs over
      // everything, not only over what this batch brought.
      afterIngest: async (ctx, result) => {
        if (!(result.securityOrders > 0 || result.new > 0)) return;
        const { linkSecurityOrders } = await import('../engines/securities.js');
        const { getProjections } = await import('../projections/cache.js');
        const projections = await getProjections();
        const linked = await linkSecurityOrders(projections.securityOrders, projections.transactions);
        result.securityLinks = linked.linked;
      },
    },
  },

  {
    id: 'quotes',
    kind: 'engine',
    label: 'module.quotes.label',
    icon: 'investments',
    schedule: { preset: 'daily', cron: '0 19 * * 1-5' },
    hooks: {
      // Quotes are the one feature that reaches the internet, and they only run
      // when the user has opted in. The fetcher enforces that itself; reporting
      // the skip rather than throwing is what keeps a disabled feature from
      // filling the notification bell with failures.
      scheduledJob: async () => {
        const { refreshQuotes, quotesEnabled } = await import('../ingestion/quotes/yahoo.js');
        if (!quotesEnabled()) return { skipped: true, reason: 'cotações online desligadas' };
        return refreshQuotes();
      },
    },
  },
];
