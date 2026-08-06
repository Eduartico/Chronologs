/**
 * Downloads a portfolio's own CSV export.
 *
 * The previous sync guessed: it recorded every JSON response the page fetched
 * and picked whichever array looked most item-shaped. That breaks whenever the
 * site changes an endpoint, and it silently produces a portfolio with the wrong
 * numbers rather than an error.
 *
 * The export button hands over the same data the site itself considers
 * canonical, in a format there is already a tested parser for
 * (`csv.js` → `importer.js`), including buy/sell history and fees that the
 * intercepted JSON never carried.
 *
 * The file is kept on disk under user-data/documents/pricempire/ so a bad
 * import can be re-run against exactly what was downloaded.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { documentsPath } from '../../lib/paths.js';
import { PRICEMPIRE } from './selectors.js';

const CLICK_TIMEOUT = 8000;
const DOWNLOAD_TIMEOUT = 45000;

function exportDir() {
  const dir = documentsPath('pricempire');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** First selector that is actually on the page, or null. */
async function findVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) return locator;
  }
  return null;
}

/**
 * Clicks the export control and captures the resulting download.
 *
 * Some layouts put the export behind an overflow menu, so one menu is opened
 * before giving up.
 */
export async function downloadPortfolioCsv(page, portfolioId) {
  await page
    .goto(`${PRICEMPIRE.portfolioUrl}/${portfolioId}`, { waitUntil: 'networkidle', timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(2000);

  let button = await findVisible(page, PRICEMPIRE.exportButtonSelectors);

  if (!button) {
    const menu = await findVisible(page, PRICEMPIRE.exportMenuSelectors);
    if (menu) {
      await menu.click({ timeout: CLICK_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(600);
      button = await findVisible(page, PRICEMPIRE.exportButtonSelectors);
    }
  }

  if (!button) {
    throw new Error(
      'Botão de export não encontrado na página do portefólio — o site pode ter mudado ' +
        '(actualiza exportButtonSelectors em server/ingestion/pricempire/selectors.js)'
    );
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT }),
    button.click({ timeout: CLICK_TIMEOUT }),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(exportDir(), `${portfolioId}-${stamp}.csv`);

  // Playwright streams downloads to a temp path; move it somewhere durable.
  const tempPath = await download.path();
  if (tempPath) {
    const buffer = readFileSync(tempPath);
    writeFileSync(target, buffer);
    return { path: target, filename: `${portfolioId}-${stamp}.csv`, buffer };
  }

  await download.saveAs(target);
  return { path: target, filename: `${portfolioId}-${stamp}.csv`, buffer: readFileSync(target) };
}

/** Removes a stored export — used when a download turned out to be unusable. */
export function discardExport(path) {
  try {
    if (path && existsSync(path)) unlinkSync(path);
  } catch {}
}
