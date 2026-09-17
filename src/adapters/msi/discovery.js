import { msiSelectors } from './selectors.js';
import { acceptCookiesIfPresent, gotoWithRetry, sleep } from '../../infrastructure/browser.js';
import { canonicalizeUrl } from '../../shared/url.js';

function listingUrl(seedUrl, pageNumber, pageSize) {
  const url = new URL(seedUrl);
  url.searchParams.set('limit', String(pageSize));
  if (pageNumber > 1) url.searchParams.set('page', String(pageNumber));
  else url.searchParams.delete('page');
  return url.href;
}

function isSameStoreProductUrl(candidate, baseUrl) {
  try {
    const url = new URL(candidate);
    const base = new URL(baseUrl);
    if (url.origin !== base.origin) return false;
    if (/\b(route=|account|checkout|cart|contact|support|policy|search|compare)\b/i.test(`${url.pathname}${url.search}`)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function discoverMsiProductUrls(page, seedUrls, {
  pageSize = 60,
  maxPagesPerSeed = 100,
  delayMs = 250,
  maxProducts = Infinity,
  onProgress = () => {},
} = {}) {
  const discovered = new Set();

  for (const seedUrl of seedUrls) {
    const seenForSeed = new Set();
    let emptyOrRepeatedPages = 0;
    for (let pageNumber = 1; pageNumber <= maxPagesPerSeed; pageNumber += 1) {
      const url = listingUrl(seedUrl, pageNumber, pageSize);
      await gotoWithRetry(page, url);
      await acceptCookiesIfPresent(page);

      const links = await page.evaluate((selectors) => {
        const direct = [...document.querySelectorAll(selectors.join(', '))]
          .map((anchor) => anchor.href)
          .filter(Boolean);
        if (direct.length) return direct;

        // Fallback for redesigns: find links inside repeated catalog cards by card text.
        const candidates = [...document.querySelectorAll('#content a[href], main a[href]')];
        return candidates
          .filter((anchor) => {
            let node = anchor.parentElement;
            for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
              const text = node.innerText || '';
              if (/\$\s*\d/.test(text) && /compare|add to cart|notify me/i.test(text)) return true;
            }
            return false;
          })
          .map((anchor) => anchor.href)
          .filter(Boolean);
      }, msiSelectors.productCardLinks);
      const uniqueLinks = [...new Set(links.map(canonicalizeUrl))]
        .filter((candidate) => isSameStoreProductUrl(candidate, seedUrl));

      let added = 0;
      let newForSeed = 0;
      for (const productUrl of uniqueLinks) {
        if (!seenForSeed.has(productUrl)) {
          seenForSeed.add(productUrl);
          newForSeed += 1;
        }
        if (!discovered.has(productUrl)) {
          discovered.add(productUrl);
          added += 1;
          if (discovered.size >= maxProducts) break;
        }
      }

      onProgress({ seedUrl, pageNumber, foundOnPage: uniqueLinks.length, added, total: discovered.size });
      if (discovered.size >= maxProducts) return [...discovered];

      if (uniqueLinks.length === 0 || newForSeed === 0) emptyOrRepeatedPages += 1;
      else emptyOrRepeatedPages = 0;
      if (emptyOrRepeatedPages >= 1) break;

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  return [...discovered];
}
