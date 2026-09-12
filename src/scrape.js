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

function normalizeUrl(value, baseUrl) {
  const text = cleanText(value);
  if (!text || text.startsWith('data:')) return null;

  try {
    return new URL(text, baseUrl).href;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function findProductNode(node) {
  if (!node) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((entry) => String(entry).toLowerCase() === 'product')) {
    return node;
  }

  if (node['@graph']) {
    const found = findProductNode(node['@graph']);
    if (found) return found;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findProductNode(value);
      if (found) return found;
    }
  }

  return null;
}

async function extractJsonLdProduct(page) {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const product = findProductNode(parsed);
      if (product) return product;
    } catch {
      // Invalid JSON-LD should not fail the whole scrape; DOM fallbacks are used below.
    }
  }

  return null;
}

function readBrandFromJsonLd(product) {
  const brand = product?.brand;
  if (typeof brand === 'string') return cleanText(brand);
  if (brand && typeof brand === 'object') return cleanText(brand.name);
  return null;
}

function readOffer(product) {
  const offers = product?.offers;
  if (Array.isArray(offers)) return offers.find((offer) => offer && typeof offer === 'object') ?? null;
  if (offers && typeof offers === 'object') return offers;
  return null;
}

function readJsonLdImages(product, baseUrl) {
  const value = product?.image;
  const images = Array.isArray(value) ? value : value ? [value] : [];

  return unique(
    images.map((image) => {
      if (typeof image === 'string') return normalizeUrl(image, baseUrl);
      if (image && typeof image === 'object') {
        return normalizeUrl(image.url ?? image.contentUrl, baseUrl);
      }
      return null;
    }),
  );
}

async function readMeta(page, selectors) {
  return page.evaluate((candidateSelectors) => {
    for (const selector of candidateSelectors) {
      const element = document.querySelector(selector);
      const value = element?.getAttribute('content');
      if (value?.trim()) return value.trim();
    }
    return null;
  }, selectors);
}

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const candidate = locator.nth(i);
      try {
        if (!(await candidate.isVisible())) continue;
        const text = cleanText(await candidate.textContent());
        if (text) return text;
      } catch {
        // Continue to the next candidate if the DOM changed while inspecting it.
      }
    }
  }

  return null;
}

async function extractTitle(page, productJsonLd) {
  const fromJsonLd = cleanText(productJsonLd?.name);
  if (fromJsonLd) return fromJsonLd;

  const fromDom = await firstVisibleText(page, [
    'main [itemprop="name"]',
    'main .product-title',
    'main [class*="product-name"]',
    'main h1',
    'main h2',
    '.product-info h1',
    '.product-info h2',
    'h1',
    'h2',
  ]);
  if (fromDom) return fromDom;

  const ogTitle = await readMeta(page, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  return cleanText(ogTitle);
}

async function extractDescription(page, productJsonLd) {
  const fromJsonLd = cleanText(productJsonLd?.description);
  if (fromJsonLd) return fromJsonLd;

  const metaDescription = await readMeta(page, [
    'meta[name="description"]',
    'meta[property="og:description"]',
  ]);
  return cleanText(metaDescription);
}

async function extractHeroText(page, title) {
  if (!title) return '';

  return page.evaluate((expectedTitle) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const normalizedTitle = clean(expectedTitle).toLowerCase();
    const headings = [...document.querySelectorAll('h1, h2, h3')];

    const heading = headings.find((element) => {
      const text = clean(element.textContent).toLowerCase();
      return text === normalizedTitle || text.includes(normalizedTitle) || normalizedTitle.includes(text);
    });

    if (!heading) return '';

    let node = heading;
    let fallback = clean(heading.parentElement?.innerText);

    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText);
      if (text.length < 12000) fallback = text;

      const containsPrice = /\$\s*\d/.test(text);
      const containsCommerceState = /(in stock|out of stock|pre[- ]?order|notify me|add to cart)/i.test(text);
      if (containsPrice && containsCommerceState && text.length < 10000) return text;
    }

    return fallback || '';
  }, title);
}

function extractPricePair(heroText, offer) {
  const text = cleanText(heroText) ?? '';

  const saleMatch = text.match(
    /(?:was|regular(?:\s+price)?|list(?:\s+price)?)\s*\$\s*([\d,.]+)[\s\S]{0,80}?\$\s*([\d,.]+)/i,
  );
  if (saleMatch) {
    return {
      price: parsePrice(saleMatch[1]),
      sale_price: parsePrice(saleMatch[2]),
    };
  }

  const offerPrice = parsePrice(offer?.price ?? offer?.lowPrice);
  if (offerPrice !== null) {
    return { price: offerPrice, sale_price: null };
  }

  const priceMatches = [...text.matchAll(/\$\s*([\d,.]+)/g)]
    .map((match) => parsePrice(match[1]))
    .filter((value) => value !== null);

  return {
    price: priceMatches[0] ?? null,
    sale_price: null,
  };
}

