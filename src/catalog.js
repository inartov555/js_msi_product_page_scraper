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


let scraperModulesPromise = null;

async function loadScraperModules() {
  if (!scraperModulesPromise) {
    scraperModulesPromise = Promise.all([
      import('./scraper/discovery.js'),
      import('./scraper/extractor.js'),
      import('./scraper/productUrl.js'),
    ]).then(([discovery, extractor, productUrl]) => ({
      discoverMsiProductUrls: discovery.discoverMsiProductUrls,
      extractMsiProduct: extractor.extractMsiProduct,
      buildMsiProductUrlCandidates: productUrl.buildMsiProductUrlCandidates,
    }));
  }

  return scraperModulesPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      return await callback(session.context);
    } finally {
      await session.close();
    }
  }

  async function scrapePage(
    page,
    url,
    { navigationAttempts = 4, navigationTimeout = DEFAULT_NAVIGATION_TIMEOUT_MS } = {}
  ) {
    const { extractMsiProduct } = await loadScraperModules();
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

    // Extraction can fail transiently if the storefront returns an incomplete
    // document. One fresh-page retry is safer than treating that as permanent.
    return true;
  }

  function productRetryDelayMs(attempt) {
    return Math.min(1000 * (2 ** (attempt - 1)), 5000);
  }

  async function scrapeOneInContext(
    context,
    url,
    { attempts = productRetryAttempts, waitForStartSlot = null } = {}
  ) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // Wait before allocating a Playwright page so workers blocked by the
      // global rate gate do not consume renderer memory while idle.
      if (waitForStartSlot) await waitForStartSlot();

      const page = await context.newPage();
      try {
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
        await page.close().catch(() => {});
      }
    }

    throw lastError;
  }

  async function discover(context) {
    const { discoverMsiProductUrls } = await loadScraperModules();
    return discoverMsiProductUrls(context, seedUrls, {
      delayMs,
      concurrency,
      onProgress: ({ seedUrl, pageNumber, added, total }) =>
        logger.log(`[discover] ${seedUrl} page=${pageNumber} added=${added} total=${total}`),
    });
  }

  async function crawl(context) {
    const urls = await discover(context);
    logger.log(`Discovered ${urls.length} product URLs.`);

    const waitForStartSlot = createStartRateGate(delayMs);
    const errors = [];
    const products = (
      await runPool(urls, concurrency, async () => ({
        run: async (url, index) => {
          try {
            const product = await scrapeOneInContext(context, url, {
              attempts: productRetryAttempts,
              waitForStartSlot,
            });
            logger.log(`[scrape ${index + 1}/${urls.length}] ${product.title ?? url}`);
            return product;
          } catch (error) {
            errors.push({ url, error: error.message });
            logger.error(`[scrape ${index + 1}/${urls.length}] ${url}: ${error.message}`);
            return null;
          }
        },
      }))
    ).filter(Boolean);

    if (errors.length) {
      throw new Error(
        `Catalog crawl incomplete: ${errors.length} of ${urls.length} product(s) failed. `
        + 'Existing catalog was not overwritten.'
      );
    }

    const catalog = await repository.replaceAll(products);
    logger.log(`Full catalog saved: ${catalog.products.length} products.`);
    return catalog;
  }

  async function scrapeSelectorInContext(context, selector) {
    const { buildMsiProductUrlCandidates } = await loadScraperModules();
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
        logger.log(`Catalog analysis complete: ${catalog.products.length} products available.`);
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
    return withBrowser((context) => scrapeOneInContext(context, url));
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
      await withBrowser((context) => scrapeSelectorsInContext(context, missing));
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
