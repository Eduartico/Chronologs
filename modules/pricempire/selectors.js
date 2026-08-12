/**
 * Every Pricempire URL pattern and DOM selector lives here so site redesigns
 * only require touching this file.
 */
export const PRICEMPIRE = {
  baseUrl: 'https://pricempire.com',
  portfolioUrl: 'https://pricempire.com/portfolio',
  loginUrl: 'https://pricempire.com/login',
  // URL substrings that indicate the user is NOT logged in
  loggedOutUrlPatterns: ['/login', '/auth', '/signin'],
  // DOM selectors that only render for a logged-in user (first match wins)
  loggedInSelectors: ['[data-testid="user-menu"]', 'a[href*="/logout"]', 'img[alt*="avatar" i]'],
  // Links to individual portfolios on the portfolio index page
  portfolioLinkSelector: 'a[href*="/portfolio/"]',
  // XHR/fetch responses worth inspecting for JSON data
  apiResponsePattern: /pricempire\.com\/(api|_next\/data)\//,
  // The portfolio's own CSV export. Tried in order — the site labels this
  // button differently across redesigns, and the download is far more reliable
  // than reading prices back out of intercepted JSON.
  exportButtonSelectors: [
    '[data-testid="export-csv"]',
    'button:has-text("Export CSV")',
    'button:has-text("Export")',
    'a:has-text("Export CSV")',
    'a[href*="export"]',
    'button[title*="Export" i]',
  ],
  // Menus that hide the export behind one more click.
  exportMenuSelectors: [
    'button:has-text("Actions")',
    'button:has-text("More")',
    '[data-testid="portfolio-menu"]',
  ],
};
