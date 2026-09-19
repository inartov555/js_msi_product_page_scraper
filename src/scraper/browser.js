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

export async function gotoWithRetry(page, url, { attempts = 3, timeout = 45000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      const status = response?.status();
      const title = await page.title().catch(() => '');
      const body = await page.locator('body').innerText().catch(() => '');
      if ((status && status >= 400) || /access denied|forbidden|request blocked/i.test(`${title}\n${body}`)) {
        throw new Error(`HTTP ${status ?? 'unknown'} / access denied`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Failed to load ${url}: ${lastError?.message ?? lastError}`);
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
