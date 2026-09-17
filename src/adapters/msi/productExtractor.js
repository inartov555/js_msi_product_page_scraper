import { msiSelectors } from './selectors.js';
import { cleanText, parseNumber } from '../../shared/text.js';
import { findSpecValue, normalizeAvailability } from '../../domain/product.js';
import { acceptCookiesIfPresent, gotoWithRetry } from '../../infrastructure/browser.js';

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    if (selector.startsWith('meta[')) {
      const content = cleanText(await page.locator(selector).first().getAttribute('content').catch(() => null));
      if (content) return content;
      continue;
    }
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 8);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const text = cleanText(await candidate.innerText().catch(() => null));
      if (text) return text;
    }
  }
  return null;
}

async function extractStructuredProduct(page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const nodes = [];
    for (const script of scripts) {
      try {
        const value = JSON.parse(script.textContent || 'null');
        const stack = Array.isArray(value) ? [...value] : [value];
        while (stack.length) {
          const item = stack.shift();
          if (!item || typeof item !== 'object') continue;
          nodes.push(item);
          if (Array.isArray(item['@graph'])) stack.push(...item['@graph']);
        }
      } catch {
        // Ignore invalid third-party JSON-LD blocks.
      }
    }
    const product = nodes.find((item) => {
      const type = item?.['@type'];
      return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    });
    if (!product) return null;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const rating = product.aggregateRating || null;
    const brand = typeof product.brand === 'string' ? product.brand : product.brand?.name;
    const image = Array.isArray(product.image) ? product.image : product.image ? [product.image] : [];
    return {
      name: product.name ?? null,
      description: product.description ?? null,
      sku: product.sku ?? product.productID ?? null,
      mpn: product.mpn ?? null,
      gtin: product.gtin13 ?? product.gtin12 ?? product.gtin14 ?? product.gtin ?? null,
      brand: brand ?? null,
      images: image,
      price: offer?.price ?? offer?.lowPrice ?? null,
      currency: offer?.priceCurrency ?? null,
      availability: offer?.availability ?? null,
      rating: rating?.ratingValue ?? null,
      reviewCount: rating?.reviewCount ?? rating?.ratingCount ?? null,
    };
  });
}

async function extractCategoryTree(page, title) {
  const breadcrumbTree = await page.evaluate(({ selectors, currentTitle }) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const current = clean(currentTitle).toLowerCase();
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (!container) continue;
      const nodes = [...container.querySelectorAll('li')];
      const elements = nodes.length >= 2 ? nodes : [...container.querySelectorAll('a')];
      const result = [];
      const seen = new Set();
      for (const element of elements) {
        const name = clean(element.innerText);
        if (!name || /^(home|store)$/i.test(name) || (current && name.toLowerCase() === current)) continue;
        const anchor = element.matches('a') ? element : element.querySelector('a');
        const item = { name, url: anchor?.href || null };
        const key = `${item.name}|${item.url ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      if (result.length) return result;
    }
    return [];
  }, { selectors: msiSelectors.breadcrumbs, currentTitle: title });

  if (breadcrumbTree.length) return breadcrumbTree;

  const analyticsText = await page.locator('script').filter({ hasText: /gtag\("event",\s*"view_item"/ }).first().textContent().catch(() => null);
  if (!analyticsText) return [];
  return ['item_category', 'item_category2', 'item_category3']
    .map((key) => cleanText(analyticsText.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1]))
    .filter(Boolean)
    .map((name) => ({ name, url: null }));
}

async function extractImages(page, structured) {
  const rawImages = await page.evaluate(({ mainSelector, carouselSelector }) => {
    const main = document.querySelector(mainSelector);
    return [
      main?.currentSrc || main?.src,
      ...[...document.querySelectorAll(carouselSelector)].map((image) =>
        image.getAttribute('popup_img') || image.currentSrc || image.src),
    ].filter(Boolean);
  }, { mainSelector: msiSelectors.mainImage, carouselSelector: msiSelectors.carouselImages });

  const baseUrl = page.url();
  const candidates = [...(structured?.images ?? []), ...rawImages];
  const images = [...new Set(candidates.map((value) => {
    const text = cleanText(value);
    if (!text || text.startsWith('data:')) return null;
    try { return new URL(text, baseUrl).href; } catch { return null; }
  }).filter((url) => url && !/(logo|icon|shipping|warranty|payment)/i.test(url)))];

  return { image_url: images[0] ?? null, additional_image_urls: images.slice(1) };
}

async function extractSpecs(page) {
  return page.evaluate((tableSelector) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const result = [];
    const seen = new Set();
    const tables = [...document.querySelectorAll(tableSelector)];
    for (const table of tables) {
      for (const row of table.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll(':scope > th, :scope > td')];
        if (cells.length < 2) continue;
        const name = clean(cells[0].innerText);
        const value = clean(cells.slice(1).map((cell) => cell.innerText).join(' '));
        if (!name || !value || name.length > 120 || /^(detail )?specification(s)?$/i.test(name)) continue;
        const key = `${name}\u0000${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ name, value });
      }
    }
    return result;
  }, msiSelectors.specTables);
}

