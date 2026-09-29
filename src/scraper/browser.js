import { DEFAULT_BROWSER_CONTEXT, DEFAULT_BLOCKED_RESOURCE_TYPES } from '../config.js';
import { msiLocators } from './locators.js';

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  if (/^(true|1|yes)$/i.test(String(value))) {
    return true;
  }

  if (/^(false|0|no)$/i.test(String(value))) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function getHeadlessMode(
  explicitValue = undefined
) {
  if (typeof explicitValue === 'boolean') {
    return explicitValue;
  }

  return parseBoolean(process.env.HEADLESS, true);
}

export async function createBrowserSession({
  headless: explicitHeadless,
} = {}) {
  const { chromium } = await import('playwright');
  const headless = getHeadlessMode(explicitHeadless);
  let browser = null;
  let context = null;
  let closed = false;

  console.log(`Launching Chromium: headless=${headless}`);

  try {
    browser = await chromium.launch({
      headless,
      channel: 'chromium',
      args: [
        // Keep background browser features from consuming memory/network for a
        // short-lived scraping workload. These do not change page JavaScript.
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-features=BackForwardCache,MediaRouter,Prerender2,SpeculationRulesPrefetch',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });

    context = await browser.newContext({
      ...DEFAULT_BROWSER_CONTEXT,
      // Service workers can keep extra script/runtime state alive and can also
      // bypass context.route(). The scraper does not need them.
      serviceWorkers: 'block',
      acceptDownloads: false,
    });

    const blockedResourceTypes = new Set(
      DEFAULT_BLOCKED_RESOURCE_TYPES
    );

    await context.route('**/*', async (route) => {
      if (blockedResourceTypes.has(route.request().resourceType())) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    context.setDefaultTimeout(15000);

    const uaPage = await context.newPage();

    try {
      const userAgent = await uaPage.evaluate(
        () => navigator.userAgent
      );

      console.log(`Browser UserAgent: ${userAgent}`);
    } finally {
      await uaPage.close().catch(() => {});
    }

    return {
      get browser() {
        return browser;
      },

      get context() {
        return context;
      },

      headless,

      async close() {
        if (closed) return;
        closed = true;

        // Drop the session's strong references before awaiting shutdown so the
        // browser/context become collectible as soon as Playwright releases them.
        const activeContext = context;
        const activeBrowser = browser;
        context = null;
        browser = null;

        await activeContext?.close().catch(() => {});
        await activeBrowser?.close().catch(() => {});
      },
    };
  } catch (error) {
    // Creation can fail after Chromium has already started. Always tear down
    // partially-created Playwright resources before propagating the error.
    const activeContext = context;
    const activeBrowser = browser;
    context = null;
    browser = null;
    closed = true;

    await activeContext?.close().catch(() => {});
    await activeBrowser?.close().catch(() => {});
    throw error;
  }
}

function parseRetryAfterMs(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function retryDelayMs(error, attempt) {
  if (Number.isFinite(error?.retryAfterMs)) {
    return Math.min(Math.max(error.retryAfterMs, 1000), 60000);
  }

  if (error?.accessDenied || error?.status === 403 || error?.status === 429) {
    return Math.min(5000 * (2 ** (attempt - 1)), 30000);
  }

  if (error?.status >= 500) {
    return Math.min(1500 * (2 ** (attempt - 1)), 10000);
  }

  return Math.min(1000 * (2 ** (attempt - 1)), 8000);
}

function isRetryableNavigationError(error) {
  if (error?.accessDenied) return true;
  if (error?.status === 408 || error?.status === 429) return true;
  if (error?.status >= 500) return true;
  if (error?.status >= 400) return false;
  return true;
}

export async function gotoWithRetry(
  page,
  url,
  {
    attempts = 4,
    timeout = 30000,
    sleepFn = sleep,
    random = Math.random,
    beforeAttempt = null,
    onAttemptResult = null,
  } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let attemptReported = false;

    try {
      if (beforeAttempt) {
        await beforeAttempt({ url, attempt });
      }

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const status = response?.status();
      const headers = response?.headers?.() ?? {};
      const bodyLocator = page.locator(msiLocators.body);
      const accessDenied = typeof bodyLocator.evaluate === 'function'
        ? await bodyLocator.evaluate((body) => {
            // Return only a boolean across the Playwright boundary. The previous
            // implementation copied the entire body text into Node for every page,
            // which multiplied transient memory at high concurrency.
            const text = body?.textContent || '';
            return /access denied|forbidden|request blocked/i.test(
              `${document.title || ''}\n${text}`
            );
          }).catch(() => false)
        : /access denied|forbidden|request blocked/i.test(
            `${await page.title().catch(() => '')}\n${await bodyLocator.innerText().catch(() => '')}`
          );


      if ((status && status >= 400) || accessDenied) {
        const error = new Error(
          accessDenied
            ? `HTTP ${status ?? 'unknown'} / access denied`
            : `HTTP ${status}`
        );
        error.status = status ?? null;
        error.accessDenied = accessDenied || status === 403 || status === 429;
        error.retryAfterMs = parseRetryAfterMs(headers['retry-after']);

        if (onAttemptResult) {
          await onAttemptResult({
            url,
            attempt,
            ok: false,
            status: error.status,
            accessDenied: error.accessDenied,
            retryAfterMs: error.retryAfterMs,
            error,
          });
        }
        attemptReported = true;
        throw error;
      }

      if (onAttemptResult) {
        await onAttemptResult({
          url,
          attempt,
          ok: true,
          status: status ?? null,
          accessDenied: false,
          retryAfterMs: null,
          response,
        });
      }
      attemptReported = true;
      return response;
    } catch (error) {
      lastError = error;

      if (!attemptReported && onAttemptResult) {
        await onAttemptResult({
          url,
          attempt,
          ok: false,
          status: error?.status ?? null,
          accessDenied: Boolean(error?.accessDenied),
          retryAfterMs: error?.retryAfterMs ?? null,
          error,
        });
      }

      if (attempt >= attempts || !isRetryableNavigationError(error)) {
        break;
      }

      const baseDelay = retryDelayMs(error, attempt);
      // Small jitter prevents all concurrent workers from retrying together.
      const jitter = 0.85 + (Math.max(0, Math.min(1, random())) * 0.30);
      await sleepFn(Math.round(baseDelay * jitter));
    }
  }

  throw new Error(
    `Failed to load ${url}: ${lastError?.message ?? lastError}`,
    { cause: lastError }
  );
}

export async function acceptCookiesIfPresent(page) {
  const button = page.getByRole(msiLocators.cookieConsent.role, { name: msiLocators.cookieConsent.name }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => {});
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
