import {
  DEFAULT_CRAWL_CONCURRENCY,
  DEFAULT_CRAWL_DELAY_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_PRODUCT_RETRY_ATTEMPTS,
  DEFAULT_SEED_URLS,
} from './config.js';
import { resolveProduct } from './compare.js';
import { validateProduct } from './product.js';
import { normalizeText } from './shared/text.js';
import { sleep } from './scraper/browser.js';
import { discoverMsiProductUrls } from './scraper/discovery.js';
import { extractMsiProduct } from './scraper/extractor.js';
import { buildMsiProductUrlCandidates } from './scraper/productUrl.js';

function isUsableCatalog(catalog) {
  return Array.isArray(catalog?.products)
    && catalog.products.length > 0
    && catalog.products.every((product) => product?.url && product?.title);
}

async function runPool(items, concurrency, workerFactory) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer.');
  }

  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async (_, workerIndex) => {
      const worker = await workerFactory(workerIndex);
      try {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= items.length) return;
          results[index] = await worker.run(items[index], index);
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

export function createCatalogService({
  repository,
  seedUrls = DEFAULT_SEED_URLS,
  concurrency = DEFAULT_CRAWL_CONCURRENCY,
  delayMs = DEFAULT_CRAWL_DELAY_MS,
  productRetryAttempts = DEFAULT_PRODUCT_RETRY_ATTEMPTS,
  headless = true,
  logger = console,
}) {
  let buildPromise = null;

  async function withBrowser(callback) {
    const { createBrowserSession } = await import('./scraper/browser.js');
    const session = await createBrowserSession({ headless });
    try {
      return await callback(session);
    } finally {
      await session.close();
    }
  }

  async function scrapePage(
    page,
    url,
    { navigationAttempts = 4, navigationTimeout = DEFAULT_NAVIGATION_TIMEOUT_MS } = {}
  ) {
    const product = await extractMsiProduct(page, url, {
      navigationAttempts,
      navigationTimeout,
    });
    if (!product?.title) throw new Error(`Not a product page: ${url}`);

    const problems = validateProduct(product);
    if (problems.length) {
      logger.warn(`Incomplete product ${product.title ?? url}: ${problems.join(', ')}`);
    }

    return product;
  }

  function isRetryableProductError(error) {
    let current = error;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (current?.accessDenied) return true;
      if (current?.status === 408 || current?.status === 429) return true;
      if (current?.status >= 500) return true;
      if (current?.status >= 400) return false;

      const message = String(current?.message ?? current);
      if (/Not a product page|HTTP 404|HTTP 410|net::ERR_INVALID_ARGUMENT/i.test(message)) return false;
      if (/Timeout .*exceeded|page\.goto|net::|Target page, context or browser has been closed/i.test(message)) {
        return true;
      }

      current = current?.cause;
    }

    // Unknown failures are not assumed to be transient. Retrying programming
    // errors hides defects and delays failure without improving reliability.
    return false;
  }

  function productRetryDelayMs(attempt) {
    return Math.min(1000 * (2 ** (attempt - 1)), 5000);
  }

  async function scrapeOneInContext(
    context,
    url,
    {
      attempts = productRetryAttempts,
      waitForStartSlot = null,
      onAttemptStart = null,
      onAttemptEnd = null,
    } = {}
  ) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // Wait before allocating a Playwright page so workers blocked by the
      // global rate gate do not consume renderer memory while idle.
      if (waitForStartSlot) await waitForStartSlot();

      onAttemptStart?.({ url, attempt, attempts });
      let page = null;
      try {
        page = await context.newPage();
        // Product-level retries recreate the page. A single navigation attempt
        // here avoids spending several 45s timeouts on one stalled renderer.
        return await scrapePage(page, url, { navigationAttempts: 1 });
      } catch (error) {
        lastError = error;

        if (attempt >= attempts || !isRetryableProductError(error)) {
          throw error;
        }

        logger.warn(
          `[retry ${attempt + 1}/${attempts}] ${url}: ${error.message}`
        );
        await sleep(productRetryDelayMs(attempt));
      } finally {
        if (page) await page.close().catch(() => {});
        onAttemptEnd?.({ url, attempt, attempts });
      }
    }

    throw lastError;
  }

  async function discover(context) {
    return discoverMsiProductUrls(context, seedUrls, {
      delayMs,
      concurrency,
      onProgress: ({ seedUrl, pageNumber, added, total }) =>
        logger.debug(`[discover pages] ${seedUrl} page=${pageNumber} added=${added} total=${total}`),
      onConcurrency: ({ phase, active, peak, limit, url }) =>
        logger.debug(
          `[discover concurrency] phase=${phase} active=${active} peak=${peak} limit=${limit}`
          + (url ? ` url=${url}` : '')
        ),
    });
  }

  async function crawl(session) {
    const urls = await discover(session.context);
    logger.debug(`Discovered ${urls.length} product URLs.`);

    const waitForStartSlot = createStartRateGate(delayMs);
    const errors = [];
    let activeScrapes = 0;
    let peakActiveScrapes = 0;

    logger.log(
      `[scrape concurrency] configured=${concurrency} products=${urls.length} delayMs=${delayMs}`
    );

    const products = (
      await runPool(urls, concurrency, async (workerIndex) => {
        const { createConfiguredBrowserContext } = await import('./scraper/browser.js');
        const workerId = workerIndex + 1;
        const { context: workerContext, contextOptions } = await createConfiguredBrowserContext(session.browser);
        const headers = contextOptions.extraHTTPHeaders;

        logger.debug(
          `[scrape worker ${workerId}] browser profile initialized `
          + `userAgent=${contextOptions.userAgent} `
          + `acceptLanguage=${headers['Accept-Language']}`
        );

        return {
        run: async (url, index) => {
          try {
            const product = await scrapeOneInContext(workerContext, url, {
              attempts: productRetryAttempts,
              waitForStartSlot,
              onAttemptStart: ({ attempt, attempts }) => {
                activeScrapes += 1;
                peakActiveScrapes = Math.max(peakActiveScrapes, activeScrapes);
                logger.debug(
                  `[scrape worker ${workerId}] start item=${index + 1}/${urls.length} `
                  + `attempt=${attempt}/${attempts} active=${activeScrapes} `
                  + `peak=${peakActiveScrapes} limit=${concurrency} url=${url}`
                );
              },
              onAttemptEnd: ({ attempt, attempts }) => {
                activeScrapes = Math.max(0, activeScrapes - 1);
                logger.debug(
                  `[scrape worker ${workerId}] end item=${index + 1}/${urls.length} `
                  + `attempt=${attempt}/${attempts} active=${activeScrapes} `
                  + `peak=${peakActiveScrapes} limit=${concurrency} url=${url}`
                );
              },
            });
            logger.debug(`[scrape ${index + 1}/${urls.length}] ${product.title ?? url}`);
            return product;
          } catch (error) {
            errors.push({ url, error: error.message });
            logger.error(`[scrape ${index + 1}/${urls.length}] ${url}: ${error.message}`);
            return null;
          }
        },
        close: async () => {
          await workerContext.close().catch(() => {});
          logger.debug(`[scrape worker ${workerId}] context closed`);
        },
      };
      })
    ).filter(Boolean);

    logger.log(
      `[scrape concurrency] completed peak=${peakActiveScrapes} configured=${concurrency}`
    );

    if (errors.length) {
      throw new Error(
        `Catalog crawl incomplete: ${errors.length} of ${urls.length} product(s) failed. `
        + 'Existing catalog was not overwritten.'
      );
    }

    const catalog = await repository.replaceAll(products);
    logger.log(`Crawling is completed`);
    return catalog;
  }

  async function scrapeSelectorInContext(context, selector) {
    const candidates = buildMsiProductUrlCandidates(selector);
    const expected = normalizeText(selector);
    const errors = [];

    for (const url of candidates) {
      try {
        const product = await scrapeOneInContext(context, url);
        const actual = normalizeText(product.title);

        if (!actual || (!actual.includes(expected) && !expected.includes(actual))) {
          errors.push(`${url}: resolved to "${product.title ?? 'unknown'}"`);
          continue;
        }

        await repository.upsertMany([product]);
        return product;
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    throw new Error(
      `Unable to resolve product "${selector}" directly from MSI. `
      + `Tried ${candidates.length} candidate URL(s). `
      + errors.slice(-3).join(' | ')
    );
  }

  async function scrapeSelectorsInContext(context, selectors) {
    const products = [];
    for (const selector of selectors) {
      const product = await scrapeSelectorInContext(context, selector);
      products.push(product);
      logger.log(`[direct] ${selector} -> ${product.title}`);
    }
    return products;
  }

  async function getCatalog({ refresh = false } = {}) {
    const current = await repository.load();

    if (!refresh && isUsableCatalog(current)) {
      logger.log(`Using saved catalog: ${current.products.length} products.`);
      return current;
    }

    if (!refresh && current.products.length > 0) {
      logger.warn('Saved catalog is invalid or contains non-product records; rebuilding it.');
    }

    if (!buildPromise) {
      buildPromise = (async () => {
        logger.log(
          refresh
            ? 'Refreshing MSI catalog...'
            : 'Catalog data requested; analyzing MSI catalog automatically...'
        );
        const catalog = await withBrowser(crawl);
        logger.log('Catalog is refreshed');
        return catalog;
      })().finally(() => {
        buildPromise = null;
      });
    }

    return buildPromise;
  }

  async function getProducts(options) {
    return (await getCatalog(options)).products;
  }

  async function scrapeOne(url) {
    return withBrowser((session) => scrapeOneInContext(session.context, url));
  }

  async function resolveProducts(selectors) {
    let catalog = await repository.load();
    const missing = [];

    for (const selector of selectors) {
      try {
        resolveProduct(catalog.products, selector);
      } catch (error) {
        if (!/^No product matches/.test(error.message)) throw error;
        missing.push(selector);
      }
    }

    if (missing.length) {
      logger.log(`Resolving ${missing.length} missing comparison product(s) directly from MSI...`);
      await withBrowser((session) => scrapeSelectorsInContext(session.context, missing));
      catalog = await repository.load();
    }

    return selectors.map((selector) => resolveProduct(catalog.products, selector));
  }

  return {
    getCatalog,
    getProducts,
    scrapeOne,
    resolveProducts,
  };
}
