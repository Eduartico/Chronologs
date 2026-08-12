import { PRICEMPIRE } from './selectors.js';

/**
 * Scraping strategy: rather than pinning fragile DOM selectors, we collect
 * every JSON response the site's own frontend fetches while a page loads, then
 * heuristically pick out the arrays that look like portfolios / items. DOM
 * parsing is only the fallback for the portfolio list.
 */

function collectJsonResponses(page, sink) {
  const handler = async (response) => {
    try {
      if (!PRICEMPIRE.apiResponsePattern.test(response.url())) return;
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const data = await response.json().catch(() => null);
      if (data) sink.push({ url: response.url(), data });
    } catch {}
  };
  page.on('response', handler);
  return () => page.off('response', handler);
}

// Depth-first search for arrays of objects inside an arbitrary JSON payload.
function findArrays(node, out = [], depth = 0) {
  if (depth > 6 || node == null) return out;
  if (Array.isArray(node)) {
    if (node.length > 0 && typeof node[0] === 'object' && node[0] !== null) out.push(node);
    for (const item of node.slice(0, 5)) findArrays(item, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const value of Object.values(node)) findArrays(value, out, depth + 1);
  }
  return out;
}

function firstKey(obj, candidates) {
  for (const k of candidates) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function looksLikePortfolio(obj) {
  const hasId = firstKey(obj, ['id', 'uuid', 'slug', '_id']) !== undefined;
  const hasName = firstKey(obj, ['name', 'title', 'label']) !== undefined;
  const notItem = firstKey(obj, ['market_hash_name', 'wear', 'float']) === undefined;
  return hasId && hasName && notItem;
}

function looksLikeItem(obj) {
  const hasName = firstKey(obj, ['market_hash_name', 'name', 'item_name']) !== undefined;
  const hasPrice = firstKey(obj, ['price', 'value', 'current_price', 'suggested_price']) !== undefined;
  return hasName && hasPrice;
}

function normalizePrice(value) {
  const num = typeof value === 'object' ? firstKey(value, ['amount', 'value', 'usd', 'eur']) : value;
  const parsed = parseFloat(num);
  if (!Number.isFinite(parsed)) return null;
  // Pricempire APIs often express prices in cents.
  return parsed > 100000 ? parsed / 100 : parsed;
}

export async function listPortfolios(page) {
  const responses = [];
  const stop = collectJsonResponses(page, responses);
  await page.goto(PRICEMPIRE.portfolioUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  stop();

  // Preferred source: the site's own JSON data
  const candidates = [];
  for (const { data } of responses) {
    for (const arr of findArrays(data)) {
      if (arr.every(looksLikePortfolio) && arr.length <= 50) candidates.push(arr);
    }
  }
  if (candidates.length > 0) {
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    return best.map((p) => ({
      id: String(firstKey(p, ['id', 'uuid', 'slug', '_id'])),
      name: String(firstKey(p, ['name', 'title', 'label'])),
      value: normalizePrice(firstKey(p, ['total_value', 'value', 'worth', 'total'])) ?? null,
    }));
  }

  // Fallback: portfolio links in the DOM
  const links = await page.locator(PRICEMPIRE.portfolioLinkSelector).all();
  const seen = new Map();
  for (const link of links) {
    const href = (await link.getAttribute('href')) || '';
    const m = href.match(/\/portfolio\/([^/?#]+)/);
    if (!m) continue;
    const text = ((await link.textContent()) || '').trim();
    if (!seen.has(m[1])) seen.set(m[1], { id: m[1], name: text || m[1], value: null });
  }
  return [...seen.values()];
}

export async function scrapePortfolio(page, portfolioId) {
  const responses = [];
  const stop = collectJsonResponses(page, responses);
  await page
    .goto(`${PRICEMPIRE.portfolioUrl}/${portfolioId}`, { waitUntil: 'networkidle', timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  stop();

  const itemArrays = [];
  for (const { data } of responses) {
    for (const arr of findArrays(data)) {
      const itemish = arr.filter(looksLikeItem);
      if (itemish.length > 0 && itemish.length >= arr.length * 0.6) itemArrays.push(itemish);
    }
  }
  const items = itemArrays.sort((a, b) => b.length - a.length)[0] || [];

  const holdings = items.map((item) => {
    const name = String(firstKey(item, ['market_hash_name', 'name', 'item_name']));
    const buyDateRaw = firstKey(item, ['buy_date', 'purchase_date', 'bought_at', 'created_at', 'createdAt']);
    return {
      name,
      quantity: parseInt(firstKey(item, ['quantity', 'count', 'amount']) ?? 1) || 1,
      buyPrice: normalizePrice(firstKey(item, ['buy_price', 'purchase_price', 'paid', 'cost'])),
      currentPrice: normalizePrice(
        firstKey(item, ['price', 'current_price', 'value', 'suggested_price'])
      ),
      buyDate: buyDateRaw ? String(buyDateRaw).slice(0, 10) : null,
    };
  });

  return { portfolioId, holdings };
}
