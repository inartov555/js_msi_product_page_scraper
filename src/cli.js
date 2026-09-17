#!/usr/bin/env node
import './shared/consoleLogger.js';
import fs from 'node:fs/promises';
import {
  DEFAULT_PRODUCT_URL,
  DEFAULT_SEED_URLS,
  DEFAULT_CATALOG_FILE,
  DEFAULT_SINGLE_PRODUCT_FILE,
  DEFAULT_COMPARISON_FILE,
  DEFAULT_CRAWL_CONCURRENCY,
  DEFAULT_CRAWL_DELAY_MS,
} from './config.js';
import { JsonCatalogRepository } from './infrastructure/catalogRepository.js';
import { createAutoCatalog, } from './application/createAutoCatalog.js';
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

function csvValue(value) {
  if (value === null || value === undefined) return '';

  const text = String(value);

  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function comparisonCsv(tableRows, productTitles) {
  const header = ['parameter', ...productTitles];
  const lines = [header.map(csvValue).join(',')];

  for (const row of tableRows) {
    lines.push(
      header
        .map((column) => csvValue(row[column]))
        .join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

function parseSpecFilters(values) {
  return values.map((value) => {
    const index = String(value).indexOf('=');
    if (index < 1) throw new Error(`Invalid --spec "${value}". Expected NAME=VALUE.`);
    return { key: String(value).slice(0, index), value: String(value).slice(index + 1) };
  });
}

async function withCatalog(flags, callback) {
  const repository = createRepository(flags);
  const provider = createProvider(flags, repository);

  // Automatically crawl MSI if no products are loaded yet.
  const products = await provider.getProducts();

  return callback(products);
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
    const repository = createRepository(flags);
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
  const repository = createRepository(flags);
  const provider = createProvider(flags, repository);
  const refresh = booleanFlag(flags, 'refresh', process.env.REFRESH_CATALOG ?? false);
  const catalog = await provider.getCatalog({ refresh });
  console.log(`Catalog analysis complete: ${catalog.products.length} products available.`);
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
  const {
    positional,
    flags,
  } = parseArgs(args);

  if (positional.length < 2) {
    throw new Error('Usage: compare <product selector> <product selector> [more selectors]');
  }

  const repository =
    createRepository(flags);

  let catalog =
    await repository.load();

  let selected = [];
  const missing = [];

  // First try already-loaded products.
  for (const selector of positional) {
    try {
      selected.push(
        resolveProduct(
          catalog.products,
          selector
        )
      );
    } catch (error) {
      if (
        !/^No product matches/.test(
          error.message
        )
      ) {
        throw error;
      }

      missing.push(selector);
    }
  }

  /*
   * Do NOT crawl Laptops, Desktops,
   * Motherboards, etc. simply to compare
   * two known products.
   */
  if (missing.length) {
    console.log(
      `Resolving ${missing.length} missing comparison product(s) directly from MSI...`
    );

    const [
      { createBrowserSession },
      { CatalogService },
    ] = await Promise.all([
      import(
        './infrastructure/browser.js'
      ),

      import(
        './application/catalogService.js'
      ),
    ]);

    const headless =
      booleanFlag(
        flags,
        'headless',
        process.env.HEADLESS ?? true
      );

    const session =
      await createBrowserSession({
        headless,
      });

    try {
      const service =
        new CatalogService({
          context:
            session.context,

          repository,
        });

      await service.scrapeSelectors(
        missing
      );
    } finally {
      await session.close();
    }

    catalog =
      await repository.load();

    selected =
      positional.map(
        (selector) =>
          resolveProduct(
            catalog.products,
            selector
          )
      );
  }

  const rows =
    compareProducts(
      selected,
      {
        includeEqual:
          booleanFlag(
            flags,
            'all',
            false
          ),

        fields:
          flagList(
            flags,
            'field'
          ),
      }
    );

  const tableRows =
    rows.map((row) => ({
      parameter: row.parameter, ...Object.fromEntries(
        selected.map(
          (product, index) => [
            product.title,
            row.values[index],
          ]
        )
      ),
    }));

  const output = flag(
    flags,
    'output',
    DEFAULT_COMPARISON_FILE
  );

  const path = (await import('node:path')).default;

  await fs.mkdir(
    path.dirname(output),
    { recursive: true }
  );

  const csv = comparisonCsv(
    tableRows,
    selected.map((product) => product.title)
  );

  await fs.writeFile(
    output,
    csv,
    'utf8'
  );

  if (
    booleanFlag(
      flags,
      'json',
      false
    )
  ) {
    console.log(
      JSON.stringify(
        {
          products:
            selected.map(
              (product) => ({
                id:
                  product.item_id,

                title:
                  product.title,
              })
            ),

          rows,
        },
        null,
        2
      )
    );

    console.log(`Saved comparison table to ${output}`);
    return;
  }

  console.table(tableRows);
  console.log(`Saved comparison table to ${output}`);
}

function createRepository(flags) {
  const catalogFile = flag(
    flags,
    'catalog',
    process.env.CATALOG_FILE ||
      DEFAULT_CATALOG_FILE
  );

  return new JsonCatalogRepository(
    catalogFile
  );
}

function createProvider(flags, repository) {
  const seeds = flagList(flags, 'seed');

  return createAutoCatalog({
    repository,

    seedUrls:
      seeds.length
        ? seeds
        : DEFAULT_SEED_URLS,

    concurrency: numberFlag(
      flags,
      'concurrency',
      Number(
        process.env.CRAWL_CONCURRENCY || DEFAULT_CRAWL_CONCURRENCY
      )
    ),

    delayMs: numberFlag(
      flags,
      'delay-ms',
      Number(
        process.env.CRAWL_DELAY_MS || DEFAULT_CRAWL_DELAY_MS
      )
    ),

    headless: booleanFlag(
      flags,
      'headless',
      process.env.HEADLESS ?? true
    ),
  });
}

function printHelp() {
  console.log(`MSI catalog scraper\n\nCommands:\n  scrape [url] [--output file] [--index]\n  crawl [--refresh true] [--seed url ...] [--concurrency ${DEFAULT_CRAWL_CONCURRENCY}] [--delay-ms ${DEFAULT_CRAWL_DELAY_MS}]\n  search [query] [--category text] [--min-price N] [--max-price N] [--availability in_stock] [--spec NAME=VALUE]\n  compare <id|mpn|title|url> <id|mpn|title|url> [more] [--field NAME] [--all] [--output file]\n\nGlobal:\n  --catalog file   Catalog JSON path (default: output/catalog.json)\n  --json           Machine-readable output for search/compare\n`);
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
