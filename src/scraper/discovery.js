import { msiLocators } from './locators.js';
import { acceptCookiesIfPresent, gotoWithRetry, sleep } from './browser.js';


function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  } catch {
    return value;
  }
}

function listingUrl(seedUrl, pageNumber) {
  const url = new URL(seedUrl);
  url.searchParams.delete('limit');

  if (pageNumber > 1) {
    url.searchParams.set('page', String(pageNumber));
  } else {
    url.searchParams.delete('page');
  }

  return url.href;
}

function isMsiProductUrl(candidate, baseUrl) {
  try {
    const url = new URL(candidate);
    const base = new URL(baseUrl);

    if (url.origin !== base.origin) return false;

    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const lowerPath = pathname.toLowerCase();

    if (/\/(account|checkout|cart|contact|support|policy|search)(\/|$)/i.test(pathname)) return false;
    if (lowerPath === '/product-comparison' || lowerPath === '/microsoft-windows11') return false;

    const params = [...url.searchParams.entries()];
    if (params.length > 0) {
      return params.length === 1 && params[0][0] === 'product_id' && Boolean(params[0][1]);
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments.length < 2) return false;

    const basePath = base.pathname.replace(/\/+$/, '') || '/';
    if (pathname === basePath) return false;

    return true;
  } catch {
    return false;
  }
}

async function extractListingLinks(page) {
  return page.evaluate(
    (locators) => {
      const direct = [
        ...document.querySelectorAll(locators.productCardLinks.join(', ')),
      ].map((anchor) => anchor.href).filter(Boolean);

      if (direct.length) {
        return direct;
      }

      // Fallback for MSI layout changes.
      const candidates = [
        ...document.querySelectorAll(locators.discoveryFallbackLinks),
      ];

      return candidates
        .filter((anchor) => {
          let node = anchor.parentElement;

          for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
            const text = node.innerText || '';
            if (/\$\s*\d/.test(text) && /compare|add to cart|notify me/i.test(text)) {
              return true;
            }
          }

          return false;
        })
        .map((anchor) => anchor.href)
        .filter(Boolean);
    },
    {
      productCardLinks: msiLocators.productCardLinks,
      discoveryFallbackLinks: msiLocators.discoveryFallbackLinks,
    }
  );
}

