import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RUNNER = './run_sraper.sh';
const OUTPUT_DIR = path.join(ROOT, 'output');
const PRODUCT_URL = 'https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II';
const PRODUCT_A = 'MAG Z890 TOMAHAWK WIFI';
const PRODUCT_B = 'PRO Z890-P WIFI';
const API_BASE_URL = 'http://127.0.0.1:3000';
const COMMAND_TIMEOUT_MS = Number(process.env.REAL_APP_COMMAND_TIMEOUT_MS || 30 * 60 * 1000);

function runProcess(command, args, {
  cwd = ROOT,
  env = process.env,
  timeout = COMMAND_TIMEOUT_MS,
  detached = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}
      reject(new Error(`Timed out after ${timeout}ms: ${command} ${args.join(' ')}\n${stdout}\n${stderr}`));
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

async function runScraper(...args) {
  const result = await runProcess('bash', [RUNNER, ...args]);
  assert.equal(
    result.code,
    0,
    `Command failed: ${RUNNER} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function commandWorks(command, args) {
  try {
    const result = await runProcess(command, args, { timeout: 15_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

const dockerAvailable = await commandWorks('docker', ['compose', 'version']);
const liveSkip = dockerAvailable ? false : 'Docker Compose is required for real application tests';

async function readText(fileName) {
  return fs.readFile(path.join(OUTPUT_DIR, fileName), 'utf8');
}

async function readJson(fileName) {
  return JSON.parse(await readText(fileName));
}

async function waitForApi(url = `${API_BASE_URL}/health`, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
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
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]);
  if (child.exitCode === null) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
}

// These tests deliberately execute the public bash entry point, not internal JS functions.
// Keep this file named *.integration.js so `npm test` does not recursively execute it
// when the test below runs `./run_sraper.sh test`.

test('real usage: crawl with existing catalog (--refresh false)', {
  skip: liveSkip,
  timeout: COMMAND_TIMEOUT_MS,
}, async () => {
  const result = await runScraper('crawl', '--refresh', 'false');
  assert.match(result.stdout + result.stderr, /Catalog analysis complete:/);

  const catalog = await readJson('catalog.json');
  assert.ok(Array.isArray(catalog.products), 'catalog.json should contain a products array');
  assert.ok(catalog.products.length > 0, 'catalog should contain products');
});

test('real usage: crawl live MSI catalog (--refresh true)', {
  skip: liveSkip,
  timeout: COMMAND_TIMEOUT_MS,
}, async () => {
  const result = await runScraper('crawl', '--refresh', 'true');
  assert.match(result.stdout + result.stderr, /Catalog analysis complete:/);

  const catalog = await readJson('catalog.json');
  assert.ok(Array.isArray(catalog.products));
  assert.ok(catalog.products.length > 0, 'live crawl should produce at least one product');
});

test('real usage: scrape a real product through run_sraper.sh', {
  skip: liveSkip,
  timeout: COMMAND_TIMEOUT_MS,
}, async () => {
  await runScraper('scrape', PRODUCT_URL);

  const product = await readJson('single-product.json');
  assert.equal(product.url, PRODUCT_URL);
  assert.ok(product.title, 'scraped product should have a title');
  assert.ok(Array.isArray(product.specs), 'scraped product should contain specs');
});

test('real usage: compare two products through run_sraper.sh', {
  skip: liveSkip,
  timeout: COMMAND_TIMEOUT_MS,
}, async () => {
  const result = await runScraper('compare', PRODUCT_A, PRODUCT_B);
  const csv = await readText('comparison.csv');

  assert.match(result.stdout + result.stderr, /MAG Z890 TOMAHAWK WIFI/);
  assert.match(csv, /MAG Z890 TOMAHAWK WIFI/);
  assert.match(csv, /PRO Z890-P WIFI/);
  assert.ok(csv.split(/\r?\n/).filter(Boolean).length > 1, 'comparison should contain parameter rows');
});

test('real usage: search Motherboards through run_sraper.sh', {
  skip: liveSkip,
  timeout: COMMAND_TIMEOUT_MS,
}, async () => {
  await runScraper('search', 'Motherboards');
  const csv = await readText('search.csv');

  assert.match(csv, /^ID,Title,Price,Availability,Category/m);
  assert.match(csv, /Motherboards/i);
  assert.ok(csv.split(/\r?\n/).filter(Boolean).length > 1, 'search should return at least one product');
});

test('real usage: serve starts API and API methods work', {
  skip: liveSkip,
  timeout: 5 * 60 * 1000,
}, async (t) => {
  const child = spawn('bash', [RUNNER, 'serve'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  t.after(async () => {
    await stopProcessGroup(child);
    await runProcess('docker', ['compose', 'down', '--remove-orphans'], { timeout: 60_000 }).catch(() => {});
  });

  await waitForApi();

  const healthResponse = await fetch(`${API_BASE_URL}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.ok(Number.isInteger(health.products));
  assert.ok(health.products > 0);

  const productsResponse = await fetch(`${API_BASE_URL}/products?q=${encodeURIComponent('Motherboards')}&limit=5`);
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

  const missingCompareSelector = await fetch(`${API_BASE_URL}/compare?id=${encodeURIComponent(PRODUCT_A)}`);
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

test('real usage: run_sraper.sh test executes the normal JS test suite', {
  skip: liveSkip,
  timeout: 10 * 60 * 1000,
}, async () => {
  const result = await runScraper('test');
  const output = result.stdout + result.stderr;
  assert.match(output, /npm run test/);
  assert.match(output, /# pass\s+\d+/);
  assert.match(output, /# fail\s+0/);
});
