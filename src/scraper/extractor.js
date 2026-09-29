import { msiLocators } from './locators.js';
import { cleanText, parseNumber } from '../shared/text.js';
import { findSpecValue, normalizeAvailability } from '../product.js';
import { acceptCookiesIfPresent, gotoWithRetry } from './browser.js';

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
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

async function waitForAnyVisible(page, selector, timeout = 8000) {
  // Locator waiting is handled natively by Playwright and avoids repeatedly
  // executing a polling function in the page just to detect the title.
  await page.locator(selector).first().waitFor({
    state: 'visible',
    timeout,
  });
}

async function extractCategoryTree(page, title) {
  const breadcrumbTree = await page.evaluate(({ locators, currentTitle }) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const current = clean(currentTitle).toLowerCase();
    for (const selector of locators.containers) {
      const container = document.querySelector(selector);
      if (!container) continue;
      const nodes = [...container.querySelectorAll(locators.items)];
      const elements = nodes.length >= 2 ? nodes : [...container.querySelectorAll(locators.links)];
      const result = [];
      const seen = new Set();
      for (const element of elements) {
        const name = clean(element.innerText);
        if (!name || /^(home|store)$/i.test(name) || (current && name.toLowerCase() === current)) continue;
        const anchor = element.matches(locators.links) ? element : element.querySelector(locators.links);
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
  }, { locators: msiLocators.breadcrumbs, currentTitle: title });

  if (breadcrumbTree.length) return breadcrumbTree;

  return page.evaluate(({ scriptsSelector, marker }) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const script = [...document.querySelectorAll(scriptsSelector)]
      .find((node) => node.textContent?.includes(marker));
    if (!script?.textContent) return [];

    return ['item_category', 'item_category2', 'item_category3']
      .map((key) => {
        const match = script.textContent.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        return clean(match?.[1]);
      })
      .filter(Boolean)
      .map((name) => ({ name, url: null }));
  }, {
    scriptsSelector: msiLocators.analytics.scripts,
    marker: msiLocators.analytics.viewItemText,
  });
}

async function extractImages(page) {
  const baseUrl = page.url();

  const rawImages = await page.evaluate(
    ({ mainSelector, carouselSelector }) => {
      const main = document.querySelector(mainSelector);

      return [
        main?.currentSrc || main?.src,
        ...[
          ...document.querySelectorAll(carouselSelector),
        ].map((image) =>
          image.getAttribute('popup_img') ||
          image.currentSrc ||
          image.src
        ),
      ].filter(Boolean);
    },
    {
      mainSelector: msiLocators.mainImage,
      carouselSelector: msiLocators.carouselImages,
    }
  );

  const images = [
    ...new Set(
      rawImages
        .map((value) => {
          const text = cleanText(value);

          if (!text || text.startsWith('data:')) {
            return null;
          }

          try {
            return new URL(text, baseUrl).href;
          } catch {
            return null;
          }
        })
        .filter(
          (url) =>
            url &&
            !/(logo|icon|shipping|warranty|payment)/i.test(url)
        )
    ),
  ];

  return {
    image_url: images[0] ?? null,
    additional_image_urls: images.slice(1),
  };
}

