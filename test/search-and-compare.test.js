import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts } from '../src/application/searchService.js';
import { compareProducts, resolveProduct } from '../src/application/compareService.js';

const products = [
  {
    item_id: '1',
    title: 'MAG Z890 TOMAHAWK WIFI',
    product_category: 'Motherboards > Intel Z890',
    price: 259.99,
    sale_price: null,
    availability: 'in_stock',
    specs: [
      { name: 'CPU SOCKET', value: 'LGA 1851' },
      { name: 'MEMORY', value: 'DDR5, Maximum 256GB' },
      { name: 'LAN', value: '5Gbps LAN' },
    ],
  },
  {
    item_id: '2',
    title: 'PRO Z890-P WIFI',
    product_category: 'Motherboards > Intel Z890',
    price: 229.99,
    sale_price: 199.99,
    availability: 'out_of_stock',
    specs: [
      { name: 'CPU SOCKET', value: 'LGA 1851' },
      { name: 'MEMORY', value: 'DDR5, Maximum 256GB' },
      { name: 'LAN', value: '2.5Gbps LAN' },
    ],
  },
];

test('searches full text and filters by specs', () => {
  const results = searchProducts(products, {
    query: 'z890 wifi',
    specs: [{ key: 'cpu socket', value: '1851' }],
    maxPrice: 250,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].item_id, '2');
});

test('resolves product by title fragment', () => {
  assert.equal(resolveProduct(products, 'tomahawk').item_id, '1');
});

test('comparison returns differing parameter rows by default', () => {
  const rows = compareProducts(products);
  assert.ok(rows.some((row) => row.parameter === 'LAN'));
  assert.ok(!rows.some((row) => row.parameter === 'CPU SOCKET'));
});

test('comparison can include equal rows', () => {
  const rows = compareProducts(products, { includeEqual: true });
  assert.ok(rows.some((row) => row.parameter === 'CPU SOCKET' && row.same));
});

test('search uses sale price as effective price', () => {
  const results = searchProducts(products, { maxPrice: 210 });
  assert.deepEqual(results.map((product) => product.item_id), ['2']);
});

test('spec filter normalizes equivalent parameter names', () => {
  const memoryVariant = [{
    ...products[0],
    item_id: '3',
    title: 'Memory Variant',
    specs: [{ name: 'MEMORY (RAM)', value: '32 GB DDR5' }],
  }];
  const results = searchProducts(memoryVariant, { specs: [{ key: 'memory', value: '32GB' }] });
  assert.equal(results.length, 1);
});

test('ambiguous selector fails instead of silently picking a product', () => {
  assert.throws(() => resolveProduct(products, 'wifi'), /Ambiguous product selector/);
});

test('comparison can focus on selected parameter names', () => {
  const rows = compareProducts(products, { includeEqual: true, fields: ['cpu socket'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parameter, 'CPU SOCKET');
});