async function fetchListingPage(
  context,
  seedUrl,
  pageNumber,
  { navigationAttempts = 1 } = {}
) {
  const page = await context.newPage();

  try {
    const url = listingUrl(seedUrl, pageNumber);
    await gotoWithRetry(page, url, { attempts: navigationAttempts });
    await acceptCookiesIfPresent(page);

    const links = await extractListingLinks(page);
    const uniqueLinks = [...new Set(links.map(canonicalizeUrl))]
      .filter((candidate) => isMsiProductUrl(candidate, seedUrl));

    return {
      seedUrl,
      pageNumber,
      uniqueLinks,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  async function acquire() {
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise((resolve) => queue.push(resolve));
    active += 1;
  }

  function release() {
    active -= 1;
    queue.shift()?.();
  }

  return { acquire, release, get active() { return active; } };
}

function getErrorDetails(error) {
  let current = error;
  let status = null;
  let accessDenied = false;

  for (let depth = 0; current && depth < 8; depth += 1) {
    if (status == null && Number.isFinite(current.status)) status = current.status;
    accessDenied ||= Boolean(current.accessDenied);
    current = current.cause;
  }

  return {
    status,
    accessDenied: accessDenied || status === 403 || status === 429,
  };
}

function isRetryableDiscoveryError(error) {
  const { status, accessDenied } = getErrorDetails(error);
  if (accessDenied || status === 408 || status === 429) return true;
  if (status != null) return status >= 500;

  const message = String(error?.message ?? error);
  return /Timeout|page\.goto|net::|Target page, context or browser has been closed/i.test(message);
}

function discoveryRetryDelay(attempt, error, retryBaseDelayMs, random) {
  const { accessDenied } = getErrorDetails(error);
  const base = accessDenied ? retryBaseDelayMs : Math.max(1000, retryBaseDelayMs / 2);
  const exponential = Math.min(base * (2 ** Math.max(0, attempt - 1)), 60000);
  const jitter = 0.85 + (Math.max(0, Math.min(1, random())) * 0.30);
  return Math.round(exponential * jitter);
}

/**
 * Discover product URLs.
 *
 * Each seed paginates sequentially because the result of page N determines
 * whether page N+1 should be requested. A small semaphore is the only global
 * scheduler: it caps the number of listing requests across all seeds.
 */
export async function discoverMsiProductUrls(
  context,
  seedUrls,
  {
    delayMs = 250,
    concurrency = seedUrls.length || 1,
    onProgress = () => {},
    onConcurrency = () => {},
    discoveryAttempts = 3,
    retryBaseDelayMs = 8000,
    accessDeniedPauseMs = 5000,
    navigationAttempts = 1,
    random = Math.random,
  } = {}
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('discovery concurrency must be a positive integer.');
  }
  if (!Number.isInteger(discoveryAttempts) || discoveryAttempts < 1) {
    throw new Error('discovery attempts must be a positive integer.');
  }

  const discovered = new Set();
  const failures = [];
  const semaphore = createSemaphore(concurrency);
  let peakActiveRequests = 0;
  let pauseUntil = 0;

  async function waitForGlobalPause() {
    const waitMs = pauseUntil - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }

  async function fetchWithRetry(seedUrl, pageNumber) {
    let lastError;

    for (let attempt = 1; attempt <= discoveryAttempts; attempt += 1) {
      await waitForGlobalPause();
      await semaphore.acquire();
      peakActiveRequests = Math.max(peakActiveRequests, semaphore.active);
      const url = listingUrl(seedUrl, pageNumber);
      onConcurrency({
        phase: 'start',
        active: semaphore.active,
        peak: peakActiveRequests,
        limit: concurrency,
        url,
      });

      try {
        return await fetchListingPage(context, seedUrl, pageNumber, { navigationAttempts });
      } catch (error) {
        lastError = error;
        const { accessDenied } = getErrorDetails(error);
        if (accessDenied && accessDeniedPauseMs > 0) {
          pauseUntil = Math.max(pauseUntil, Date.now() + accessDeniedPauseMs);
        }

        if (attempt >= discoveryAttempts || !isRetryableDiscoveryError(error)) {
          throw error;
        }

        const retryDelayMs = discoveryRetryDelay(attempt, error, retryBaseDelayMs, random);
        console.warn(
          `[discover retry ${attempt + 1}/${discoveryAttempts}] ${url} ` +
          `after ${retryDelayMs}ms: ${error?.message ?? error}`
        );
        if (retryDelayMs > 0) await sleep(retryDelayMs);
      } finally {
        const activeBeforeRelease = semaphore.active;
        semaphore.release();
        onConcurrency({
          phase: 'end',
          active: Math.max(0, activeBeforeRelease - 1),
          peak: peakActiveRequests,
          limit: concurrency,
          url,
        });
      }
    }

    throw lastError;
  }

  async function crawlSeed(seedUrl) {
    const seenForSeed = new Set();
    const seenPageFingerprints = new Set();

    for (let pageNumber = 1; ; pageNumber += 1) {
      let result;
      try {
        result = await fetchWithRetry(seedUrl, pageNumber);
      } catch (error) {
        failures.push({ seedUrl, pageNumber, error });
        console.error(`[discover failed] ${listingUrl(seedUrl, pageNumber)}: ${error?.message ?? error}`);
        return;
      }

      const { uniqueLinks } = result;
      if (uniqueLinks.length === 0) {
        onProgress({
          seedUrl,
          pageNumber,
          foundOnPage: 0,
          added: 0,
          total: discovered.size,
          done: true,
          reason: 'empty-page',
        });
        return;
      }

      const fingerprint = [...uniqueLinks].sort().join('\n');
      if (seenPageFingerprints.has(fingerprint)) {
        onProgress({
          seedUrl,
          pageNumber,
          foundOnPage: uniqueLinks.length,
          added: 0,
          total: discovered.size,
          done: true,
          reason: 'repeated-page',
        });
        return;
      }
      seenPageFingerprints.add(fingerprint);

      let added = 0;
      let newForSeed = 0;
      for (const productUrl of uniqueLinks) {
        if (!seenForSeed.has(productUrl)) {
          seenForSeed.add(productUrl);
          newForSeed += 1;
        }
        if (!discovered.has(productUrl)) {
          discovered.add(productUrl);
          added += 1;
        }
      }

      onProgress({
        seedUrl,
        pageNumber,
        foundOnPage: uniqueLinks.length,
        added,
        total: discovered.size,
      });

      if (newForSeed === 0) return;
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(seedUrls.map(crawlSeed));

  if (failures.length > 0) {
    const detail = failures
      .map(({ seedUrl, pageNumber, error }) =>
        `${listingUrl(seedUrl, pageNumber)}: ${error?.message ?? error}`
      )
      .join('; ');

    const error = new AggregateError(
      failures.map((failure) => failure.error),
      `Discovery failed for ${failures.length} listing page(s) after retries: ${detail}`
    );
    error.discoveredCount = discovered.size;
    error.failures = failures;
    throw error;
  }

  return [...discovered];
}
