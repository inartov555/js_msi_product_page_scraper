/*
 * End-to-end tests.
 *
 * Covered commands:
 *   ./run_sraper.sh crawl --refresh true
 *   ./run_sraper.sh crawl --refresh false
 *   ./run_sraper.sh scrape https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II
 *   ./run_sraper.sh compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
 *   ./run_sraper.sh search "Motherboards"
 *   ./run_sraper.sh serve
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const RUNNER = './run_sraper.sh';
const OUTPUT_DIR = path.join(ROOT, 'output');
const PRODUCT_URL = 'https://us-store.msi.com/Desktops/Vision-ZS-9NVV-2080US';
const MISSING_CATALOG_SEED = 'https://us-store.msi.com/Motherboards';
const PRODUCT_A = 'MAG Z890 TOMAHAWK WIFI';
const PRODUCT_B = 'PRO Z890-P WIFI';
const API_PORT = Number(process.env.E2E_API_PORT || 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const COMMAND_TIMEOUT_MS = Number(process.env.REAL_APP_COMMAND_TIMEOUT_MS || 30 * 60 * 1000);

function runProcess(command, args, {
  cwd = ROOT,
  env = {},
  timeout = COMMAND_TIMEOUT_MS,
  detached = false,
  streamOutput = true,
} = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    for (const [name, value] of Object.entries(childEnv)) {
      if (value === undefined) delete childEnv[name];
    }

    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (streamOutput) process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (streamOutput) process.stderr.write(text);
    });

    const timer = setTimeout(() => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}
      reject(new Error(
        `Timed out after ${timeout}ms: ${command} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    }, timeout);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function assertCommandOutput(result, pattern, description = 'expected output') {
  const output = `${result.stdout}${result.stderr}`;

  assert.ok(
    output.length > 0,
    [
      `Command produced no output while checking for ${description}.`,
      `exit code: ${result.code}`,
      `signal: ${result.signal ?? 'none'}`,
      'stdout:',
      result.stdout || '<empty>',
      'stderr:',
      result.stderr || '<empty>',
    ].join('\n'),
  );

  assert.match(
    output,
    pattern,
    [
      `Command output did not contain ${description}.`,
      `Expected: ${pattern}`,
      `exit code: ${result.code}`,
      `signal: ${result.signal ?? 'none'}`,
      'stdout:',
      result.stdout || '<empty>',
      'stderr:',
      result.stderr || '<empty>',
    ].join('\n'),
  );
}

async function runScraper(args, options = {}) {
  const result = await runProcess('bash', [RUNNER, ...args], options);

  assert.equal(
    result.code,
    0,
    [
      `Command failed: ${RUNNER} ${args.join(' ')}`,
      `exit code: ${result.code}`,
      `signal: ${result.signal ?? 'none'}`,
      'stdout:',
      result.stdout || '<empty>',
      'stderr:',
      result.stderr || '<empty>',
    ].join('\n'),
  );

  return result;
}

async function readText(fileName) {
  return fs.readFile(path.join(OUTPUT_DIR, fileName), 'utf8');
}

async function readJson(fileName) {
  return JSON.parse(await readText(fileName));
}

async function waitForApi(child, url = `${API_BASE_URL}/health`, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited before becoming ready (exit code ${child.exitCode})`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`API did not become ready within ${timeoutMs}ms: ${lastError?.message || 'unknown error'}`);
}

async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (child.pid) process.kill(-child.pid, 'SIGINT');
  } catch {}

  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);

  if (child.exitCode === null) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
}

const e2eOptions = {
  timeout: COMMAND_TIMEOUT_MS,
};

// Let's skip it to make push GitHub Actions be faster
test('E2E: ./run_sraper.sh crawl --refresh true', { ...e2eOptions, skip: true }, async () => {
  await fs.rm(path.join(OUTPUT_DIR, 'catalog.json'), { force: true });
  const result = await runScraper(['crawl', '--refresh', 'true']);
  assertCommandOutput(
    result,
    /Catalog is refreshed/,
    '"Catalog is refreshed"',
  );
  assertCommandOutput(result, /Catalog analysis complete:/, '"Catalog analysis complete:"',);

  const catalog = await readJson('catalog.json');
  assert.ok(Array.isArray(catalog.products), 'catalog.json should contain a products array');
  assert.ok(catalog.products.length > 0, 'live crawl should produce at least one product');
});

test('E2E: ./run_sraper.sh crawl --refresh false uses existing catalog', e2eOptions, async () => {
  const fixtureCatalog = {
    version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    products: [{
      item_id: 'fixture-1',
      title: 'Existing Catalog Fixture',
      url: 'https://us-store.msi.com/fixture-product',
      specs: [],
    }],
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'catalog.json'),
    `${JSON.stringify(fixtureCatalog, null, 2)}\n`,
    'utf8',
  );

  const result = await runScraper(['crawl', '--refresh', 'false']);

  assertCommandOutput(result, /Using saved catalog: 1 products[.]/, '"Using saved catalog"');
  assertCommandOutput(result, /Catalog analysis complete: 1 products available[.]/, '"Catalog analysis complete:"');

  const catalog = await readJson('catalog.json');
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0].item_id, 'fixture-1');
  assert.equal(catalog.updated_at, fixtureCatalog.updated_at, 'existing catalog should not be rewritten');
});

test('E2E: ./run_sraper.sh crawl --refresh false rebuilds when catalog is missing', e2eOptions, async () => {
  await fs.rm(path.join(OUTPUT_DIR, 'catalog.json'), { force: true });

  const result = await runScraper([
    'crawl',
    '--refresh', 'false',
    // Keep the cold-start E2E representative but bounded to one real MSI
    // catalog section instead of crawling every configured product category.
    '--seed', MISSING_CATALOG_SEED,
  ]);

  assertCommandOutput(
    result,
    /Catalog data requested; analyzing MSI catalog automatically[.]{3}/,
    '"Catalog data requested; analyzing MSI catalog automatically..."',
  );
  assertCommandOutput(result, /Catalog analysis complete:/, '"Catalog analysis complete:"');

  const catalog = await readJson('catalog.json');
  assert.ok(Array.isArray(catalog.products), 'catalog.json should contain a products array');
  assert.ok(catalog.products.length > 0, 'missing catalog should be rebuilt with products');
  assert.ok(catalog.updated_at, 'rebuilt catalog should have an updated_at timestamp');
});

test('E2E: ./run_sraper.sh scrape <real MSI product URL>', e2eOptions, async () => {
  await fs.rm(path.join(OUTPUT_DIR, 'single-product.json'), { force: true });
  await runScraper(['scrape', PRODUCT_URL]);

  const product = await readJson('single-product.json');
  assert.equal(product.url, PRODUCT_URL);
  assert.ok(product.title, 'scraped product should have a title');
  assert.ok(Array.isArray(product.specs), 'scraped product should contain specs');
  assert.ok(product.specs.length > 0, 'scraped product should contain at least one specification');
  assert.ok(product.specs.some((spec) => spec?.name && spec?.value), 'scraped specs should contain name/value data');
});

test('E2E: ./run_sraper.sh compare <product A> <product B>', e2eOptions, async () => {
  await fs.rm(path.join(OUTPUT_DIR, 'comparison.csv'), { force: true });
  const result = await runScraper(['compare', PRODUCT_A, PRODUCT_B]);
  const csv = await readText('comparison.csv');

  assertCommandOutput(result, /MAG Z890 TOMAHAWK WIFI/, '"MAG Z890 TOMAHAWK WIFI"',);
  assert.match(csv, /MAG Z890 TOMAHAWK WIFI/);
  assert.match(csv, /PRO Z890-P WIFI/);
  assert.ok(csv.split(/\r?\n/).filter(Boolean).length > 1, 'comparison should contain parameter rows');
});

test('E2E: ./run_sraper.sh search Motherboards', e2eOptions, async () => {
  await fs.rm(path.join(OUTPUT_DIR, 'search.csv'), { force: true });
  await runScraper(['search', 'Motherboards']);
  const csv = await readText('search.csv');

  assert.match(csv, /^ID,Title,Price,Availability,Category/m);
  assert.match(csv, /Motherboards/i);
  assert.ok(csv.split(/\r?\n/).filter(Boolean).length > 1, 'search should return at least one product');
});

test('E2E: ./run_sraper.sh serve exposes working API endpoints', {
  ...e2eOptions,
  timeout: 5 * 60 * 1000,
}, async (t) => {
  const child = spawn('bash', [RUNNER, 'serve'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let serverOutput = '';

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    serverOutput += text;
    process.stdout.write(text);
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    serverOutput += text;
    process.stderr.write(text);
  });

  t.after(async () => {
    await stopProcessGroup(child);
  });

  await waitForApi(child);

  const healthResponse = await fetch(`${API_BASE_URL}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.ok(Number.isInteger(health.products));
  assert.ok(health.products > 0);

  const productsResponse = await fetch(
    `${API_BASE_URL}/products?q=${encodeURIComponent('Motherboards')}&limit=5`,
  );
  assert.equal(productsResponse.status, 200);
  const products = await productsResponse.json();
  assert.ok(Array.isArray(products.products));
  assert.equal(products.count, products.products.length);
  assert.ok(products.count > 0);
  assert.ok(products.count <= 5);

  const compareUrl = new URL(`${API_BASE_URL}/compare`);
  compareUrl.searchParams.append('id', PRODUCT_A);
  compareUrl.searchParams.append('id', PRODUCT_B);

  const compareResponse = await fetch(compareUrl);
  assert.equal(compareResponse.status, 200);

  const comparison = await compareResponse.json();
  assert.equal(comparison.products.length, 2);
  assert.ok(Array.isArray(comparison.rows));
  assert.ok(comparison.rows.length > 0);

  const missingCompareSelector = await fetch(
    `${API_BASE_URL}/compare?id=${encodeURIComponent(PRODUCT_A)}`,
  );
  assert.equal(missingCompareSelector.status, 400);
  assert.match((await missingCompareSelector.json()).error, /at least two/i);

  const unknownProductUrl = new URL(`${API_BASE_URL}/compare`);
  unknownProductUrl.searchParams.append('id', '__definitely_missing_product_1__');
  unknownProductUrl.searchParams.append('id', '__definitely_missing_product_2__');

  const unknownProduct = await fetch(unknownProductUrl);
  assert.equal(unknownProduct.status, 404);

  const invalidLimit = await fetch(`${API_BASE_URL}/products?limit=0`);
  assert.equal(invalidLimit.status, 400);
  assert.match((await invalidLimit.json()).error, /limit/i);

  const notFound = await fetch(`${API_BASE_URL}/does-not-exist`);
  assert.equal(notFound.status, 404);

  const notFoundBody = await notFound.json();
  assert.ok(Array.isArray(notFoundBody.endpoints));

  assert.doesNotMatch(serverOutput, /EADDRINUSE/);
});
