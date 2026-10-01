import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_COMPARISON_FILE = path.resolve(__dirname, '../output/comparison.csv');
export const DEFAULT_SEARCH_FILE = path.resolve(__dirname, '../output/search.csv');
export const DEFAULT_CRAWL_CONCURRENCY = 10;
export const DEFAULT_CRAWL_DELAY_MS = 0;
export const DEFAULT_PRODUCT_RETRY_ATTEMPTS = 3;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 45000;
export const DEFAULT_BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font'];

// Top-level catalog pages. They can be overridden with repeated --seed arguments.
export const DEFAULT_SEED_URLS = [
  `${DEFAULT_BASE_URL}/Laptops`,
  `${DEFAULT_BASE_URL}/Desktops`,
  `${DEFAULT_BASE_URL}/Monitors`,
  `${DEFAULT_BASE_URL}/Graphics-Cards`,
  `${DEFAULT_BASE_URL}/Motherboards`,
  `${DEFAULT_BASE_URL}/PC-Components`,
  `${DEFAULT_BASE_URL}/Gaming-Gears`,
  `${DEFAULT_BASE_URL}/EV-chargers`,
];

export const DEFAULT_BROWSER_CONTEXT = {
  viewport: { width: 1440, height: 1000 },
  screen: { width: 1440, height: 1000 },
  isMobile: false,
  hasTouch: false,
};

// Keep these profiles internally consistent and intentionally small. Chromium
// generates protocol-sensitive headers (Sec-Fetch-*, Sec-CH-UA, Referer,
// Accept-Encoding, Connection, cookies, etc.) itself; overriding those with
// stale/static values can make requests look less browser-like, not more.
export const BROWSER_HEADER_PROFILES = [
  {
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.9',
  },
  {
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.8',
  },
  {
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.9,en-GB;q=0.8',
  },
  {
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.7',
  },
];
