import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_COMPARISON_FILE = path.resolve(__dirname, '../output/comparison.csv');
export const DEFAULT_SEARCH_FILE = path.resolve(__dirname, '../output/search.csv');
export const DEFAULT_CRAWL_CONCURRENCY = 20;
export const DEFAULT_CRAWL_DELAY_MS = 30;
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
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0',
    'Accept': 'application/x-clarity-gzip',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Origin': 'https://us-store.msi.com/',
    'Sec-Fetch-Storage-Access': 'none',
    'Connection': 'keep-alive',
    'Referer': 'https://us-store.msi.com/',
    'Cookie': 'MUID=35F9AA8F67FD6A3E0BFBBD6A66D56BE7',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  },
};


const RANDOM_USER_AGENTS = [
  // Chrome
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.93 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.93 Safari/537.36',

  // Microsoft Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.93 Safari/537.36 Edg/154.0.4258.48',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.93 Safari/537.36 Edg/154.0.4258.48',

  // Opera
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.134 Safari/537.36 OPR/136.0.6008.80',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.134 Safari/537.36 OPR/136.0.6008.80',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.134 Safari/537.36 OPR/136.0.6008.80',

  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0',

  // Chrome Android
  'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.57 Mobile Safari/537.36',
];

const RANDOM_ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-US,en;q=0.8',
  'en-GB,en;q=0.9,en-US;q=0.8',
  'en-US,en;q=0.9,et;q=0.7',
];

function randomItem(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

export function createBrowserContextOptions(random = Math.random) {
  return {
    ...DEFAULT_BROWSER_CONTEXT,
    extraHTTPHeaders: {
      ...DEFAULT_BROWSER_CONTEXT.extraHTTPHeaders,
      'User-Agent': randomItem(RANDOM_USER_AGENTS, random),
      'Accept-Language': randomItem(RANDOM_ACCEPT_LANGUAGES, random),
    },
  };
}
