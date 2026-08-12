/**
 * A logged-in browser session, for sources that have no API.
 *
 * Plenty of what a portfolio site or an exchange without an API needs is not
 * about that site at all: keeping a persistent profile so the login survives a
 * restart, driving a *real* installed Chrome or Edge rather than the bundled
 * Chromium, recognising a Cloudflare interstitial, telling "still solving the
 * challenge" apart from "logged out", and waiting for a human to finish signing
 * in without spinning forever. All of that is here.
 *
 * What stays with the module is the five things only it knows: where to log in,
 * what a logged-in page looks like, what a logged-out URL looks like, and what
 * its notifications say.
 *
 * Sessions are held per instance, so two configured accounts on the same site
 * get two profiles and never see each other's cookies.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Playwright's bundled Chromium fails Cloudflare's browser-integrity check for
 * reasons that have nothing to do with automation intent — it ships no Chrome
 * branding, renders WebGL through SwiftShader instead of the real GPU, and
 * advertises itself via --enable-automation — so the challenge never clears
 * even when a human is the one clicking it. Driving a normally installed
 * browser gives the challenge something real to measure.
 */
const CHANNELS = ['chrome', 'msedge', 'chrome-beta', 'msedge-beta'];

const LAUNCH_ARGS = [
  // Drops navigator.webdriver, which is the flag the challenge keys on.
  '--disable-blink-features=AutomationControlled',
  '--start-maximized',
];

/** Cloudflare's interstitial, so a challenge is not mistaken for a logout. */
const CHALLENGE_MARKERS = [
  '#challenge-form',
  '#cf-challenge-running',
  'iframe[src*="challenges.cloudflare.com"]',
];

/** One live browser per instance, so closing one does not close another's. */
const sessions = new Map();

export async function closeAllBrowsers() {
  for (const session of sessions.values()) await session.close();
}

/**
 * @param ctx                   the instance context
 * @param loginUrl              where a session is established and checked
 * @param loggedInSelectors     any one visible means signed in
 * @param loggedOutUrlPatterns  any one present in the URL means signed out
 * @param stateFile             where session state lives; defaults to the
 *                              instance-scoped file, overridable for a module
 *                              whose state file predates the framework
 * @param notifyKeys            { noBrowser, sessionExpired, challenge }
 */
export function createBrowserSource(
  ctx,
  {
    loginUrl,
    loggedInSelectors = [],
    loggedOutUrlPatterns = [],
    defaultState = {},
    stateFile = () => ctx.paths.state('session'),
    // How the site names itself in an error a person reads. The instance id is
    // a lowercase slug and reads like one.
    label = ctx.instanceId,
    channelEnvVar = null,
    locale = 'pt-PT',
    timezoneId = 'Europe/Lisbon',
    notifyKeys = {},
  }
) {
  let context = null;
  let activeChannel = null;

  function loadState() {
    const file = stateFile();
    if (!existsSync(file)) return { ...defaultState, sessionOk: false };
    return JSON.parse(readFileSync(file, 'utf-8'));
  }

  function saveState(patch) {
    const merged = { ...loadState(), ...patch };
    writeFileSync(stateFile(), JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  }

  async function launch(channel) {
    const { chromium } = await import('playwright');
    // Each browser keeps its own profile directory: a profile written by Edge
    // is not always readable by another build, and a corrupted one is a
    // confusing failure to debug.
    return chromium.launchPersistentContext(ctx.paths.browser(channel), {
      channel: channel || undefined,
      headless: false,
      viewport: null,
      args: LAUNCH_ARGS,
      ignoreDefaultArgs: ['--enable-automation'],
      locale,
      timezoneId,
    });
  }

  async function getContext() {
    if (context) return context;

    const preferred = channelEnvVar ? process.env[channelEnvVar] : null;
    const candidates = preferred ? [preferred] : CHANNELS;
    const failures = [];

    for (const channel of candidates) {
      try {
        context = await launch(channel);
        activeChannel = channel;
        break;
      } catch (err) {
        failures.push(`${channel}: ${err.message.split('\n')[0]}`);
      }
    }

    if (!context) {
      // Last resort: the bundled browser. Login will very likely stall on the
      // Cloudflare challenge, so say so rather than letting it look like a bug.
      if (notifyKeys.noBrowser) ctx.notify('warning', notifyKeys.noBrowser, {}, { failures });
      context = await launch(null);
      activeChannel = 'bundled';
    }

    context.on('close', () => {
      context = null;
      activeChannel = null;
    });
    return context;
  }

  async function close() {
    if (!context) return;
    try {
      await context.close();
    } catch {}
    context = null;
    activeChannel = null;
  }

  async function isChallengeVisible(page) {
    for (const selector of CHALLENGE_MARKERS) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
    }
    const title = await page.title().catch(() => '');
    return /just a moment|checking your browser|attention required/i.test(title);
  }

  async function isLoggedIn(page) {
    if (await isChallengeVisible(page)) return false;
    const url = page.url();
    if (loggedOutUrlPatterns.some((p) => url.includes(p))) return false;
    for (const selector of loggedInSelectors) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
    }
    // No definitive logged-in marker; not being bounced to login is our signal.
    return !loggedOutUrlPatterns.some((p) => url.includes(p));
  }

  /**
   * Ensures there is a logged-in session.
   * interactive=true  → keep the window open and poll until the user logs in.
   * interactive=false → scheduled mode: on a dead session, notify and throw.
   */
  async function ensureSession({ interactive = false, timeoutMs = 5 * 60 * 1000 } = {}) {
    const browser = await getContext();
    const page = browser.pages()[0] || (await browser.newPage());
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    if (await isLoggedIn(page)) {
      saveState({ sessionOk: true });
      return page;
    }

    if (!interactive) {
      saveState({ sessionOk: false });
      if (notifyKeys.sessionExpired) ctx.notify('error', notifyKeys.sessionExpired, {});
      throw new Error(`${label} session expired`);
    }

    await page.bringToFront();
    if ((await isChallengeVisible(page)) && notifyKeys.challenge) {
      ctx.notify('info', notifyKeys.challenge, { channel: activeChannel }, { channel: activeChannel });
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      if (await isLoggedIn(page)) {
        saveState({ sessionOk: true });
        return page;
      }
    }

    saveState({ sessionOk: false });
    throw new Error(
      (await isChallengeVisible(page))
        ? `${label} login timed out on the Cloudflare check`
        : `Timed out waiting for ${label} login`
    );
  }

  const session = {
    loadState,
    saveState,
    getContext,
    ensureSession,
    close,
    activeChannel: () => activeChannel,
  };
  sessions.set(ctx.instanceId, session);
  return session;
}
