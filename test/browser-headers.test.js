import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_HEADER_PROFILES } from '../src/config.js';
import { buildBrowserContextOptions } from '../src/scraper/browser.js';

test('browser headers use the launched Chromium major version automatically', () => {
  const options = buildBrowserContextOptions({
    browserVersion: '145.0.1234.56',
    random: () => 0,
  });

  assert.match(options.userAgent, /Chrome\/145\.0\.0\.0/);
  assert.equal(options.locale, 'en-US');
  assert.equal(
    options.extraHTTPHeaders['Accept-Language'],
    BROWSER_HEADER_PROFILES[0].acceptLanguage
  );
});

test('browser header profile is selected randomly', () => {
  const first = buildBrowserContextOptions({
    browserVersion: '145.0.0.0',
    random: () => 0,
  });
  const last = buildBrowserContextOptions({
    browserVersion: '145.0.0.0',
    random: () => 0.999999,
  });

  assert.equal(
    first.extraHTTPHeaders['Accept-Language'],
    BROWSER_HEADER_PROFILES[0].acceptLanguage
  );
  assert.equal(
    last.extraHTTPHeaders['Accept-Language'],
    BROWSER_HEADER_PROFILES.at(-1).acceptLanguage
  );
  assert.notEqual(
    first.extraHTTPHeaders['Accept-Language'],
    last.extraHTTPHeaders['Accept-Language']
  );
});

test('browser context no longer hardcodes protocol-sensitive request headers', () => {
  const options = buildBrowserContextOptions({
    browserVersion: '145.0.0.0',
    random: () => 0,
  });

  const headers = options.extraHTTPHeaders;
  assert.equal(headers.Cookie, undefined);
  assert.equal(headers.Origin, undefined);
  assert.equal(headers.Referer, undefined);
  assert.equal(headers['Sec-Fetch-Site'], undefined);
  assert.equal(headers['Accept-Encoding'], undefined);
  assert.equal(headers.Connection, undefined);
});
