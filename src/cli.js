#!/usr/bin/env node
import './shared/consoleLogger.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CATALOG_FILE,
  DEFAULT_COMPARISON_FILE,
  DEFAULT_CRAWL_CONCURRENCY,
  DEFAULT_CRAWL_DELAY_MS,
  DEFAULT_PRODUCT_URL,
  DEFAULT_SEED_URLS,
  DEFAULT_SINGLE_PRODUCT_FILE,
} from './config.js';
import { createCatalogService } from './catalog.js';
import { compareProducts } from './compare.js';
import { JsonCatalogRepository } from './repository.js';
import { searchProducts } from './search.js';

function normalizeQuotedArgs(args) {
  const normalized = [];
  let quote = null;
  let parts = [];

  for (const token of args) {
    if (!quote) {
      const first = token[0];
      if ((first === "'" || first === '"') && token.length > 1) {
        if (token.endsWith(first)) {
          normalized.push(token.slice(1, -1));
        } else {
          quote = first;
          parts = [token.slice(1)];
        }
      } else {
        normalized.push(token);
      }
      continue;
    }

    if (token.endsWith(quote)) {
      parts.push(token.slice(0, -1));
      normalized.push(parts.join(' '));
      quote = null;
      parts = [];
    } else {
      parts.push(token);
    }
  }

  if (quote) throw new Error(`Unterminated ${quote} quote in command arguments.`);
  return normalized;
}

function parseArgs(args) {
  args = normalizeQuotedArgs(args);
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
    const key = equalIndex >= 0 ? raw.slice(0, equalIndex) : raw;
    let value = equalIndex >= 0 ? raw.slice(equalIndex + 1) : true;

    if (equalIndex < 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
      value = args[index + 1];
      index += 1;
    }

    const previous = flags.get(key);
    flags.set(key, previous === undefined
      ? value
      : Array.isArray(previous) ? [...previous, value] : [previous, value]);
  }

  return { positional, flags };
}

function flag(flags, key, fallback = undefined) {
  return flags.has(key) ? flags.get(key) : fallback;
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
    const text = String(value);
    const index = text.indexOf('=');
    if (index < 1) throw new Error(`Invalid --spec "${value}". Expected NAME=VALUE.`);
    return { key: text.slice(0, index), value: text.slice(index + 1) };
  });
}

function csvValue(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function comparisonCsv(rows, products) {
  const titles = products.map((product) => product.title);
  const header = ['parameter', ...titles];
  const lines = [header.map(csvValue).join(',')];

  for (const row of rows) {
    lines.push([
      row.parameter,
      ...row.values,
    ].map(csvValue).join(','));
  }

  return `${lines.join('\n')}\n`;
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function createRuntime(flags) {
  const repository = new JsonCatalogRepository(
    flag(flags, 'catalog', process.env.CATALOG_FILE || DEFAULT_CATALOG_FILE)
  );
  const seeds = flagList(flags, 'seed');

  const catalog = createCatalogService({
    repository,
    seedUrls: seeds.length ? seeds : DEFAULT_SEED_URLS,
    concurrency: numberFlag(
      flags,
      'concurrency',
      Number(process.env.CRAWL_CONCURRENCY || DEFAULT_CRAWL_CONCURRENCY)
    ),
    delayMs: numberFlag(
      flags,
      'delay-ms',
      Number(process.env.CRAWL_DELAY_MS || DEFAULT_CRAWL_DELAY_MS)
    ),
    headless: booleanFlag(flags, 'headless', process.env.HEADLESS ?? true),
  });

  return { repository, catalog };
}

async function commandScrape(args) {
  const { positional, flags } = parseArgs(args);
  const { repository, catalog } = createRuntime(flags);
  const url = positional[0] || process.env.PRODUCT_URL || DEFAULT_PRODUCT_URL;
  const output = flag(flags, 'output', DEFAULT_SINGLE_PRODUCT_FILE);
  const product = await catalog.scrapeOne(url);

  await writeFile(output, `${JSON.stringify(product, null, 2)}\n`);
  if (booleanFlag(flags, 'index', false)) await repository.upsertMany([product]);
  console.log(`Saved product to ${output}`);
}

async function commandCrawl(args) {
  const { flags } = parseArgs(args);
  const { catalog } = createRuntime(flags);
  const refresh = booleanFlag(flags, 'refresh', process.env.REFRESH_CATALOG ?? false);
  const result = await catalog.getCatalog({ refresh });
  console.log(`Catalog analysis complete: ${result.products.length} products available.`);
}

async function commandSearch(args) {
  const { positional, flags } = parseArgs(args);
  const { catalog } = createRuntime(flags);
  const products = await catalog.getProducts();
  const results = searchProducts(products, {
    query: positional.join(' '),
    category: flag(flags, 'category', null),
    minPrice: flags.has('min-price') ? numberFlag(flags, 'min-price') : null,
    maxPrice: flags.has('max-price') ? numberFlag(flags, 'max-price') : null,
    availability: flag(flags, 'availability', null),
    specs: parseSpecFilters(flagList(flags, 'spec')),
    limit: numberFlag(flags, 'limit', 20),
  });

  if (booleanFlag(flags, 'json', false)) {
    console.log(`Search results:\n${JSON.stringify(results, null, 2)}`);
    return;
  }

  console.log('Search results table:');
  console.table(results.map((product) => ({
    id: product.item_id ?? product.mpn ?? '',
    title: product.title,
    price: product.sale_price ?? product.price,
    availability: product.availability,
    category: product.product_category,
  })));
}

async function commandCompare(args) {
  const { positional, flags } = parseArgs(args);
  if (positional.length < 2) {
    throw new Error('Usage: compare <product selector> <product selector> [more selectors]');
  }

  const { catalog } = createRuntime(flags);
  const selected = await catalog.resolveProducts(positional);
  const rows = compareProducts(selected, {
    includeEqual: booleanFlag(flags, 'all', false),
    fields: flagList(flags, 'field'),
  });
  const output = flag(flags, 'output', DEFAULT_COMPARISON_FILE);
  const csv = comparisonCsv(rows, selected);

  await writeFile(output, csv);

  if (booleanFlag(flags, 'json', false)) {
    console.log(JSON.stringify({
      products: selected.map((product) => ({ id: product.item_id, title: product.title })),
      rows,
    }, null, 2));
    console.log(`Saved comparison table to ${output}`);
    return;
  }

  console.log('Saved comparison table to a file');
  process.stdout.write(csv);
}

function printHelp() {
  console.log(`MSI catalog scraper\n\nCommands:\n  scrape [url] [--output file] [--index]\n  crawl [--refresh true] [--seed url ...] [--concurrency ${DEFAULT_CRAWL_CONCURRENCY}] [--delay-ms ${DEFAULT_CRAWL_DELAY_MS}]\n  search [query] [--category text] [--min-price N] [--max-price N] [--availability in_stock] [--spec NAME=VALUE]\n  compare <id|mpn|title|url> <id|mpn|title|url> [more] [--field NAME] [--all] [--output file]\n\nGlobal:\n  --catalog file   Catalog JSON path (default: output/catalog.json)\n  --json           Machine-readable output for search/compare\n`);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const commands = {
    scrape: commandScrape,
    crawl: commandCrawl,
    search: commandSearch,
    compare: commandCompare,
    help: printHelp,
    '--help': printHelp,
    '-h': printHelp,
  };

  const handler = commands[command];
  if (!handler) throw new Error(`Unknown command: ${command}`);
  return handler(args);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
