import { discoverMsiProductUrls } from '../adapters/discovery.js';
import { extractMsiProduct } from '../adapters/productExtractor.js';
import { validateProduct } from '../domain/product.js';
import { sleep } from '../infrastructure/browser.js';
import { buildMsiProductUrlCandidates, } from '../adapters/productLocator.js';
import { normalizeText, } from '../shared/text.js';
import {
  DEFAULT_CRAWL_CONCURRENCY,
  DEFAULT_CRAWL_DELAY_MS,
} from '../config.js';

async function runPool(items, concurrency, workerFactory) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer.');
  }

  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from(
    { length: workerCount },
    async (_, workerIndex) => {
      const worker = await workerFactory(workerIndex);

      try {
        while (true) {
          const index = cursor;
          cursor += 1;

          if (index >= items.length) {
            return;
          }

          results[index] = await worker.run(
            items[index],
            index
          );
        }
      } finally {
        await worker.close?.();
      }
    }
  );

  await Promise.all(workers);

  return results;
}

function createStartRateGate(delayMs) {
  if (!(delayMs > 0)) return async () => {};
  let nextStartAt = 0;
  let tail = Promise.resolve();

  return async () => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, nextStartAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      nextStartAt = Date.now() + delayMs;
    } finally {
      release();
    }
  };
}

export class CatalogService {
  constructor({ context, repository, logger = console }) {
    this.context = context;
    this.repository = repository;
    this.logger = logger;
  }

  async scrapePage(page, url) {
    const product = await extractMsiProduct(page, url);

    if (!product?.title) {
      throw new Error(`Not a product page: ${url}`);
    }

    const problems = validateProduct(product);

    if (problems.length) {
      this.logger.warn(`Incomplete product ${product.title ?? url}: ${problems.join(', ')}`);
    }

    return product;
  }

async scrapeOne(url) {
  const page = await this.context.newPage();

  try {
    return await this.scrapePage(page, url);
  } finally {
    await page.close().catch(() => {});
  }
}

  async discover(seedUrls, options = {}) {
    const page = await this.context.newPage();
    try {
      return await discoverMsiProductUrls(page, seedUrls, options);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async crawl({
    seedUrls,
    concurrency = DEFAULT_CRAWL_CONCURRENCY,
    delayMs = DEFAULT_CRAWL_DELAY_MS,
  }) {
    const urls = await this.discover(seedUrls, {
      delayMs,
      onProgress: ({ seedUrl, pageNumber, added, total }) =>
        this.logger.log(`[discover] ${seedUrl} page=${pageNumber} added=${added} total=${total}`),
    });

    this.logger.log(`Discovered ${urls.length} product URLs.`);
    const waitForStartSlot = createStartRateGate(delayMs);
    const errors = [];
    const products = (
      await runPool(
        urls,
        concurrency,
        async () => {
          const page = await this.context.newPage();

          return {
            run: async (url, index) => {
              try {
                await waitForStartSlot();

                const product = await this.scrapePage(
                  page,
                  url
                );

                this.logger.log(
                  `[scrape ${index + 1}/${urls.length}] ${product.title ?? url}`
                );

                return product;
              } catch (error) {
                errors.push({
                  url,
                  error: error.message,
                });

                this.logger.error(
                  `[scrape ${index + 1}/${urls.length}] ${url}: ${error.message}`
                );

                return null;
              }
            },

            close: async () => {
              await page.close().catch(() => {});
            },
          };
        }
      )
    ).filter(Boolean);

    if (errors.length > 0) {
      throw new Error(`Catalog crawl incomplete: ${errors.length} of ${urls.length} product(s) failed. Existing catalog was not overwritten.`);
    }

    const catalog = await this.repository.replaceAll(products);
    this.logger.log(`Full catalog saved: ${catalog.products.length} products.`);
    return { discovered: urls.length, scraped: products.length, failed: 0, errors: [], catalog };
  }

  async scrapeSelector(selector) {
    const candidates = buildMsiProductUrlCandidates(selector);
    const expected = normalizeText(selector);
    const errors = [];

    for (const url of candidates) {
      try {
        const product = await this.scrapeOne(url);
        const actual = normalizeText(product.title);

        // Prevent a redirect to a generic page
        // from being accepted as the product.
        if (!actual || (!actual.includes(expected) && !expected.includes(actual))) {
          errors.push(`${url}: resolved to "${product.title ?? 'unknown'}"`);
          continue;
        }

        await this.repository.upsertMany([product, ]);

        return product;
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    throw new Error(
      `Unable to resolve product "${selector}" directly from MSI. ` +
      `Tried ${candidates.length} candidate URL(s). ` +
      errors.slice(-3).join(' | ')
    );
  }

  async scrapeSelectors(selectors) {
    const products = [];

    for (const selector of selectors) {
      const product = await this.scrapeSelector(selector);
      products.push(product);
      this.logger.log(`[direct] ${selector} -> ${product.title}`);
    }

    return products;
  }
}
