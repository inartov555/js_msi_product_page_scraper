/*
 * Target URL to pass: https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, '../output/product.json');


async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    throw new Error('Product URL is required. Usage: node scraper.js <url>');
  }
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    console.log(`Scraping: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    // Wait for the product content rather than using an arbitrary sleep.
    await page.locator('h1, h2').first().waitFor({ state: 'visible' });
    await page
      .waitForFunction(
        () => /\$\s*\d|in stock|out of stock|pre[- ]?order/i.test(document.body.innerText),
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});

    const product = await extractProduct(page);
    validateResult(product);

    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(product, null, 2)}\n`, 'utf8');

    console.log(`Saved: ${OUTPUT_FILE}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Scrape failed: ${error.message}`);
  process.exitCode = 1;
});
