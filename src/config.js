import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_COMPARISON_FILE = path.resolve(__dirname, '../output/comparison.csv');
export const DEFAULT_SEARCH_FILE = path.resolve(__dirname, '../output/search.csv');
export const DEFAULT_CRAWL_CONCURRENCY = 100;
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
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7752.100 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7687.85 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7626.86 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7568.66 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7500.95 Safari/537.36',

  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.57 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7752.100 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7687.85 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7626.86 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7568.66 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7500.95 Safari/537.36',

  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7752.100 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7687.85 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7626.86 Safari/537.36',

  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Safari/537.36',
  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Safari/537.36',
  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Safari/537.36',
  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Safari/537.36',
  'Mozilla/5.0 (Macintosh; ARM Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7752.100 Safari/537.36',

  'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.57 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Mobile Safari/537.36',

  'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.57 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 15; SM-S936B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7812.119 Mobile Safari/537.36',

  'Mozilla/5.0 (Linux; Android 16; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.57 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7997.166 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7939.90 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7890.126 Safari/537.36',

  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.3530.11',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.3488.54',
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
