import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_COMPARISON_FILE = path.resolve(__dirname, '../output/comparison.csv');
export const DEFAULT_CRAWL_CONCURRENCY = 50;
export const DEFAULT_CRAWL_DELAY_MS = 300;
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
  extraHTTPHeaders: {
    // 'Host': 'apikeys.civiccomputing.com',
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Origin': 'https://us-store.msi.com',
    'Connection': 'keep-alive',
    'Referer': 'https://us-store.msi.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  },
  // locale: 'en-US',
  // userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
};
