import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecMap, normalizeAvailability } from '../src/product.js';


test('availability normalization recognizes store states', () => {
  assert.equal(normalizeAvailability('In Stock - ADD TO CART'), 'in_stock');
  assert.equal(normalizeAvailability('Notify Me - Out of Stock'), 'out_of_stock');
  assert.equal(normalizeAvailability('Pre-order now'), 'pre_order');
});

test('spec map canonicalizes MSI parameter aliases', () => {
  const map = buildSpecMap([
    { name: 'MEMORY (RAM)', value: '32 GB' },
    { name: 'Manufacturer Number', value: 'ABC-123' },
  ]);
  assert.equal(map.get('memory').value, '32 GB');
  assert.equal(map.get('mpn').value, 'ABC-123');
});
