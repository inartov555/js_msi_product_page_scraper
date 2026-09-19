import { msiSelectors } from './selectors.js';
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
    (selectors) => {
      const direct = [
        ...document.querySelectorAll(selectors.join(', ')),
      ].map((anchor) => anchor.href).filter(Boolean);

      if (direct.length) {
        return direct;
      }

      // Fallback for MSI layout changes.
      const candidates = [
        ...document.querySelectorAll('#content a[href], main a[href]'),
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
    msiSelectors.productCardLinks
  );
}

async function discoverSeed(page, seedUrl, discovered, { delayMs, onProgress }) {
  const seenForSeed = new Set();
  const seenPageFingerprints = new Set();
  let pageNumber = 1;

  while (true) {
    const url = listingUrl(seedUrl, pageNumber);
    await gotoWithRetry(page, url);
    await acceptCookiesIfPresent(page);

    const links = await extractListingLinks(page);
    const uniqueLinks = [...new Set(links.map(canonicalizeUrl))]
      .filter((candidate) => isMsiProductUrl(candidate, seedUrl));

    // Pagination is over when the page is empty.
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

    // Some stores return the last page again for page numbers past the end.
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

    // No new product for this category means pagination has wrapped/repeated.
    if (newForSeed === 0) return;

    pageNumber += 1;
    if (delayMs > 0) await sleep(delayMs);
  }
}

/**
 * Discover product URLs with bounded category concurrency.
 *
 * Pagination inside one category remains sequential because page N determines
 * whether page N+1 exists. Independent categories are processed concurrently,
 * which avoids speculative requests beyond the end of a category while still
 * removing the global serial bottleneck.
 */
export async function discoverMsiProductUrls(
  context,
  seedUrls,
  {
    delayMs = 250,
    concurrency = seedUrls.length || 1,
    onProgress = () => {},
  } = {}
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('discovery concurrency must be a positive integer.');
  }

  const discovered = new Set();
  const workerCount = Math.min(concurrency, seedUrls.length);
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    const page = await context.newPage();

    try {
      while (true) {
        const seedIndex = cursor;
        cursor += 1;
        if (seedIndex >= seedUrls.length) return;

        await discoverSeed(page, seedUrls[seedIndex], discovered, {
          delayMs,
          onProgress,
        });
      }
    } finally {
      await page.close().catch(() => {});
    }
  });

  await Promise.all(workers);
  return [...discovered];
}
