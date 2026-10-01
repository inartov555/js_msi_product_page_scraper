import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_COMPARISON_FILE = path.resolve(__dirname, '../output/comparison.csv');
export const DEFAULT_SEARCH_FILE = path.resolve(__dirname, '../output/search.csv');
export const DEFAULT_CRAWL_CONCURRENCY = 30;
export const DEFAULT_CRAWL_DELAY_MS = 0;
export const DEFAULT_PRODUCT_RETRY_ATTEMPTS = 3;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 45000;
export const DEFAULT_BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font'];

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

// Keep a few internally consistent desktop profiles instead of hundreds of
// mixed desktop/mobile user agents paired with one fixed desktop viewport.
const BROWSER_PROFILES = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.9',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.9',
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    locale: 'en-US',
    acceptLanguage: 'en-US,en;q=0.9',
  },
];

export function createBrowserContextOptions(random = Math.random) {
  const normalized = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  const profile = BROWSER_PROFILES[Math.floor(normalized * BROWSER_PROFILES.length)];

  return {
    ...DEFAULT_BROWSER_CONTEXT,
    userAgent: profile.userAgent,
    locale: profile.locale,
    extraHTTPHeaders: {
      'Accept-Language': profile.acceptLanguage,
      Referer: `${DEFAULT_BASE_URL}/`,
    },
  };
}
