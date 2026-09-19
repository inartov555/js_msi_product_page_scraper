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

async function fetchListingPage(context, seedUrl, pageNumber) {
  const page = await context.newPage();

  try {
    const url = listingUrl(seedUrl, pageNumber);
    await gotoWithRetry(page, url);
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

function createSeedState(seedUrl) {
  return {
    seedUrl,
    nextPageToSchedule: 1,
    done: false,
    seenForSeed: new Set(),
    seenPageFingerprints: new Set(),
  };
}

function buildRequestBatch(states, concurrency, cursor) {
  const jobs = [];
  let nextCursor = cursor;

  if (states.length === 0) {
    return { jobs, cursor: nextCursor };
  }

  while (jobs.length < concurrency) {
    let selected = null;

    for (let checked = 0; checked < states.length; checked += 1) {
      const stateIndex = nextCursor % states.length;
      nextCursor = (nextCursor + 1) % states.length;
      const state = states[stateIndex];

      if (!state.done) {
        selected = state;
        break;
      }
    }

    if (!selected) break;

    jobs.push({
      state: selected,
      seedUrl: selected.seedUrl,
      pageNumber: selected.nextPageToSchedule,
    });
    selected.nextPageToSchedule += 1;
  }

  return { jobs, cursor: nextCursor };
}

function commitListingPage(state, result, discovered, onProgress) {
  if (state.done) return;

  const {
    seedUrl,
    pageNumber,
    uniqueLinks,
  } = result;

  // Pagination is over when the page is empty. Other pages for this seed may
  // already be in flight because discovery deliberately prefetches pages to use
  // the full concurrency budget; those later results are ignored when committed.
  if (uniqueLinks.length === 0) {
    state.done = true;
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
  if (state.seenPageFingerprints.has(fingerprint)) {
    state.done = true;
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
  state.seenPageFingerprints.add(fingerprint);

  let added = 0;
  let newForSeed = 0;

  for (const productUrl of uniqueLinks) {
    if (!state.seenForSeed.has(productUrl)) {
      state.seenForSeed.add(productUrl);
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
  if (newForSeed === 0) {
    state.done = true;
  }
}

/**
 * Discover product URLs with one global listing-request concurrency limit.
 *
 * To make a value such as concurrency=50 meaningful even when there are only
 * eight category seeds, pages are prefetched speculatively across categories.
 * Up to `concurrency` listing pages are therefore in flight at once. Results are
 * still committed in page order per category, and once an empty/repeated page is
 * reached, any already-fetched later pages for that category are discarded.
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
  const states = seedUrls.map(createSeedState);
  let schedulingCursor = 0;

  while (states.some((state) => !state.done)) {
    const batch = buildRequestBatch(states, concurrency, schedulingCursor);
    schedulingCursor = batch.cursor;

    if (batch.jobs.length === 0) break;

    const settled = await Promise.allSettled(
      batch.jobs.map(async (job) => ({
        ...job,
        result: await fetchListingPage(context, job.seedUrl, job.pageNumber),
      }))
    );

    const rejected = settled.find((entry) => entry.status === 'rejected');
    if (rejected) {
      throw rejected.reason;
    }

    const completed = settled.map((entry) => entry.value);

    for (const state of states) {
      const stateResults = completed
        .filter((entry) => entry.state === state)
        .sort((left, right) => left.pageNumber - right.pageNumber);

      for (const entry of stateResults) {
        commitListingPage(state, entry.result, discovered, onProgress);
        if (state.done) break;
      }
    }

    if (delayMs > 0 && states.some((state) => !state.done)) {
      await sleep(delayMs);
    }
  }

  return [...discovered];
}
