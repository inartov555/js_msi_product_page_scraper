import { DEFAULT_BROWSER_CONTEXT, DEFAULT_BLOCKED_RESOURCE_TYPES } from '../config.js';

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
    });

    context = await browser.newContext({
      ...DEFAULT_BROWSER_CONTEXT,
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
    timeout = 45000,
    sleepFn = sleep,
    random = Math.random,
  } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const status = response?.status();
      const headers = response?.headers?.() ?? {};
      const title = await page.title().catch(() => '');
      const body = await page.locator('body').innerText().catch(() => '');
      const accessDenied = /access denied|forbidden|request blocked/i.test(`${title}\n${body}`);

      if ((status && status >= 400) || accessDenied) {
        const error = new Error(
          accessDenied
            ? `HTTP ${status ?? 'unknown'} / access denied`
            : `HTTP ${status}`
        );
        error.status = status ?? null;
        error.accessDenied = accessDenied || status === 403 || status === 429;
        error.retryAfterMs = parseRetryAfterMs(headers['retry-after']);
        throw error;
      }

      return response;
    } catch (error) {
      lastError = error;

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
  const button = page.getByRole('button', { name: /^(accept|accept all|allow all)$/i }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => {});
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
