import { chromium } from 'playwright';
import { DEFAULT_BROWSER_CONTEXT } from '../config.js';

export async function createBrowserSession({ headless = true } = {}) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const channel = !executablePath ? process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined : undefined;
  const browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
  });
  const context = await browser.newContext(DEFAULT_BROWSER_CONTEXT);
  context.setDefaultTimeout(15000);
  return {
    browser,
    context,
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
