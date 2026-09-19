import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMsiProductUrls } from '../src/scraper/discovery.js';

function createFakeContext({
  requestDelayMs = 15,
  lastPage = 1,
} = {}) {
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
          if (pageNumber > lastPage) return [];

          const category = url.pathname.split('/').filter(Boolean)[0];
          return [
            `${url.origin}/${category}/Product-${pageNumber}-A`,
            `${url.origin}/${category}/Product-${pageNumber}-B`,
          ];
        },

        async close() {
          closedPages += 1;
        },
      };
    },
  };
}

test('discovery applies its concurrency limit to listing-page requests globally', async () => {
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
  assert.ok(stats.createdPages >= 8);
  assert.equal(stats.closedPages, stats.createdPages);
});

test('discovery can use all 50 request slots with only eight category seeds', async () => {
  const context = createFakeContext({
    requestDelayMs: 25,
    lastPage: 10,
  });
  const seeds = [
    'https://us-store.msi.com/Laptops',
    'https://us-store.msi.com/Desktops',
    'https://us-store.msi.com/Monitors',
    'https://us-store.msi.com/Graphics-Cards',
    'https://us-store.msi.com/Motherboards',
    'https://us-store.msi.com/PC-Components',
    'https://us-store.msi.com/Gaming-Gears',
    'https://us-store.msi.com/EV-chargers',
  ];

  const urls = await discoverMsiProductUrls(context, seeds, {
    concurrency: 50,
    delayMs: 0,
  });

  const stats = context.stats();
  assert.equal(urls.length, 8 * 10 * 2);
  assert.equal(stats.maxActiveRequests, 50);
  assert.equal(stats.activeRequests, 0);
  assert.equal(stats.closedPages, stats.createdPages);
});

test('speculative pages after the first empty page are discarded', async () => {
  let currentRequests = 0;

  const context = {
    async newPage() {
      let currentUrl = '';

      return {
        async goto(url) {
          currentUrl = url;
          currentRequests += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          currentRequests -= 1;
          return { status: () => 200 };
        },
        async title() { return ''; },
        locator() { return { innerText: async () => '' }; },
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
          if (pageNumber === 1) {
            return [`${url.origin}/Laptops/Product-1`];
          }
          if (pageNumber === 2) return [];
          return [`${url.origin}/Laptops/SHOULD-NOT-BE-COMMITTED-${pageNumber}`];
        },
        async close() {},
      };
    },
  };

  const urls = await discoverMsiProductUrls(
    context,
    ['https://us-store.msi.com/Laptops'],
    { concurrency: 3, delayMs: 0 }
  );

  assert.deepEqual(urls, ['https://us-store.msi.com/Laptops/Product-1']);
  assert.equal(currentRequests, 0);
});


