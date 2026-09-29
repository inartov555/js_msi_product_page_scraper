import {
  DEFAULT_CRAWL_CONCURRENCY,
  DEFAULT_CRAWL_DELAY_MS,
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

export function createAdaptiveNavigationGate({
  intervalMs = DEFAULT_CRAWL_DELAY_MS,
  maxIntervalMs = 5000,
  accessDeniedPauseMs = 10000,
  sleepFn = sleep,
  now = Date.now,
  logger = null,
} = {}) {
  let nextStartAt = 0;
  let blockedUntil = 0;
  let currentIntervalMs = Math.max(0, intervalMs);
  let successStreak = 0;
  let mutex = Promise.resolve();

  async function beforeAttempt() {
    // Serialize only admission to page.goto(). Once a navigation has started,
    // that worker is free to load/extract concurrently with all other workers.
    const previous = mutex;
    let release;
    mutex = new Promise((resolve) => { release = resolve; });
    await previous;

    try {
      const waitMs = Math.max(nextStartAt, blockedUntil) - now();
      if (waitMs > 0) await sleepFn(waitMs);
      nextStartAt = now() + currentIntervalMs;
    } finally {
      release();
    }
  }

  async function onAttemptResult(result) {
    if (result?.accessDenied || result?.status === 403 || result?.status === 429) {
      successStreak = 0;
      const retryAfterMs = Number.isFinite(result?.retryAfterMs)
        ? result.retryAfterMs
        : 0;
      const pauseMs = Math.max(accessDeniedPauseMs, retryAfterMs);
      blockedUntil = Math.max(blockedUntil, now() + pauseMs);
      currentIntervalMs = Math.min(
        maxIntervalMs,
        Math.max(currentIntervalMs * 2, intervalMs || 100)
      );
      logger?.warn?.(
        `[throttle] MSI returned ${result.status ?? 'access denied'}; `
        + `pausing new navigations for ${pauseMs}ms and pacing at ${currentIntervalMs}ms.`
      );
      return;
    }

    if (result?.ok) {
      successStreak += 1;
      // Recover conservatively after a sustained healthy run. Never go faster
      // than the configured interval; this prevents another 50-request burst.
      if (successStreak >= 25 && currentIntervalMs > intervalMs) {
        currentIntervalMs = Math.max(intervalMs, Math.floor(currentIntervalMs * 0.8));
        successStreak = 0;
      }
    }
  }

  return {
    beforeAttempt,
    onAttemptResult,
    snapshot: () => ({ currentIntervalMs, blockedUntil, nextStartAt }),
  };
}


export function createCatalogService({
  repository,
  seedUrls = DEFAULT_SEED_URLS,
  concurrency = DEFAULT_CRAWL_CONCURRENCY,
  delayMs = DEFAULT_CRAWL_DELAY_MS,
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

  async function scrapePage(page, url, navigation = undefined) {
    const { extractMsiProduct } = await loadScraperModules();
    const product = await extractMsiProduct(page, url, { navigation });
    if (!product?.title) throw new Error(`Not a product page: ${url}`);

    const problems = validateProduct(product);
    if (problems.length) {
      logger.warn(`Incomplete product ${product.title ?? url}: ${problems.join(', ')}`);
    }

    return product;
  }

  async function scrapeOneInContext(context, url) {
    const page = await context.newPage();
    try {
      return await scrapePage(page, url);
    } finally {
      await page.close().catch(() => {});
    }
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

    const errors = [];
    const navigationGate = createAdaptiveNavigationGate({
      intervalMs: delayMs,
      logger,
    });
    const products = (
      await runPool(urls, concurrency, async () => {
        // Keep exactly one page per logical worker. At concurrency=50 this
        // remains 50-way parallel, but avoids creating/destroying hundreds of
        // renderer/page objects during a long crawl. Navigation replaces the
        // previous document before the next product is extracted.
        let page = await context.newPage();

        return {
          run: async (url, index) => {
            try {
              if (page.isClosed()) page = await context.newPage();

              const product = await scrapePage(page, url, {
                beforeAttempt: navigationGate.beforeAttempt,
                onAttemptResult: navigationGate.onAttemptResult,
              });
              logger.log(`[scrape ${index + 1}/${urls.length}] ${product.title ?? url}`);
              return product;
            } catch (error) {
              errors.push({ url, error: error.message });
              logger.error(`[scrape ${index + 1}/${urls.length}] ${url}: ${error.message}`);
              return null;
            } finally {
              // Navigation pacing is handled by the shared adaptive gate. DOM
              // extraction remains fully parallel across all 50 workers.
            }
          },
          close: async () => {
            await page.close().catch(() => {});
          },
        };
      })
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
