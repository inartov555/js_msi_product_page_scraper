import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = 'https://us-store.msi.com';
export const DEFAULT_PRODUCT_URL = `${DEFAULT_BASE_URL}/Intel-Platform-Motherboard/MAG-Z890-TOMAHAWK-WIFI`;
export const DEFAULT_CATALOG_FILE = path.resolve(__dirname, '../output/catalog.json');
export const DEFAULT_SINGLE_PRODUCT_FILE = path.resolve(__dirname, '../output/single-product.json');
export const DEFAULT_CRAWL_CONCURRENCY = 10;
export const DEFAULT_CRAWL_DELAY_MS = 100;
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
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  // locale: 'en-US',
  // timezoneId: 'America/Los_Angeles',
  viewport: { width: 1440, height: 1000 },
  screen: { width: 1440, height: 1000 },
  colorScheme: 'light',
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};
