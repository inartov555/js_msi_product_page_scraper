// Unit tests

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonCatalogRepository } from '../../src/repository.js';

async function withRepository(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msi-repository-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new JsonCatalogRepository(path.join(dir, 'catalog.json'));
}

test('replaceAll persists and returns the same timestamped catalog', async (t) => {
  const repository = await withRepository(t);
  const saved = await repository.replaceAll([
    { item_id: '2', title: 'B' },
    { item_id: '1', title: 'A' },
  ]);
  const loaded = await repository.load();

  assert.equal(saved.updated_at, loaded.updated_at);
  assert.deepEqual(saved.products.map((product) => product.title), ['A', 'B']);
  assert.deepEqual(loaded.products, saved.products);
});

test('upsertMany replaces products with the same identity', async (t) => {
  const repository = await withRepository(t);
  await repository.replaceAll([{ item_id: '1', title: 'Old title' }]);
  const saved = await repository.upsertMany([{ item_id: '1', title: 'New title' }]);

  assert.equal(saved.products.length, 1);
  assert.equal(saved.products[0].title, 'New title');
});

test('upsertMany merges a URL-only product when a later scrape adds item_id', async (t) => {
  const repository = await withRepository(t);
  const url = 'https://us-store.msi.com/example-product';

  await repository.replaceAll([{ url, title: 'Old title' }]);
  const saved = await repository.upsertMany([{ item_id: '123', url, title: 'Enriched title' }]);

  assert.equal(saved.products.length, 1);
  assert.equal(saved.products[0].item_id, '123');
  assert.equal(saved.products[0].url, url);
  assert.equal(saved.products[0].title, 'Enriched title');
});

test('upsertMany merges products when any stable identity matches', async (t) => {
  const repository = await withRepository(t);

  await repository.replaceAll([{
    item_id: 'old-id',
    mpn: 'MPN-123',
    url: 'https://us-store.msi.com/old-url',
    title: 'Old product',
  }]);

  const saved = await repository.upsertMany([{
    item_id: 'new-id',
    mpn: 'MPN-123',
    url: 'https://us-store.msi.com/new-url',
    title: 'Updated product',
  }]);

  assert.equal(saved.products.length, 1);
  assert.equal(saved.products[0].item_id, 'new-id');
  assert.equal(saved.products[0].title, 'Updated product');
});

test('repository rejects products without a stable identity', async (t) => {
  const repository = await withRepository(t);
  await assert.rejects(
    repository.replaceAll([{ title: 'Identity-less product' }]),
    /without item_id, mpn, or url/,
  );
});
