import { existsSync, readFileSync, writeFileSync } from 'fs';
import { browserPath, statePath } from '../../lib/paths.js';
import { notify } from '../../lib/notify.js';
import { PRICEMPIRE } from './selectors.js';

let context = null;
let activeChannel = null;

function stateFile() {
  return statePath('pricempire.json');
}

export function loadPricempireState() {
  if (!existsSync(stateFile())) {
    return { selectedPortfolios: [], lastSync: null, sessionOk: false };
  }
  return JSON.parse(readFileSync(stateFile(), 'utf-8'));
}

export function savePricempireState(patch) {
  const merged = { ...loadPricempireState(), ...patch };
  writeFileSync(stateFile(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// Pricempire sits behind Cloudflare. Playwright's bundled Chromium fails the
// browser-integrity check for reasons that have nothing to do with automation
// intent — it ships no Chrome branding, renders WebGL through SwiftShader
// instead of the real GPU, and advertises itself via --enable-automation — so
// the challenge never clears even when a human is the one clicking it.
// Driving a normally installed Chrome or Edge gives the challenge a real
// browser to measure, and the user still solves it themselves.
const CHANNELS = ['chrome', 'msedge', 'chrome-beta', 'msedge-beta'];

const LAUNCH_ARGS = [
  // Drops navigator.webdriver, which is the flag the challenge keys on.
  '--disable-blink-features=AutomationControlled',
  '--start-maximized',
];

// Cloudflare's interstitial, so we can tell "still solving the challenge"
// apart from "logged out".
const CHALLENGE_MARKERS = [
  '#challenge-form',
  '#cf-challenge-running',
  'iframe[src*="challenges.cloudflare.com"]',
];

async function launch(channel) {
  const { chromium } = await import('playwright');
  // Each browser keeps its own profile directory: a profile written by Edge is
  // not always readable by another build, and a corrupted one is a confusing
  // failure to debug.
  const profileDir = browserPath(channel ? `pricempire-${channel}` : 'pricempire');
  return chromium.launchPersistentContext(profileDir, {
    channel: channel || undefined,
    headless: false,
    viewport: null,
    args: LAUNCH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
    locale: 'pt-PT',
    timezoneId: 'Europe/Lisbon',
  });
}

export async function getContext() {
  if (context) return context;

  const preferred = process.env.PRICEMPIRE_BROWSER_CHANNEL;
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
    notify(
      'warning',
      'Pricempire: no installed browser found',
      'Chrome or Edge could not be launched, falling back to the bundled browser — ' +
        'the Cloudflare check will probably not pass. Install Google Chrome and try again.',
      { module: 'pricempire', failures }
    );
    context = await launch(null);
    activeChannel = 'bundled';
  }

  context.on('close', () => {
    context = null;
    activeChannel = null;
  });
  return context;
}

export function activeBrowserChannel() {
  return activeChannel;
}

export async function closeBrowser() {
  if (context) {
    try {
      await context.close();
    } catch {}
    context = null;
    activeChannel = null;
  }
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
  if (PRICEMPIRE.loggedOutUrlPatterns.some((p) => url.includes(p))) return false;
  for (const selector of PRICEMPIRE.loggedInSelectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  // No definitive logged-in marker; not being bounced to login is our signal.
  return !PRICEMPIRE.loggedOutUrlPatterns.some((p) => url.includes(p));
}

/**
 * Ensures there is a logged-in Pricempire session.
 * interactive=true  → keep the window open and poll until the user logs in.
 * interactive=false → scheduled mode: on a dead session, notify and throw.
 */
export async function ensureSession({ interactive = false, timeoutMs = 5 * 60 * 1000 } = {}) {
  const ctx = await getContext();
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(PRICEMPIRE.portfolioUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (await isLoggedIn(page)) {
    savePricempireState({ sessionOk: true });
    return page;
  }

  if (!interactive) {
    savePricempireState({ sessionOk: false });
    notify(
      'error',
      'Pricempire session expired',
      'Open Connections and log in to Pricempire again.',
      { module: 'pricempire' }
    );
    throw new Error('Pricempire session expired');
  }

  await page.bringToFront();
  if (await isChallengeVisible(page)) {
    notify(
      'info',
      'Pricempire: Cloudflare check',
      `Solve the "verify you are human" check in the ${activeChannel} window — the login form is behind it.`,
      { module: 'pricempire', channel: activeChannel }
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (await isLoggedIn(page)) {
      savePricempireState({ sessionOk: true });
      return page;
    }
  }

  savePricempireState({ sessionOk: false });
  throw new Error(
    (await isChallengeVisible(page))
      ? 'Pricempire login timed out on the Cloudflare check'
      : 'Timed out waiting for Pricempire login'
  );
}
