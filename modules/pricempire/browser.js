/**
 * The Pricempire session: what is actually specific to this site.
 *
 * The persistent profile, the real-Chrome channel fallback, the Cloudflare
 * challenge detection and the wait-for-a-human login loop now live in
 * framework/kits/browserSource.js and are shared by any source that has to be
 * read through a browser. What is left is where to log in, what a logged-in
 * page looks like, and what this site's notifications say.
 */
import { createContext } from '../../server/framework/context.js';
import { createBrowserSource } from '../../server/framework/kits/browserSource.js';
import { PRICEMPIRE } from './selectors.js';

const ctx = createContext({ id: 'pricempire', module: 'pricempire', config: {} });

const session = createBrowserSource(ctx, {
  loginUrl: PRICEMPIRE.portfolioUrl,
  loggedInSelectors: PRICEMPIRE.loggedInSelectors,
  loggedOutUrlPatterns: PRICEMPIRE.loggedOutUrlPatterns,
  label: 'Pricempire',
  defaultState: { selectedPortfolios: [], lastSync: null },
  // `state/pricempire.json`, not the framework's `state/pricempire-session.json`:
  // this file predates modules and already holds the selected portfolios. New
  // modules take the default and never see this option.
  stateFile: () => ctx.paths.stateFile('pricempire.json'),
  channelEnvVar: 'PRICEMPIRE_BROWSER_CHANNEL',
  notifyKeys: {
    noBrowser: 'notify.pricempire.noBrowser',
    sessionExpired: 'notify.pricempire.sessionExpired',
    challenge: 'notify.pricempire.challenge',
  },
});

export const loadPricempireState = session.loadState;
export const savePricempireState = session.saveState;
export const getContext = session.getContext;
export const ensureSession = session.ensureSession;
export const closeBrowser = session.close;
export const activeBrowserChannel = session.activeChannel;
