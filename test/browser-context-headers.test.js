import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BROWSER_CONTEXT,
  createBrowserContextOptions,
} from '../src/config.js';

test('randomized browser context preserves all original header keys', () => {
  const options = createBrowserContextOptions(() => 0);
  const originalHeaders = DEFAULT_BROWSER_CONTEXT.extraHTTPHeaders;

  assert.deepEqual(
    Object.keys(options.extraHTTPHeaders).sort(),
    Object.keys(originalHeaders).sort()
  );

  for (const [key, value] of Object.entries(originalHeaders)) {
    if (['User-Agent', 'Accept-Language', 'Referer'].includes(key)) continue;
    assert.equal(options.extraHTTPHeaders[key], value);
  }
});

test('selected headers change with the random source', () => {
  const first = createBrowserContextOptions(() => 0).extraHTTPHeaders;
  const last = createBrowserContextOptions(() => 0.999999).extraHTTPHeaders;

  assert.notEqual(first['User-Agent'], last['User-Agent']);
  assert.notEqual(first['Accept-Language'], last['Accept-Language']);
});