async function extractSpecs(page) {
  return page.evaluate((selectors) => {
    const clean = (value) =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();

    const result = [];
    const seen = new Set();

    const add = (name, value) => {
      const cleanName = clean(name);
      const cleanValue = clean(value) || null;

      if (!cleanName || cleanName.length > 120) {
        return;
      }

      if (/^(detail )?specification(s)?$/i.test(cleanName)) {
        return;
      }

      const key = `${cleanName}\u0000${cleanValue ?? ''}`;

      if (seen.has(key)) {
        return;
      }

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

        if (cells.length < 2) {
          continue;
        }

        const name = clean(cells[0].innerText);
        const value = clean(cells.slice(1).map((cell) => cell.innerText).join(' '));

        if (name && value) {
          pairs.push({ name, value, });
        }
      }

      return pairs;
    };

    const tables = [
      ...document.querySelectorAll(selectors.tables),
    ].map((table) => {
        const pairs = parseRows(
          table.querySelectorAll(selectors.tableRows)
        );

        const surroundingText = clean(
          table.parentElement?.innerText
        ).slice(0, 500).toLowerCase();

        return {
          pairs,
          score:
            pairs.length +
            (
              /detail specification|specifications/.test(surroundingText)
                ? 20
                : 0
            ),
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const table of tables) {
      table.pairs.forEach(({ name, value }) => {
        add(name, value);
      });
    }

    return result;
  }, msiLocators.specification);
}

async function extractPricePair(page) {
  const regularPrice = parseNumber(await firstVisibleText(page, msiLocators.regularPrice));
  const currentPrice = parseNumber(await firstVisibleText(page, msiLocators.currentPrice));

  return (regularPrice !== null && currentPrice !== null)
    ? {
        price: regularPrice,
        sale_price: currentPrice,
      }
    : {
        price: currentPrice ?? regularPrice,
        sale_price: null,
      };
}

async function extractAvailability(page) {
  const texts =
    await Promise.all([
      firstVisibleText(page, msiLocators.priceWrapper),
      firstVisibleText(page, msiLocators.productQuantity),
    ]);

  return normalizeAvailability(texts.filter(Boolean).join(' '));
}

async function extractItemId(page) {
  const productId = cleanText(
    await page
      .locator(msiLocators.productIdInput)
      .first()
      .inputValue()
      .catch(() => null)
  );

  if (productId) {
    return productId;
  }

  return page.evaluate(() => {
    // Extract the tiny value in the renderer instead of copying the complete
    // document body into Node.js.
    const text = document.body?.textContent || '';
    return text.match(
      /\b(?:SKU|Product ID|Item ID)\s*[:#]?\s*([A-Za-z0-9._-]+)/i
    )?.[1] || null;
  }).then(cleanText);
}

async function extractBrand(page) {
  const isMsi = await page.evaluate(() =>
    /\bMSI\b/i.test(document.body?.textContent || '')
  ).catch(() => false);
  return isMsi ? 'MSI' : null;
}

async function extractRating(page) {
  const text = await firstVisibleText(
    page,
    msiLocators.rating
  );

  return {
    star_rating: parseNumber(
      text?.match(/\b([0-5](?:\.\d+)?)\b/)?.[1]
    ),

    review_count: parseNumber(
      text?.match(/\((\d+)\)/)?.[1]
    ),
  };
}

export async function extractMsiProduct(page, url, { navigation = {} } = {}) {
  await gotoWithRetry(page, url, navigation);
  await acceptCookiesIfPresent(page);

  await waitForAnyVisible(
    page,
    msiLocators.productTitle[0],
    8000
  );

  const title = await firstVisibleText(
    page,
    msiLocators.productTitle
  );

  if (!title) {
    throw new Error(
      `Not a product page: ${page.url() || url}`
    );
  }

  // These reads are independent once the product DOM is ready. Running them
  // together cuts sequential Playwright round-trips for each worker.
  const [
    description,
    categoryTree,
    images,
    specs,
    prices,
    rating,
    itemId,
    brand,
    availability,
  ] = await Promise.all([
    firstVisibleText(page, msiLocators.description),
    extractCategoryTree(page, title),
    extractImages(page),
    extractSpecs(page),
    extractPricePair(page),
    extractRating(page),
    extractItemId(page),
    extractBrand(page),
    extractAvailability(page),
  ]);

  return {
    url: page.url(),

    item_id: itemId,

    title,

    brand,

    product_category: categoryTree.length
      ? categoryTree
          .map((item) => item.name)
          .join(' > ')
      : null,

    category_tree: categoryTree,

    description,

    price: prices.price,

    sale_price: prices.sale_price,

    availability,

    image_url: images.image_url,

    additional_image_urls: images.additional_image_urls,

    specs,

    star_rating: rating.star_rating,

    review_count: rating.review_count,

    gtin: findSpecValue(
      specs,
      /^(gtin|upc|ean)$/i
    ),

    mpn: findSpecValue(
      specs,
      /^(mpn|manufacturer (part|number))/i
    ),

    scraped_at: new Date().toISOString(),
  };
}