async function extractCategoryTree(page, title) {
  const breadcrumbs = await page.evaluate((currentTitle) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const current = clean(currentTitle).toLowerCase();
    const containers = [
      'nav[aria-label*="breadcrumb" i]',
      'ol.breadcrumb',
      'ul.breadcrumb',
      '.breadcrumb',
      '[class*="breadcrumb"]',
    ];

    for (const selector of containers) {
      const container = document.querySelector(selector);
      if (!container) continue;

      const listItems = [...container.querySelectorAll('li')];
      const source = listItems.length >= 2 ? listItems : [...container.querySelectorAll('a')];
      const result = [];

      for (const element of source) {
        const name = clean(element.textContent);
        if (!name) continue;
        if (/^(home|store)$/i.test(name)) continue;
        if (current && name.toLowerCase() === current) continue;

        const anchor = element.matches('a') ? element : element.querySelector('a');
        result.push({
          name,
          url: anchor?.href || null,
        });
      }

      const deduped = result.filter(
        (item, index, array) =>
          index === array.findIndex((other) => other.name === item.name && other.url === item.url),
      );

      if (deduped.length) return deduped;
    }

    return [];
  }, title);

  if (breadcrumbs.length) return breadcrumbs;

  // Safe fallback: build a readable category path from the target URL itself.
  const url = new URL(page.url());
  const segments = url.pathname.split('/').filter(Boolean).slice(0, -1);

  return segments.map((segment, index) => {
    const name = decodeURIComponent(segment).replace(/-/g, ' ');
    const partialPath = `/${segments.slice(0, index + 1).join('/')}`;
    return {
      name,
      url: new URL(partialPath, url.origin).href,
    };
  });
}

async function extractDomImages(page) {
  return page.evaluate(() => {
    const urls = [];
    const roots = [
      '.product-image',
      '.product-images',
      '.image-additional',
      '.thumbnails',
      '[class*="gallery"]',
      '[class*="product"] [class*="image"]',
    ];

    for (const selector of roots) {
      for (const root of document.querySelectorAll(selector)) {
        for (const anchor of root.querySelectorAll('a[href]')) urls.push(anchor.href);
        for (const image of root.querySelectorAll('img')) {
          urls.push(image.currentSrc || image.src);
          urls.push(image.getAttribute('data-src'));
          urls.push(image.getAttribute('data-zoom-image'));
        }
      }
    }

    return urls.filter(Boolean);
  });
}

async function extractImages(page, productJsonLd) {
  const baseUrl = page.url();
  const jsonLdImages = readJsonLdImages(productJsonLd, baseUrl);
  const ogImage = normalizeUrl(
    await readMeta(page, ['meta[property="og:image"]', 'meta[name="twitter:image"]']),
    baseUrl,
  );
  const domImages = (await extractDomImages(page))
    .map((url) => normalizeUrl(url, baseUrl))
    .filter((url) => url && !/(logo|icon|shipping|warranty|payment)/i.test(url));

  const allImages = unique([...jsonLdImages, ogImage, ...domImages]);

  return {
    image_url: allImages[0] ?? null,
    additional_image_urls: allImages.slice(1),
  };
}

async function revealSpecifications(page) {
  const button = page.getByRole('button', { name: /detail specification|specification/i }).first();

  try {
    if ((await button.count()) && (await button.isVisible())) {
      await button.click();
      return;
    }
  } catch {
    // Specs may already be visible.
  }

  const link = page.getByRole('link', { name: /detail specification|specification/i }).first();
  try {
    if (!(await link.count()) || !(await link.isVisible())) return;

    const href = await link.getAttribute('href');
    // Click only tab-like links. Do not navigate away to a separate specifications page.
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      await link.click();
    }
  } catch {
    // Specs may already be visible or the control may have changed.
  }
}

