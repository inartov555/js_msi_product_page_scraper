// Unit tests

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BROWSER_CONTEXT,
  createBrowserContextOptions,
} from '../../src/config.js';

test('browser profile preserves the desktop context shape', () => {
  const options = createBrowserContextOptions(() => 0);

  assert.deepEqual(options.viewport, DEFAULT_BROWSER_CONTEXT.viewport);
  assert.deepEqual(options.screen, DEFAULT_BROWSER_CONTEXT.screen);
  assert.equal(options.isMobile, false);
  assert.equal(options.hasTouch, false);
  assert.match(options.userAgent, /Windows NT/);
  assert.equal(options.locale, 'en-US');
  assert.equal(options.extraHTTPHeaders['Accept-Language'], 'en-US,en;q=0.9');
});

test('profile selection is deterministic from the supplied random source', () => {
  const first = createBrowserContextOptions(() => 0);
  const last = createBrowserContextOptions(() => 0.999999);

  assert.notEqual(first.userAgent, last.userAgent);
  assert.equal(first.extraHTTPHeaders['Accept-Language'], last.extraHTTPHeaders['Accept-Language']);
});
