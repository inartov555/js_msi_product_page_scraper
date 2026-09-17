import { msiSelectors } from './selectors.js';
import { acceptCookiesIfPresent, gotoWithRetry, sleep } from '../../infrastructure/browser.js';
import { canonicalizeUrl } from '../../shared/url.js';

function listingUrl(seedUrl, pageNumber) {
  const url = new URL(seedUrl);

  // Не обмежуємо каталог 12/60 товарами.
  url.searchParams.delete('limit');

  if (pageNumber > 1) {
    url.searchParams.set(
      'page',
      String(pageNumber)
    );
  } else {
    url.searchParams.delete('page');
  }

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

export async function discoverMsiProductUrls(
  page,
  seedUrls,
  {
    pageSize = 60,
    delayMs = 250,
    onProgress = () => {},
  } = {}
) {
  const discovered = new Set();

  for (const seedUrl of seedUrls) {
    const seenForSeed = new Set();
    const seenPageFingerprints = new Set();

    let pageNumber = 1;

    while (true) {
      const url = listingUrl(
        seedUrl,
        pageNumber,
        pageSize
      );

      await gotoWithRetry(
        page,
        url
      );

      await acceptCookiesIfPresent(
        page
      );

      const links = await page.evaluate(
        (selectors) => {
          const direct = [
            ...document.querySelectorAll(
              selectors.join(', ')
            ),
          ]
            .map(
              (anchor) => anchor.href
            )
            .filter(Boolean);

          if (direct.length) {
            return direct;
          }

          // Fallback for MSI layout changes.
          const candidates = [
            ...document.querySelectorAll(
              '#content a[href], main a[href]'
            ),
          ];

          return candidates
            .filter((anchor) => {
              let node =
                anchor.parentElement;

              for (
                let depth = 0;
                node && depth < 5;
                depth += 1,
                node = node.parentElement
              ) {
                const text =
                  node.innerText || '';

                if (
                  /\$\s*\d/.test(text) &&
                  /compare|add to cart|notify me/i.test(
                    text
                  )
                ) {
                  return true;
                }
              }

              return false;
            })
            .map(
              (anchor) => anchor.href
            )
            .filter(Boolean);
        },
        msiSelectors.productCardLinks
      );

      const uniqueLinks = [
        ...new Set(
          links.map(
            canonicalizeUrl
          )
        ),
      ].filter(
        (candidate) =>
          isSameStoreProductUrl(
            candidate,
            seedUrl
          )
      );

      /*
       * Якщо сторінка порожня —
       * pagination завершилась.
       */
      if (uniqueLinks.length === 0) {
        onProgress({
          seedUrl,
          pageNumber,
          foundOnPage: 0,
          added: 0,
          total:
            discovered.size,
          done: true,
          reason: 'empty-page',
        });

        break;
      }

      /*
       * Захист від ситуації, коли MSI
       * для page=999 повертає останню
       * існуючу сторінку ще раз.
       */
      const fingerprint =
        [...uniqueLinks]
          .sort()
          .join('\n');

      if (
        seenPageFingerprints.has(
          fingerprint
        )
      ) {
        onProgress({
          seedUrl,
          pageNumber,
          foundOnPage:
            uniqueLinks.length,
          added: 0,
          total:
            discovered.size,
          done: true,
          reason:
            'repeated-page',
        });

        break;
      }

      seenPageFingerprints.add(
        fingerprint
      );

      let added = 0;
      let newForSeed = 0;

      for (
        const productUrl of
        uniqueLinks
      ) {
        if (
          !seenForSeed.has(
            productUrl
          )
        ) {
          seenForSeed.add(
            productUrl
          );

          newForSeed += 1;
        }

        if (
          !discovered.has(
            productUrl
          )
        ) {
          discovered.add(
            productUrl
          );

          added += 1;
        }
      }

      onProgress({
        seedUrl,
        pageNumber,
        foundOnPage:
          uniqueLinks.length,
        added,
        total:
          discovered.size,
      });

      /*
       * Якщо сторінка не додала жодного
       * нового product URL для цього seed,
       * значить ми дійшли до кінця
       * або сервер почав повторювати
       * останню сторінку.
       */
      if (newForSeed === 0) {
        break;
      }

      pageNumber += 1;

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  return [
    ...discovered
  ];
}
