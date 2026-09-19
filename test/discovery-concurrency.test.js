import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMsiProductUrls } from '../src/scraper/discovery.js';

function createFakeContext({ requestDelayMs = 15 } = {}) {
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let createdPages = 0;
  let closedPages = 0;

  return {
    stats() {
      return { activeRequests, maxActiveRequests, createdPages, closedPages };
    },

    async newPage() {
      createdPages += 1;
      let currentUrl = '';

      return {
        async goto(url) {
          currentUrl = url;
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
          activeRequests -= 1;
          return { status: () => 200 };
        },

        async title() {
          return '';
        },

        locator() {
          return { innerText: async () => '' };
        },

        getByRole() {
          return {
            first() {
              return { isVisible: async () => false };
            },
          };
        },

        async evaluate() {
          const url = new URL(currentUrl);
          const pageNumber = Number(url.searchParams.get('page') || '1');
          if (pageNumber > 1) return [];

          const category = url.pathname.split('/').filter(Boolean)[0];
          return [
            `${url.origin}/${category}/Product-A`,
            `${url.origin}/${category}/Product-B`,
          ];
        },

        async close() {
          closedPages += 1;
        },
      };
    },
  };
}

test('discovery runs independent category requests concurrently with a bound', async () => {
  const context = createFakeContext();
  const seeds = [
    'https://us-store.msi.com/Laptops',
    'https://us-store.msi.com/Desktops',
    'https://us-store.msi.com/Monitors',
    'https://us-store.msi.com/Motherboards',
  ];

  const urls = await discoverMsiProductUrls(context, seeds, {
    concurrency: 2,
    delayMs: 0,
  });

  const stats = context.stats();
  assert.equal(urls.length, 8);
  assert.equal(stats.maxActiveRequests, 2);
  assert.equal(stats.createdPages, 2);
  assert.equal(stats.closedPages, 2);
});
