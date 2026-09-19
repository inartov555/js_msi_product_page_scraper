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

function createSeedState(seedUrl) {
  return {
    seedUrl,
    nextPageToSchedule: 1,
    nextPageToCommit: 1,
    done: false,
    seenForSeed: new Set(),
    seenPageFingerprints: new Set(),
    inFlightPages: new Set(),
    completedPages: new Map(),
  };
}

function outstandingPageCount(state) {
  return state.inFlightPages.size + state.completedPages.size;
}

function perSeedLookahead(states, concurrency) {
  const openSeeds = states.filter((state) => !state.done).length;
  return Math.max(1, Math.ceil(concurrency / Math.max(1, openSeeds)));
}

function takeNextJob(states, concurrency, cursor) {
  if (states.length === 0) return { job: null, cursor };

  const lookahead = perSeedLookahead(states, concurrency);
  let nextCursor = cursor;

  for (let checked = 0; checked < states.length; checked += 1) {
    const stateIndex = nextCursor % states.length;
    nextCursor = (nextCursor + 1) % states.length;
    const state = states[stateIndex];

    if (state.done || outstandingPageCount(state) >= lookahead) continue;

    const pageNumber = state.nextPageToSchedule;
    state.nextPageToSchedule += 1;
    state.inFlightPages.add(pageNumber);

    return {
      job: { state, seedUrl: state.seedUrl, pageNumber },
      cursor: nextCursor,
    };
  }

  return { job: null, cursor: nextCursor };
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
  const fingerprint = [...uniqueLinks].sort().join('\\n');
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

function commitReadyPages(state, discovered, onProgress) {
  while (!state.done && state.completedPages.has(state.nextPageToCommit)) {
    const pageNumber = state.nextPageToCommit;
    const result = state.completedPages.get(pageNumber);
    state.completedPages.delete(pageNumber);
    state.nextPageToCommit += 1;

    commitListingPage(state, result, discovered, onProgress);
  }

  if (state.done) {
    // Results for pages beyond the terminal page may already have completed
    // because pagination is prefetched. They are intentionally discarded.
    state.completedPages.clear();
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
 *
 * A single failed listing request must not abort the entire discovery run. A
 * failed page is retried on a fresh Playwright page while unrelated categories
 * keep making progress. 403/429 responses additionally trigger a short global
 * scheduling pause so the crawler does not immediately refill all 50 slots into
 * a server-side throttle window.
 */
export async function discoverMsiProductUrls(
  context,
  seedUrls,
  {
    delayMs = 250,
    concurrency = seedUrls.length || 1,
    onProgress = () => {},
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
  const states = seedUrls.map(createSeedState);
  const events = new Set();
  const failures = [];
  let schedulingCursor = 0;
  let globalPauseUntil = 0;
  let resumeEvent = null;

  function errorDetails(error) {
    let current = error;
    let status = null;
    let accessDenied = false;

    for (let depth = 0; current && depth < 8; depth += 1) {
      if (status == null && Number.isFinite(current.status)) {
        status = current.status;
      }
      accessDenied ||= Boolean(current.accessDenied);
      current = current.cause;
    }

    return {
      status,
      accessDenied: accessDenied || status === 403 || status === 429,
    };
  }

  function isRetryableDiscoveryError(error) {
    const { status, accessDenied } = errorDetails(error);
    if (accessDenied) return true;
    if (status === 408 || status === 429) return true;
    if (status != null) return status >= 500;

    // Network/protocol/time-out failures often do not carry an HTTP status.
    return true;
  }

  function retryDelay(attempt, error) {
    const { accessDenied } = errorDetails(error);
    const base = accessDenied ? retryBaseDelayMs : Math.max(1000, retryBaseDelayMs / 2);
    const exponential = Math.min(base * (2 ** Math.max(0, attempt - 1)), 60000);
    const jitter = 0.85 + (Math.max(0, Math.min(1, random())) * 0.30);
    return Math.round(exponential * jitter);
  }

  function launchRequest(job) {
    let event;
    event = fetchListingPage(
      context,
      job.seedUrl,
      job.pageNumber,
      { navigationAttempts }
    ).then(
      (result) => ({ type: 'request', event, job, result }),
      (error) => ({ type: 'request', event, job, error })
    );
    events.add(event);
  }

  function launchCooldown() {
    if (!(delayMs > 0)) return false;

    let event;
    event = sleep(delayMs).then(() => ({ type: 'cooldown', event }));
    events.add(event);
    return true;
  }

  function launchRetry(job, error) {
    const delay = retryDelay(job.discoveryAttempt, error);
    const nextAttempt = job.discoveryAttempt + 1;

    console.warn(
      `[discover retry ${nextAttempt}/${discoveryAttempts}] ${listingUrl(job.seedUrl, job.pageNumber)} ` +
      `after ${delay}ms: ${error?.message ?? error}`
    );

    let event;
    event = sleep(delay).then(() => ({
      type: 'retry',
      event,
      job: { ...job, discoveryAttempt: nextAttempt },
    }));
    events.add(event);
  }

  function ensureResumeEvent() {
    if (resumeEvent || Date.now() >= globalPauseUntil) return;

    const waitMs = Math.max(1, globalPauseUntil - Date.now());
    let event;
    event = sleep(waitMs).then(() => ({ type: 'resume', event }));
    resumeEvent = event;
    events.add(event);
  }

  function pauseNewScheduling(error) {
    const { accessDenied } = errorDetails(error);
    if (!accessDenied || !(accessDeniedPauseMs > 0)) return;

    globalPauseUntil = Math.max(globalPauseUntil, Date.now() + accessDeniedPauseMs);
    ensureResumeEvent();
  }

  function fillAvailableSlots() {
    let scheduled = 0;

    if (Date.now() < globalPauseUntil) {
      ensureResumeEvent();
      return scheduled;
    }

    while (events.size < concurrency) {
      const selection = takeNextJob(states, concurrency, schedulingCursor);
      schedulingCursor = selection.cursor;
      if (!selection.job) break;

      launchRequest({ ...selection.job, discoveryAttempt: 1 });
      scheduled += 1;
    }

    return scheduled;
  }

  fillAvailableSlots();

  while (events.size > 0 || states.some((state) => !state.done)) {
    if (events.size === 0) {
      if (Date.now() < globalPauseUntil) {
        ensureResumeEvent();
      } else if (fillAvailableSlots() === 0) {
        break;
      }
    }

    const outcome = await Promise.race(events);
    events.delete(outcome.event);

    if (outcome.type === 'resume') {
      if (resumeEvent === outcome.event) resumeEvent = null;
      if (Date.now() < globalPauseUntil) {
        ensureResumeEvent();
      } else {
        fillAvailableSlots();
      }
      continue;
    }

    if (outcome.type === 'cooldown') {
      fillAvailableSlots();
      continue;
    }

    if (outcome.type === 'retry') {
      const { job } = outcome;

      if (job.state.done) {
        job.state.inFlightPages.delete(job.pageNumber);
        fillAvailableSlots();
      } else {
        launchRequest(job);
      }
      continue;
    }

    const { job } = outcome;

    if (outcome.error) {
      pauseNewScheduling(outcome.error);

      if (
        !job.state.done &&
        job.discoveryAttempt < discoveryAttempts &&
        isRetryableDiscoveryError(outcome.error)
      ) {
        // Keep this page reserved in inFlightPages while it cools down. That
        // prevents speculative look-ahead for this category from growing just
        // because its required page is being retried.
        launchRetry(job, outcome.error);
        continue;
      }

      job.state.inFlightPages.delete(job.pageNumber);
      job.state.done = true;
      job.state.completedPages.clear();

      failures.push({
        seedUrl: job.seedUrl,
        pageNumber: job.pageNumber,
        error: outcome.error,
      });

      console.error(
        `[discover failed] ${listingUrl(job.seedUrl, job.pageNumber)}: ` +
        `${outcome.error?.message ?? outcome.error}`
      );

      fillAvailableSlots();
      continue;
    }

    job.state.inFlightPages.delete(job.pageNumber);

    if (!job.state.done && job.pageNumber >= job.state.nextPageToCommit) {
      job.state.completedPages.set(job.pageNumber, outcome.result);
      commitReadyPages(job.state, discovered, onProgress);
    }

    // A completed request frees one worker slot. Preserve the configured
    // inter-request delay without blocking progress processing for other
    // completed requests: the slot cools down independently, then refills.
    if (states.some((state) => !state.done)) {
      if (!launchCooldown()) fillAvailableSlots();
    }
  }

  // Terminal/failed categories can still have speculative requests or retry
  // timers outstanding. Drain them so no page/timer escapes this operation.
  if (events.size > 0) {
    await Promise.allSettled([...events]);
  }

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