async function extractPricePair(page, structured) {
  const regularPrice = parseNumber(await firstVisibleText(page, msiSelectors.regularPrice));
  const currentPrice = parseNumber(await firstVisibleText(page, msiSelectors.currentPrice));
  const structuredPrice = parseNumber(structured?.price);
  if (regularPrice !== null && currentPrice !== null && regularPrice !== currentPrice) {
    return { price: regularPrice, sale_price: currentPrice };
  }
  return { price: currentPrice ?? regularPrice ?? structuredPrice, sale_price: null };
}

async function extractAvailability(page, structured) {
  const textParts = await Promise.all([
    firstVisibleText(page, msiSelectors.priceWrapper),
    firstVisibleText(page, msiSelectors.productQuantity),
  ]);
  const visibleAvailability = normalizeAvailability(textParts.filter(Boolean).join(' '));
  return visibleAvailability ?? normalizeAvailability(structured?.availability);
}

async function extractItemId(page, structured) {
  const inputValue = cleanText(await page.locator(msiSelectors.productIdInput).first().inputValue().catch(() => null));
  if (inputValue) return inputValue;
  if (cleanText(structured?.sku)) return cleanText(structured.sku);
  const body = await page.locator('body').innerText().catch(() => '');
  return cleanText(body.match(/\b(?:SKU|Product ID|Item ID)\s*[:#]?\s*([A-Za-z0-9._-]+)/i)?.[1]);
}

async function extractRating(page, structured) {
  const text = await firstVisibleText(page, msiSelectors.rating);
  return {
    star_rating: parseNumber(structured?.rating) ?? parseNumber(text?.match(/\b([0-5](?:\.\d+)?)\b/)?.[1]),
    review_count: parseNumber(structured?.reviewCount) ?? parseNumber(text?.match(/\((\d+)\)/)?.[1]),
  };
}

export async function extractMsiProduct(page, url) {
  await gotoWithRetry(page, url);
  await acceptCookiesIfPresent(page);
  await page.locator(msiSelectors.productTitle.join(', ')).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const structured = await extractStructuredProduct(page);
  const title = cleanText(structured?.name) ?? await firstVisibleText(page, msiSelectors.productTitle);
  const description = cleanText(structured?.description) ?? await firstVisibleText(page, msiSelectors.description);
  const [categoryTree, specs, images, prices, rating] = await Promise.all([
    extractCategoryTree(page, title),
    extractSpecs(page),
    extractImages(page, structured),
    extractPricePair(page, structured),
    extractRating(page, structured),
  ]);

  const mpn = cleanText(structured?.mpn) ?? findSpecValue(specs, /^(mpn|manufacturer (part|number)|manufacturer number|model number)$/i);
  const gtin = cleanText(structured?.gtin) ?? findSpecValue(specs, /^(gtin|upc|ean)$/i);

  return {
    url: page.url(),
    item_id: await extractItemId(page, structured),
    title,
    brand: cleanText(structured?.brand) ?? 'MSI',
    product_category: categoryTree.length ? categoryTree.map((item) => item.name).join(' > ') : null,
    category_tree: categoryTree,
    description,
    price: prices.price,
    sale_price: prices.sale_price,
    currency: cleanText(structured?.currency) ?? 'USD',
    availability: await extractAvailability(page, structured),
    image_url: images.image_url,
    additional_image_urls: images.additional_image_urls,
    specs,
    star_rating: rating.star_rating,
    review_count: rating.review_count,
    gtin,
    mpn,
    scraped_at: new Date().toISOString(),
  };
}
