/**
 * MSI Product Page Scraper
 *
 * Flow:
 * main() opens the product page, waits for content, calls extractProduct(),
 * validates the result, and saves output/product.json.
 * 
 * Architecture:
 *
 *   main()
 *   ├─ acceptCookiesIfPresent()
 *   ├─ extractProduct()
 *   │  ├─ firstVisibleText()
 *   │  ├─ extractCategoryTree()
 *   │  ├─ extractImages()
 *   │  ├─ extractSpecs()
 *   │  ├─ extractPricePair()
 *   │  │  ├─ firstVisibleText()
 *   │  │  └─ parsePrice()
 *   │  ├─ extractRating()
 *   │  │  ├─ firstVisibleText()
 *   │  │  └─ parsePrice()
 *   │  ├─ extractItemId()
 *   │  ├─ extractBrand()
 *   │  ├─ extractAvailability()
 *   │  │  ├─ firstVisibleText()
 *   │  │  └─ normalizeAvailability()
 *   │  └─ findSpecValue()
 *   └─ validateResult()
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, '../output/product.json');

const TARGET_URL =
  'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

console.log = (...args) => originalConsole.log('[INFO]', ...args);
console.warn = (...args) => originalConsole.warn('[WARN]', ...args);
console.error = (...args) => originalConsole.error('[ERROR]', ...args);


class MsiProductPageLocators {
  constructor(page) {
    this.page = page;
  }

  acceptCookiesButton() {
    return this.page
      .getByRole('button', { name: /^accept$/i })
      .first();
  }

  body() {
    return this.page.locator('body');
  }

  productTitle() {
    return this.page
      .locator('.product-detail h2.crop-text-2.title')
      .first();
  }

  productTitleSelector() {
    return '.product-detail h2.crop-text-2.title';
  }

  productDescriptionSelectors() {
    return [
      '.product-detail h2.crop-text-2.title + div p',
    ];
  }

  regularPriceSelectors() {
    return ['#prices-old'];
  }

  currentPriceSelectors() {
    return ['#prices-new'];
  }

  priceWrapperSelectors() {
    return ['#prices-wrapper'];
  }

  priceWrapperSelector() {
    return '#prices-wrapper';
  }

  productQuantitySelectors() {
    return ['#product_qty'];
  }

  breadcrumbSelectors() {
    return [
      'ol.breadcrumb',
      'ul.breadcrumb',
    ];
  }

  mainImageSelector() {
    return '#imagePopup';
  }

  carouselImageSelector() {
    return '#carouselImages img.product-detail-thumb-bto';
  }

  specificationSelectors() {
    return {
      tables: '.product-detail table.table.table-borderless',
      tableRows: 'tr',
      tableCells: ':scope > th, :scope > td',
    };
  }

  ratingSelectors() {
    return [
      '#description-list-average-rating #average-rating-info',
    ];
  }

  productIdInput() {
    return this.page
      .locator('#product_qty input[name="product_id"]')
      .first();
  }

  viewItemAnalyticsScript() {
    return this.page
      .locator('script')
      .filter({
        hasText: /gtag\("event",\s*"view_item"/,
      })
      .first();
  }
}


async function acceptCookiesIfPresent(locators) {
  const acceptButton = locators.acceptCookiesButton();

  try {
    await acceptButton.waitFor({
      state: 'visible',
      timeout: 5000,
    });

    await acceptButton.click();
    console.log('Cookie consent accepted.');
  } catch (error) {
    if (error.name !== 'TimeoutError') {
      console.error('Failed to accept cookie consent:', error);
    }
  }
}

// Normalizes text by trimming whitespace and converting empty values to null
function cleanText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

// Extracts a finite numeric value from a price-like input
function parsePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;

  return Number.isFinite(number) ? number : null;
}

// Converts stock-related text into the required normalized availability value
function normalizeAvailability(value) {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;

  if (/pre[- ]?order/.test(text)) {
    return 'pre_order';
  }

  if (/out\s*of\s*stock|sold out|notify me/.test(text)) {
    return 'out_of_stock';
  }

  if (/in\s*stock|add to cart/.test(text)) {
    return 'in_stock';
  }

  return null;
}

// Returns the first non-empty text from the first visible matching selector
async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 8);

    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);

      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;

      const text = cleanText(
        await candidate.innerText().catch(() => null),
      );

      if (text) return text;
    }
  }

  return null;
}

// Extracts and normalizes the regular price and optional sale price
async function extractPricePair(page, locators) {
  const regularPrice = parsePrice(
    await firstVisibleText(page, locators.regularPriceSelectors()),
  );

  const currentPrice = parsePrice(
    await firstVisibleText(page, locators.currentPriceSelectors()),
  );

  return regularPrice !== null && currentPrice !== null
    ? {
        price: regularPrice,
        sale_price: currentPrice,
      }
    : {
        price: currentPrice ?? regularPrice,
        sale_price: null,
      };
}

// Extracts stock information and normalizes it to the required availability value
async function extractAvailability(page, locators) {
  const texts = await Promise.all([
    firstVisibleText(page, locators.priceWrapperSelectors()),
    firstVisibleText(page, locators.productQuantitySelectors()),
  ]);

  return normalizeAvailability(
    texts.filter(Boolean).join(' '),
  );
}

// Extracts breadcrumb categories, falling back to analytics data when needed
async function extractCategoryTree(page, locators, title) {
  const breadcrumbTree = await page.evaluate(
    ({ currentTitle, containers }) => {
      const clean = (value) =>
        String(value ?? '').replace(/\s+/g, ' ').trim();

      const current = clean(currentTitle).toLowerCase();

      for (const selector of containers) {
        const container = document.querySelector(selector);
        if (!container) continue;

        const listItems = [...container.querySelectorAll('li')];
        const elements =
          listItems.length >= 2
            ? listItems
            : [...container.querySelectorAll('a')];

        const seen = new Set();
        const result = [];

        for (const element of elements) {
          const name = clean(element.innerText);

          if (!name) continue;
          if (/^(home|store)$/i.test(name)) continue;
          if (current && name.toLowerCase() === current) continue;

          const anchor = element.matches('a')
            ? element
            : element.querySelector('a');

          const item = {
            name,
            url: anchor?.href || null,
          };

          const key = `${item.name}|${item.url ?? ''}`;

          if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
          }
        }

        if (result.length) return result;
      }

      return [];
    },
    {
      currentTitle: title,
      containers: locators.breadcrumbSelectors(),
    },
  );

  if (breadcrumbTree.length) {
    return breadcrumbTree;
  }

  const analyticsText = await locators
    .viewItemAnalyticsScript()
    .textContent()
    .catch(() => null);

  if (!analyticsText) return [];

  return ['item_category', 'item_category2', 'item_category3']
    .map((key) => {
      const match = analyticsText.match(
        new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`),
      );

      const name = cleanText(match?.[1]);

      return name
        ? {
            name,
            url: null,
          }
        : null;
    })
    .filter(Boolean);
}

// Extracts, resolves, filters, and deduplicates product image URLs
async function extractImages(page, locators) {
  const baseUrl = page.url();

  const rawImages = await page.evaluate(
    ({ mainSelector, carouselSelector }) => {
      const main = document.querySelector(mainSelector);

      const images = [
        main?.currentSrc || main?.src,
        ...[...document.querySelectorAll(carouselSelector)].map(
          (image) =>
            image.getAttribute('popup_img') ||
            image.currentSrc ||
            image.src,
        ),
      ];

      return images.filter(Boolean);
    },
    {
      mainSelector: locators.mainImageSelector(),
      carouselSelector: locators.carouselImageSelector(),
    },
  );

  const images = [
    ...new Set(
      rawImages
        .map((value) => {
          const text = cleanText(value);

          if (!text || text.startsWith('data:')) return null;

          try {
            return new URL(text, baseUrl).href;
          } catch {
            return null;
          }
        })
        .filter(
          (url) =>
            url &&
            !/(logo|icon|shipping|warranty|payment)/i.test(url),
        ),
    ),
  ];

  return {
    image_url: images[0] ?? null,
    additional_image_urls: images.slice(1),
  };
}

// Extracts technical specification name-value pairs from the page
async function extractSpecs(page, locators) {

  return page.evaluate((selectors) => {
    const clean = (value) =>
      String(value ?? '').replace(/\s+/g, ' ').trim();

    const result = [];
    const seen = new Set();

    const add = (name, value) => {
      const cleanName = clean(name);
      const cleanValue = clean(value) || null;

      if (!cleanName || cleanName.length > 120) return;
      if (/^(detail )?specification(s)?$/i.test(cleanName)) return;

      const key = `${cleanName}\u0000${cleanValue ?? ''}`;

      if (seen.has(key)) return;

      seen.add(key);
      result.push({
        name: cleanName,
        value: cleanValue,
      });
    };

    const parseRows = (rows) => {
      const pairs = [];

      for (const row of rows) {
        const cells = [
          ...row.querySelectorAll(selectors.tableCells),
        ];

        if (cells.length < 2) continue;

        const name = clean(cells[0].innerText);
        const value = clean(
          cells
            .slice(1)
            .map((cell) => cell.innerText)
            .join(' '),
        );

        if (name && value) {
          pairs.push({ name, value });
        }
      }

      return pairs;
    };

    const tables = [
      ...document.querySelectorAll(selectors.tables),
    ]
      .map((table) => {
        const pairs = parseRows(
          table.querySelectorAll(selectors.tableRows),
        );

        const surroundingText = clean(
          table.parentElement?.innerText,
        )
          .slice(0, 500)
          .toLowerCase();

        return {
          pairs,
          score:
            pairs.length +
            (/detail specification|specifications/.test(
              surroundingText,
            )
              ? 20
              : 0),
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const table of tables) {
      table.pairs.forEach(({ name, value }) =>
        add(name, value),
      );
    }

    return result;
  }, locators.specificationSelectors());
}

// Extracts the product ID from page controls or visible page text
async function extractItemId(locators) {
  const productId = cleanText(
    await locators
      .productIdInput()
      .inputValue()
      .catch(() => null),
  );

  if (productId) return productId;

  const bodyText = await locators.body().innerText();

  return cleanText(
    bodyText.match(
      /\b(?:SKU|Product ID|Item ID)\s*[:#]?\s*([A-Za-z0-9._-]+)/i,
    )?.[1],
  );
}

// Extracts the MSI brand name from the page content
async function extractBrand(locators) {
  const bodyText = await locators.body().innerText();

  return /\bMSI\b/i.test(bodyText)
    ? 'MSI'
    : null;
}

// Extracts the average star rating and review count when available
async function extractRating(page, locators) {
  const text = await firstVisibleText(
    page,
    locators.ratingSelectors(),
  );

  return {
    star_rating: parsePrice(
      text?.match(/\b([0-5](?:\.\d+)?)\b/)?.[1],
    ),
    review_count: parsePrice(
      text?.match(/\((\d+)\)/)?.[1],
    ),
  };
}

// Finds a specification value whose name matches the provided pattern
function findSpecValue(specs, pattern) {
  return specs.find((spec) => pattern.test(spec.name))?.value ?? null;
}

// Builds the final normalized product object from all extracted page data
async function extractProduct(page, locators) {
  const title = await firstVisibleText(page, [locators.productTitleSelector()]);
  const description = await firstVisibleText(page, locators.productDescriptionSelectors());
  const categoryTree = await extractCategoryTree(page, locators, title);
  const images = await extractImages(page, locators);
  const specs = await extractSpecs(page, locators);
  const prices = await extractPricePair(page, locators);
  const rating = await extractRating(page, locators);

  return {
    url: page.url(),
    item_id: await extractItemId(locators),
    title,
    brand: await extractBrand(locators),
    product_category: categoryTree.length
      ? categoryTree.map((item) => item.name).join(' > ')
      : null,
    category_tree: categoryTree,
    description,
    price: prices.price,
    sale_price: prices.sale_price,
    availability: await extractAvailability(page, locators),
    image_url: images.image_url,
    additional_image_urls: images.additional_image_urls,
    specs,
    star_rating: rating.star_rating,
    review_count: rating.review_count,
    gtin: findSpecValue(specs, /^(gtin|upc|ean)$/i),
    mpn: findSpecValue(specs, /^(mpn|manufacturer (part|number))/i),
    scraped_at: new Date().toISOString(),
  };
}

// Warns when expected product fields are missing or incomplete
function validateResult(product) {
  const checks = {
    url: !product.url,
    title: !product.title,
    brand: !product.brand,
    'price/sale_price':
      product.price === null &&
      product.sale_price === null,
    availability: !product.availability,
    image_url: !product.image_url,
    'several specs':
      !Array.isArray(product.specs) ||
      product.specs.length < 3,
  };

  const problems = Object.entries(checks)
    .filter(([, missing]) => missing)
    .map(([name]) => name);

  if (problems.length) {
    console.warn(
      'Warning: could not extract expected fields:',
      problems.join(', '),
    );
  }
}

// Runs the complete scraping flow and writes the result to output/product.json
async function main() {
  const targetUrl = process.argv[2] || process.env.PRODUCT_URL || TARGET_URL;
  if (!targetUrl) {
    throw new Error('Product URL is required. Usage: node scraper.js <url>');
  }

  const isHeadless = JSON.parse(process.argv[3] || process.env.HEADLESS || true);
  const browser = await chromium.launch({
    headless: isHeadless,
    channel: 'chromium',
  });

  const contextOptions = {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    viewport: {
      width: 1440,
      height: 1000,
    },
    screen: {
      width: 1440,
      height: 1000,
    },
    colorScheme: 'light',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  };

  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const locators = new MsiProductPageLocators(page);

    page.setDefaultTimeout(15000);

    console.log('Scraping:', targetUrl);

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const status = response?.status();
    const title = await page.title();
    const bodyText = await locators.body().innerText();

    if (
      (status && status >= 400) ||
      /access denied|forbidden|request blocked/i.test(title) ||
      /access denied|forbidden|request blocked/i.test(bodyText)
    ) {
      throw new Error(
        `Product page access denied. HTTP status: ${status ?? 'unknown'}, title: "${title}"`,
      );
    }

    await acceptCookiesIfPresent(locators);

    // Wait for product content instead of using an arbitrary sleep
    await locators.productTitle().waitFor({ state: 'visible' });
    await page
      .waitForFunction(
        (priceWrapperSelector) => {
          const priceBlock = document.querySelector(priceWrapperSelector);
          return (
            priceBlock &&
            /\$\s*\d|in stock|out of stock|pre[- ]?order/i.test(priceBlock.innerText)
          );
        },
        locators.priceWrapperSelector(),
        { timeout: 15000 },
      )
      .catch((error) => {
        console.warn('Price block wait timed out:', error);
      });

    const product = await extractProduct(page, locators);
    validateResult(product);

    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(product, null, 2)}\n`, 'utf8');

    console.log('Saved:', OUTPUT_FILE);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Scrape failed:', error);
  process.exitCode = 1;
});
