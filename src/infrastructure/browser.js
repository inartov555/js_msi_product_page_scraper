import { chromium } from 'playwright';
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

export function getHeadlessMode(
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
  const headless =
    getHeadlessMode(explicitHeadless);

  console.log(`Launching Chromium: headless=${headless}`);

  const browser = await chromium.launch({ headless, channel: 'chromium', });
  const context = await browser.newContext({ ...DEFAULT_BROWSER_CONTEXT, });
  const blockedResourceTypes = new Set(DEFAULT_BLOCKED_RESOURCE_TYPES);

  await context.route('**/*', async (route) => {
    if (blockedResourceTypes.has(route.request().resourceType())) {
      await route.abort();
      return;
    }

    await route.continue();
  });

  context.setDefaultTimeout(15000);
  try {
    const page = await context.newPage();
    console.log('UserAgent:', await page.evaluate(() => navigator.userAgent));
  } finally {
    await page.close().catch(() => {});
  }

  return {
    browser,
    context,
    page,
    headless,

    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
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