test('discovery reports and refills fast slots without waiting for the slowest request', async () => {
  let createdPages = 0;
  let closedPages = 0;
  let releaseSlow;
  let markSlowStarted;
  const slowStarted = new Promise((resolve) => { markSlowStarted = resolve; });
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const progress = [];

  const context = {
    async newPage() {
      createdPages += 1;
      let currentUrl = '';

      return {
        async goto(url) {
          currentUrl = url;
          const parsed = new URL(url);
          const category = parsed.pathname.split('/').filter(Boolean)[0];
          const pageNumber = Number(parsed.searchParams.get('page') || '1');

          if (category === 'Laptops' && pageNumber === 2) {
            markSlowStarted();
            await slowGate;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }

          return { status: () => 200 };
        },
        async title() { return ''; },
        locator() { return { innerText: async () => '' }; },
        getByRole() {
          return {
            first() {
              return { isVisible: async () => false };
            },
          };
        },
        async evaluate() {
          const parsed = new URL(currentUrl);
          const category = parsed.pathname.split('/').filter(Boolean)[0];
          const pageNumber = Number(parsed.searchParams.get('page') || '1');

          if (pageNumber > 1) return [];
          return [`${parsed.origin}/${category}/Product-1`];
        },
        async close() {
          closedPages += 1;
        },
      };
    },
  };

  const discovery = discoverMsiProductUrls(
    context,
    [
      'https://us-store.msi.com/Laptops',
      'https://us-store.msi.com/Desktops',
    ],
    {
      concurrency: 4,
      delayMs: 0,
      onProgress: (entry) => progress.push(entry),
    }
  );

  await slowStarted;

  const deadline = Date.now() + 500;
  while ((progress.length === 0 || createdPages <= 4) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(progress.length > 0, 'progress should be emitted while another request is still blocked');
  assert.ok(createdPages > 4, 'a freed slot should be refilled before the slow request finishes');

  releaseSlow();
  const urls = await discovery;

  assert.deepEqual(
    [...urls].sort(),
    [
      'https://us-store.msi.com/Desktops/Product-1',
      'https://us-store.msi.com/Laptops/Product-1',
    ]
  );
  assert.equal(closedPages, createdPages);
});

test('discovery retries a transient 403 on a fresh page without aborting other categories', async () => {
  let createdPages = 0;
  let closedPages = 0;
  let blockedOnce = false;
  const progress = [];

  const context = {
    async newPage() {
      createdPages += 1;
      let currentUrl = '';

      return {
        async goto(url) {
          currentUrl = url;
          const parsed = new URL(url);
          const category = parsed.pathname.split('/').filter(Boolean)[0];
          const pageNumber = Number(parsed.searchParams.get('page') || '1');

          if (category === 'PC-Components' && pageNumber === 1 && !blockedOnce) {
            blockedOnce = true;
            return {
              status: () => 403,
              headers: () => ({}),
            };
          }

          return {
            status: () => 200,
            headers: () => ({}),
          };
        },
        async title() { return ''; },
        locator() { return { innerText: async () => '' }; },
        getByRole() {
          return {
            first() {
              return { isVisible: async () => false };
            },
          };
        },
        async evaluate() {
          const parsed = new URL(currentUrl);
          const category = parsed.pathname.split('/').filter(Boolean)[0];
          const pageNumber = Number(parsed.searchParams.get('page') || '1');
          if (pageNumber > 1) return [];
          return [`${parsed.origin}/${category}/Product-1`];
        },
        async close() { closedPages += 1; },
      };
    },
  };

  const urls = await discoverMsiProductUrls(
    context,
    [
      'https://us-store.msi.com/PC-Components',
      'https://us-store.msi.com/Laptops',
    ],
    {
      concurrency: 4,
      delayMs: 0,
      discoveryAttempts: 3,
      retryBaseDelayMs: 0,
      accessDeniedPauseMs: 0,
      navigationAttempts: 1,
      random: () => 0.5,
      onProgress: (entry) => progress.push(entry),
    }
  );

  assert.equal(blockedOnce, true);
  assert.ok(
    progress.some((entry) => entry.seedUrl.endsWith('/Laptops')),
    'unrelated category should continue while the blocked page is retried'
  );
  assert.deepEqual(
    [...urls].sort(),
    [
      'https://us-store.msi.com/Laptops/Product-1',
      'https://us-store.msi.com/PC-Components/Product-1',
    ]
  );
  assert.equal(closedPages, createdPages);
});

test('permanent discovery failure is reported only after other categories finish', async () => {
  const progress = [];

  const context = {
    async newPage() {
      let currentUrl = '';

      return {
        async goto(url) {
          currentUrl = url;
          const parsed = new URL(url);
          const category = parsed.pathname.split('/').filter(Boolean)[0];

          if (category === 'PC-Components') {
            return {
              status: () => 403,
              headers: () => ({}),
            };
          }

          return {
            status: () => 200,
            headers: () => ({}),
          };
        },
        async title() { return ''; },
        locator() { return { innerText: async () => '' }; },
        getByRole() {
          return {
            first() {
              return { isVisible: async () => false };
            },
          };
        },
        async evaluate() {
          const parsed = new URL(currentUrl);
          const pageNumber = Number(parsed.searchParams.get('page') || '1');
          if (pageNumber > 1) return [];
          const category = parsed.pathname.split('/').filter(Boolean)[0];
          return [`${parsed.origin}/${category}/Product-1`];
        },
        async close() {},
      };
    },
  };

  await assert.rejects(
    discoverMsiProductUrls(
      context,
      [
        'https://us-store.msi.com/PC-Components',
        'https://us-store.msi.com/Laptops',
      ],
      {
        concurrency: 4,
        delayMs: 0,
        discoveryAttempts: 2,
        retryBaseDelayMs: 0,
        accessDeniedPauseMs: 0,
        navigationAttempts: 1,
        random: () => 0.5,
        onProgress: (entry) => progress.push(entry),
      }
    ),
    (error) => {
      assert.match(error.message, /Discovery failed for 1 listing page/);
      return true;
    }
  );

  assert.ok(
    progress.some((entry) => entry.seedUrl.endsWith('/Laptops')),
    'healthy categories should finish before the aggregate error is raised'
  );
});
