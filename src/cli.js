#!/usr/bin/env node
import './shared/consoleLogger.js';
import fs from 'node:fs/promises';
import {
  DEFAULT_CATALOG_FILE,
  DEFAULT_PRODUCT_URL,
  DEFAULT_SEED_URLS,
  DEFAULT_SINGLE_PRODUCT_FILE,
} from './config.js';
import { JsonCatalogRepository } from './infrastructure/catalogRepository.js';
import { searchProducts } from './application/searchService.js';
import { compareProducts, resolveProduct } from './application/compareService.js';

function parseArgs(args) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equalIndex = raw.indexOf('=');
    let key;
    let value;
    if (equalIndex >= 0) {
      key = raw.slice(0, equalIndex);
      value = raw.slice(equalIndex + 1);
    } else {
      key = raw;
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }
    const previous = flags.get(key);
    if (previous === undefined) flags.set(key, value);
    else flags.set(key, Array.isArray(previous) ? [...previous, value] : [previous, value]);
  }
  return { positional, flags };
}

function flag(flags, key, fallback = undefined) {
  const value = flags.get(key);
  return value === undefined ? fallback : value;
}

function flagList(flags, key) {
  const value = flags.get(key);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function numberFlag(flags, key, fallback) {
  const value = Number(flag(flags, key, fallback));
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number.`);
  return value;
}

function booleanFlag(flags, key, fallback) {
  const value = flag(flags, key, fallback);
  if (typeof value === 'boolean') return value;
  if (/^(true|1|yes)$/i.test(String(value))) return true;
  if (/^(false|0|no)$/i.test(String(value))) return false;
  throw new Error(`--${key} must be true or false.`);
}

function parseSpecFilters(values) {
  return values.map((value) => {
    const index = String(value).indexOf('=');
    if (index < 1) throw new Error(`Invalid --spec "${value}". Expected NAME=VALUE.`);
    return { key: String(value).slice(0, index), value: String(value).slice(index + 1) };
  });
}

async function withCatalog(flags, callback) {
  const repository = new JsonCatalogRepository(flag(flags, 'catalog', DEFAULT_CATALOG_FILE));
  const catalog = await repository.load();
  return callback(catalog.products, repository);
}

async function commandScrape(args) {
  const { positional, flags } = parseArgs(args);
  const url = positional[0] || process.env.PRODUCT_URL || DEFAULT_PRODUCT_URL;
  const headless = booleanFlag(flags, 'headless', process.env.HEADLESS ?? true);
  const output = flag(flags, 'output', DEFAULT_SINGLE_PRODUCT_FILE);
  const [{ createBrowserSession }, { CatalogService }] = await Promise.all([
    import('./infrastructure/browser.js'),
    import('./application/catalogService.js'),
  ]);
  const session = await createBrowserSession({ headless });
  try {
    const repository = new JsonCatalogRepository(flag(flags, 'catalog', DEFAULT_CATALOG_FILE));
    const service = new CatalogService({ context: session.context, repository });
    const product = await service.scrapeOne(url);
    const path = (await import('node:path')).default;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(product, null, 2)}\n`, 'utf8');
    if (booleanFlag(flags, 'index', false)) await repository.upsertMany([product]);
    console.log(`Saved product to ${output}`);
  } finally {
    await session.close();
  }
}

async function commandCrawl(args) {
  const { flags } = parseArgs(args);
  const headless = booleanFlag(flags, 'headless', true);
  const seeds = flagList(flags, 'seed');
  const repository = new JsonCatalogRepository(flag(flags, 'catalog', DEFAULT_CATALOG_FILE));
  const [{ createBrowserSession }, { CatalogService }] = await Promise.all([
    import('./infrastructure/browser.js'),
    import('./application/catalogService.js'),
  ]);
  const session = await createBrowserSession({ headless });
  try {
    const service = new CatalogService({ context: session.context, repository });
    const result = await service.crawl({
      seedUrls: seeds.length ? seeds : DEFAULT_SEED_URLS,
      concurrency: numberFlag(flags, 'concurrency', 3),
      delayMs: numberFlag(flags, 'delay-ms', 300),
      maxProducts: numberFlag(flags, 'max-products', Number.MAX_SAFE_INTEGER),
      maxPagesPerSeed: numberFlag(flags, 'max-pages', 100),
    });
    console.log(`Catalog updated: ${result.scraped}/${result.discovered} products scraped, ${result.failed} failed; ${result.catalog.products.length} total indexed.`);
  } finally {
    await session.close();
  }
}

async function commandSearch(args) {
  const { positional, flags } = parseArgs(args);
  const query = positional.join(' ');
  await withCatalog(flags, async (products) => {
    const results = searchProducts(products, {
      query,
      category: flag(flags, 'category', null),
      minPrice: flags.has('min-price') ? numberFlag(flags, 'min-price') : null,
      maxPrice: flags.has('max-price') ? numberFlag(flags, 'max-price') : null,
      availability: flag(flags, 'availability', null),
      specs: parseSpecFilters(flagList(flags, 'spec')),
      limit: numberFlag(flags, 'limit', 20),
    });
    if (booleanFlag(flags, 'json', false)) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    console.table(results.map((product) => ({
      id: product.item_id ?? product.mpn ?? '',
      title: product.title,
      price: product.sale_price ?? product.price,
      availability: product.availability,
      category: product.product_category,
    })));
  });
}

async function commandCompare(args) {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 2) throw new Error('Usage: compare <product selector> <product selector> [more selectors]');
  await withCatalog(flags, async (products) => {
    const selected = positional.map((selector) => resolveProduct(products, selector));
    const rows = compareProducts(selected, {
      includeEqual: booleanFlag(flags, 'all', false),
      fields: flagList(flags, 'field'),
    });
    if (booleanFlag(flags, 'json', false)) {
      console.log(JSON.stringify({ products: selected.map((product) => ({ id: product.item_id, title: product.title })), rows }, null, 2));
      return;
    }
    const tableRows = rows.map((row) => ({
      parameter: row.parameter,
      ...Object.fromEntries(selected.map((product, index) => [product.title, row.values[index]])),
    }));
    console.table(tableRows);
  });
}

function printHelp() {
  console.log(`MSI catalog scraper\n\nCommands:\n  scrape [url] [--output file] [--index]\n  crawl [--seed url ...] [--concurrency 3] [--delay-ms 300] [--max-products N]\n  search [query] [--category text] [--min-price N] [--max-price N] [--availability in_stock] [--spec NAME=VALUE]\n  compare <id|mpn|title|url> <id|mpn|title|url> [more] [--field NAME] [--all]\n\nGlobal:\n  --catalog file   Catalog JSON path (default: output/catalog.json)\n  --json           Machine-readable output for search/compare\n`);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'scrape') return commandScrape(args);
  if (command === 'crawl') return commandCrawl(args);
  if (command === 'search') return commandSearch(args);
  if (command === 'compare') return commandCompare(args);
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