async function extractSpecs(page, productJsonLd) {
  if (Array.isArray(productJsonLd?.additionalProperty)) {
    const jsonLdSpecs = productJsonLd.additionalProperty
      .map((property) => ({
        name: cleanText(property?.name),
        value: cleanText(property?.value),
      }))
      .filter((item) => item.name);

    if (jsonLdSpecs.length >= 3) return jsonLdSpecs;
  }

  await revealSpecifications(page);

  return page.evaluate(() => {
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

    const tables = [...document.querySelectorAll('table')];
    const parsedTables = tables.map((table) => {
      const pairs = [];
      for (const row of table.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll(':scope > th, :scope > td')];
        if (cells.length < 2) continue;
        const name = clean(cells[0].innerText);
        const value = clean(cells.slice(1).map((cell) => cell.innerText).join(' '));
        if (name && value) pairs.push({ name, value });
      }

      const surroundingText = clean(table.parentElement?.innerText).slice(0, 500).toLowerCase();
      const specBonus = /detail specification|specifications/.test(surroundingText) ? 20 : 0;
      return { pairs, score: pairs.length + specBonus };
    });

    parsedTables.sort((a, b) => b.score - a.score);
    if (parsedTables[0]?.pairs.length >= 3) {
      for (const pair of parsedTables[0].pairs) add(pair.name, pair.value);
      return result;
    }

    for (const dl of document.querySelectorAll('dl')) {
      const terms = [...dl.querySelectorAll(':scope > dt')];
      for (const term of terms) {
        const description = term.nextElementSibling;
        if (description?.tagName === 'DD') add(term.innerText, description.innerText);
      }
    }
    if (result.length >= 3) return result;

    const sections = [...document.querySelectorAll('[class*="spec" i], [id*="spec" i]')];
    for (const section of sections) {
      const rows = section.querySelectorAll('tr, [class*="row" i]');
      for (const row of rows) {
        const children = [...row.children].filter((child) => clean(child.innerText));
        if (children.length < 2 || children.length > 5) continue;

        const name = clean(children[0].innerText);
        const value = clean(children.slice(1).map((child) => child.innerText).join(' '));
        if (name && value) add(name, value);
      }
    }

    return result;
  });
}

async function extractItemId(page, productJsonLd) {
  const fromJsonLd = cleanText(productJsonLd?.productID ?? productJsonLd?.sku);
  if (fromJsonLd) return fromJsonLd;

  return page.evaluate(() => {
    const candidates = [
      document.querySelector('input[name="product_id"]')?.value,
      document.querySelector('[data-product-id]')?.getAttribute('data-product-id'),
      document.querySelector('[data-product_id]')?.getAttribute('data-product_id'),
    ];

    return candidates.find((value) => value?.trim())?.trim() ?? null;
  });
}

async function extractBrand(page, productJsonLd) {
  const fromJsonLd = readBrandFromJsonLd(productJsonLd);
  if (fromJsonLd) return fromJsonLd;

  const fromMeta = cleanText(
    await readMeta(page, ['meta[property="product:brand"]', 'meta[name="brand"]']),
  );
  if (fromMeta) return fromMeta;

  const documentTitle = cleanText(await page.title());
  return /\bMSI\b/i.test(documentTitle ?? '') ? 'MSI' : null;
}

function readRating(productJsonLd) {
  const aggregate = productJsonLd?.aggregateRating;
  return {
    star_rating: parsePrice(aggregate?.ratingValue),
    review_count: parsePrice(aggregate?.reviewCount ?? aggregate?.ratingCount),
  };
}

function findSpecValue(specs, pattern) {
  return specs.find((spec) => pattern.test(spec.name))?.value ?? null;
}

async function extractProduct(page) {
  const productJsonLd = await extractJsonLdProduct(page);
  const title = await extractTitle(page, productJsonLd);
  const heroText = await extractHeroText(page, title);
  const offer = readOffer(productJsonLd);
  const categoryTree = await extractCategoryTree(page, title);
  const images = await extractImages(page, productJsonLd);
  const specs = await extractSpecs(page, productJsonLd);
  const prices = extractPricePair(heroText, offer);
  const rating = readRating(productJsonLd);

  const jsonLdAvailability = normalizeAvailability(offer?.availability);
  const domAvailability = normalizeAvailability(heroText);

  const jsonLdGtin = cleanText(
    productJsonLd?.gtin ??
      productJsonLd?.gtin14 ??
      productJsonLd?.gtin13 ??
      productJsonLd?.gtin12 ??
      productJsonLd?.gtin8,
  );

  const jsonLdMpn = cleanText(productJsonLd?.mpn);

  return {
    url: page.url(),
    item_id: await extractItemId(page, productJsonLd),
    title,
    brand: await extractBrand(page, productJsonLd),
    product_category: categoryTree.length ? categoryTree.map((item) => item.name).join(' > ') : null,
    category_tree: categoryTree,
    description: await extractDescription(page, productJsonLd),
    price: prices.price,
    sale_price: prices.sale_price,
    availability: jsonLdAvailability ?? domAvailability,
    image_url: images.image_url,
    additional_image_urls: images.additional_image_urls,
    specs,
    star_rating: rating.star_rating,
    review_count: rating.review_count,
    gtin: jsonLdGtin ?? findSpecValue(specs, /^(gtin|upc|ean)$/i),
    mpn: jsonLdMpn ?? findSpecValue(specs, /^(mpn|manufacturer (part|number))/i),
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
    console.warn(`Warning: could not extract expected fields: ${problems.join(', ')}`);
  }
}

async function main() {
  const targetUrl = process.argv[2] || TARGET_URL;
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
