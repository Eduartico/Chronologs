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
};
