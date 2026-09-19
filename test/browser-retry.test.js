import test from 'node:test';
import assert from 'node:assert/strict';
import { gotoWithRetry } from '../src/scraper/browser.js';

function fakePage(statuses, { deniedBody = 'Access Denied' } = {}) {
  let calls = 0;
  let currentStatus = null;

  return {
    get calls() {
      return calls;
    },

    async goto() {
      const status = statuses[Math.min(calls, statuses.length - 1)];
      currentStatus = status;
      calls += 1;
      return {
        status: () => status,
        headers: () => ({}),
      };
    },

    async title() {
      return '';
    },

    locator() {
      return {
        innerText: async () => (currentStatus === 403 ? deniedBody : ''),
      };
    },
  };
}

test('403 responses back off before retrying', async () => {
  const page = fakePage([403, 200]);
  const delays = [];

  await gotoWithRetry(page, 'https://us-store.msi.com/test', {
    attempts: 2,
    sleepFn: async (delay) => delays.push(delay),
    random: () => 0.5,
  });

  assert.equal(page.calls, 2);
  assert.deepEqual(delays, [5000]);
});

test('non-retryable 404 responses fail without repeated requests', async () => {
  const page = fakePage([404]);
  const delays = [];

  await assert.rejects(
    gotoWithRetry(page, 'https://us-store.msi.com/missing', {
      attempts: 4,
      sleepFn: async (delay) => delays.push(delay),
      random: () => 0.5,
    }),
    /HTTP 404/
  );

  assert.equal(page.calls, 1);
  assert.deepEqual(delays, []);
});
