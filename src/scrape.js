/**
 * MSI Product Page Scraper
 *
 * Flow:
 * main() opens the product page, waits for content, calls extractProduct(),
 * validates the result, and saves output/product.json.
 *
 * Main helpers:
 * - extractProduct()       -> builds the final product object.
 * - extractPricePair()     -> extracts regular and sale prices.
 * - extractAvailability()  -> normalizes stock status.
 * - extractCategoryTree()  -> extracts breadcrumb categories with analytics fallback.
 * - extractImages()        -> extracts main and additional images.
 * - extractSpecs()         -> extracts technical specifications.
 * - extractItemId()        -> extracts the product ID.
 * - extractBrand()         -> extracts the brand from page content.
 * - extractRating()        -> extracts rating and review count.
 * - validateResult()       -> warns about missing required values.
 *
 * MsiProductPageLocators keeps all page selectors in one place.
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
 *   │  │  └─ revealSpecifications()
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
    return this.page.getByRole('button', { name: /^accept$/i }).first();
  }

  body() {
    return this.page.locator('body');
  }

  productTitle() {
    return this.page.locator('.product-detail h2.title').first();
  }

  productTitleSelector() {
    return '.product-detail > .row > .col-md-6 h2.title';
  }

  productDescriptionSelectors() {
    return ['.product-detail > .row > .col-md-6 h2.title + div p'];
  }

  regularPriceSelectors() {
    return ['#prices-wrapper #prices-old'];
  }

  currentPriceSelectors() {
    return ['#prices-wrapper #prices-new'];
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
      'nav[aria-label*="breadcrumb" i]',
      'ol.breadcrumb',
      'ul.breadcrumb',
      '.breadcrumb',
      '[class*="breadcrumb"]',
    ];
  }

  mainImageSelector() {
    return '.product-detail #imagePopup';
  }

  carouselImageSelector() {
    return '.product-detail #carouselImages img.product-detail-thumb-bto';
  }

  specificationButton() {
    return this.page
      .getByRole('button', { name: /detail specification|specification/i })
      .first();
  }

  specificationLink() {
    return this.page
      .getByRole('link', { name: /detail specification|specification/i })
      .first();
  }

  specificationSelectors() {
    return {
      tables: '.product-detail table.table.table-borderless',
      tableRows: 'tr',
      tableCells: ':scope > th, :scope > td',
      definitionLists: 'dl',
      definitionTerms: ':scope > dt',
      sections: '[class*="spec" i], [id*="spec" i]',
      sectionRows: 'tr, [class*="row" i]',
    };
  }

  ratingSelectors() {
    return ['#description-list-average-rating #average-rating-info'];
  }

  productIdInput() {
    return this.page
      .locator('#product_qty input[name="product_id"]')
      .first();
  }

  viewItemAnalyticsScript() {
    return this.page
      .locator('script')
      .filter({ hasText: /gtag\("event",\s*"view_item"/ })
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

function cleanText(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function normalizeAvailability(value) {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;

  if (text.includes('preorder') || text.includes('pre-order') || text.includes('pre order')) {
    return 'pre_order';
  }

  if (
    text.includes('outofstock') ||
    text.includes('out of stock') ||
    text.includes('sold out') ||
    text.includes('notify me')
  ) {
    return 'out_of_stock';
  }

  if (text.includes('instock') || text.includes('in stock') || text.includes('add to cart')) {
    return 'in_stock';
  }

  return null;
}

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const candidate = locator.nth(i);

      try {
        if (!(await candidate.isVisible())) continue;

        const text = cleanText(await candidate.innerText());
        if (text) return text;
      } catch (error) {
        // Continue to the next candidate if the DOM changed while inspecting it.
        console.error('Failed to check candidate visibility:', error);
      }
    }
  }

  return null;
}

async function extractPricePair(page, locators) {
  const regularPriceText = await firstVisibleText(page, locators.regularPriceSelectors());
  const currentPriceText = await firstVisibleText(page, locators.currentPriceSelectors());

  const regularPrice = parsePrice(regularPriceText);
  const currentPrice = parsePrice(currentPriceText);

  if (regularPrice !== null && currentPrice !== null) {
    return {
      price: regularPrice,
      sale_price: currentPrice,
    };
  }

  return {
    price: currentPrice ?? regularPrice,
    sale_price: null,
  };
}

async function extractAvailability(page, locators) {
  const priceBlockText = await firstVisibleText(page, locators.priceWrapperSelectors());
  const purchaseControlsText = await firstVisibleText(page, locators.productQuantitySelectors());

  return normalizeAvailability(
    [priceBlockText, purchaseControlsText].filter(Boolean).join(' '),
  );
}

async function extractCategoryTree(page, locators, title) {
  const breadcrumbTree = await page.evaluate(
    ({ currentTitle, containers }) => {
      const clean = (value) =>
        String(value ?? '')
          .replace(/\s+/g, ' ')
          .trim();

      const current = clean(currentTitle).toLowerCase();

      for (const selector of containers) {
        const container = document.querySelector(selector);
        if (!container) continue;

        const listItems = [...container.querySelectorAll('li')];
        const source =
          listItems.length >= 2
            ? listItems
            : [...container.querySelectorAll('a')];

        const result = [];

        for (const element of source) {
          const name = clean(element.innerText);

          if (!name) continue;
          if (/^(home|store)$/i.test(name)) continue;
          if (current && name.toLowerCase() === current) continue;

          const anchor = element.matches('a')
            ? element
            : element.querySelector('a');

          result.push({
            name,
            url: anchor?.href || null,
          });
        }

        const deduped = result.filter(
          (item, index, array) =>
            index ===
            array.findIndex(
              (other) =>
                other.name === item.name &&
                other.url === item.url,
            ),
        );

        if (deduped.length) {
          return deduped;
        }
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

  if (!analyticsText) {
    return [];
  }

  const categoryKeys = [
    'item_category',
    'item_category2',
    'item_category3',
  ];

  return categoryKeys
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

async function extractImages(page, locators) {
  const baseUrl = page.url();
  const imageUrls = await page.evaluate(({ mainImageSelector, carouselImageSelector }) => {
    const urls = [];
    const mainImage = document.querySelector(mainImageSelector);

    if (mainImage) {
      urls.push(mainImage.currentSrc || mainImage.src);
    }

    for (const image of document.querySelectorAll(carouselImageSelector)) {
      urls.push(image.getAttribute('popup_img') || image.currentSrc || image.src);
    }

    return urls.filter(Boolean);
  }, {
    mainImageSelector: locators.mainImageSelector(),
    carouselImageSelector: locators.carouselImageSelector(),
  });

  const images = [
    ...new Set(
      imageUrls
        .map((value) => {
          const text = cleanText(value);
          if (!text || text.startsWith('data:')) return null;

          try {
            return new URL(text, baseUrl).href;
          } catch {
            return null;
          }
        })
        .filter((url) => url && !/(logo|icon|shipping|warranty|payment)/i.test(url)),
    ),
  ];

  return {
    image_url: images[0] ?? null,
    additional_image_urls: images.slice(1),
  };
}

async function revealSpecifications(locators) {
  const button = locators.specificationButton();

  try {
    if ((await button.count()) && (await button.isVisible())) {
      await button.click();
      return;
    }
  } catch (error) {
    // Specs may already be visible.
    console.error('Failed to reveal specifications using the specification button:', error);
  }

  const link = locators.specificationLink();

  try {
    if (!(await link.count()) || !(await link.isVisible())) return;

    const href = await link.getAttribute('href');

    // Click only tab-like links. Do not navigate away to a separate specifications page.
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      await link.click();
    }
  } catch (error) {
    // Specs may already be visible or the control may have changed.
    console.error('Failed to reveal specifications using the specification link:', error);
  }
}

async function extractSpecs(page, locators) {
  await revealSpecifications(locators);

  return page.evaluate((selectors) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
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
      result.push({ name: cleanName, value: cleanValue });
    };

    const tables = [...document.querySelectorAll(selectors.tables)];
    const parsedTables = tables.map((table) => {
      const pairs = [];

      for (const row of table.querySelectorAll(selectors.tableRows)) {
        const cells = [...row.querySelectorAll(selectors.tableCells)];
        if (cells.length < 2) continue;

        const name = clean(cells[0].innerText);
        const value = clean(cells.slice(1).map((cell) => cell.innerText).join(' '));
        if (name && value) pairs.push({ name, value });
      }

      const surroundingText = clean(table.parentElement?.innerText).slice(0, 500).toLowerCase();
      const specBonus = /detail specification|specifications/.test(surroundingText) ? 20 : 0;

      return {
        pairs,
        score: pairs.length + specBonus,
      };
    });

    parsedTables.sort((a, b) => b.score - a.score);

    for (const table of parsedTables) {
      for (const pair of table.pairs) {
        add(pair.name, pair.value);
      }
    }

    if (result.length >= 3) return result;

    for (const dl of document.querySelectorAll(selectors.definitionLists)) {
      const terms = [...dl.querySelectorAll(selectors.definitionTerms)];

      for (const term of terms) {
        const description = term.nextElementSibling;
        if (description?.tagName === 'DD') {
          add(term.innerText, description.innerText);
        }
      }
    }

    if (result.length >= 3) return result;

    const sections = [...document.querySelectorAll(selectors.sections)];

    for (const section of sections) {
      const rows = section.querySelectorAll(selectors.sectionRows);

      for (const row of rows) {
        const children = [...row.children].filter((child) => clean(child.innerText));
        if (children.length < 2 || children.length > 5) continue;

        const name = clean(children[0].innerText);
        const value = clean(children.slice(1).map((child) => child.innerText).join(' '));
        if (name && value) add(name, value);
      }
    }

    return result;
  }, locators.specificationSelectors());
}

async function extractItemId(locators) {
  const productId = cleanText(
    await locators
      .productIdInput()
      .inputValue()
      .catch(() => null),
  );

  if (productId) {
    return productId;
  }

  const bodyText = await locators.body().innerText();
  const match = bodyText.match(
    /\b(?:SKU|Product ID|Item ID)\s*[:#]?\s*([A-Za-z0-9._-]+)/i,
  );

  return cleanText(match?.[1]);
}

async function extractBrand(page, locators) {
  const bodyText = await locators.body().innerText();
  const match = bodyText.match(/\bMSI\b/i);

  return cleanText(match?.[0]);
}

async function extractRating(page, locators) {
  const ratingText = await firstVisibleText(page, locators.ratingSelectors());

  if (!ratingText) {
    return {
      star_rating: null,
      review_count: null,
    };
  }

  const ratingMatch = ratingText.match(/\b([0-5](?:\.\d+)?)\b/);
  const reviewMatch = ratingText.match(/\((\d+)\)/);

  return {
    star_rating: parsePrice(ratingMatch?.[1]),
    review_count: parsePrice(reviewMatch?.[1]),
  };
}

function findSpecValue(specs, pattern) {
  return specs.find((spec) => pattern.test(spec.name))?.value ?? null;
}

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
    brand: await extractBrand(page, locators),
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

function validateResult(product) {
  const problems = [];

  if (!product.url) problems.push('url');
  if (!product.title) problems.push('title');
  if (!product.brand) problems.push('brand');
  if (product.price === null && product.sale_price === null) problems.push('price/sale_price');
  if (!product.availability) problems.push('availability');
  if (!product.image_url) problems.push('image_url');
  if (!Array.isArray(product.specs) || product.specs.length < 3) problems.push('several specs');

  if (problems.length) {
    console.warn('Warning: could not extract expected fields:', problems.join(', '));
  }
}

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

    // Wait for product content instead of using an arbitrary sleep.
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
