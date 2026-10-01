// Unit tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRatingText } from '../../src/scraper/extractor.js';

test('parses compact rating text from the dedicated rating element', () => {
  assert.deepEqual(parseRatingText('4.8 (123)'), {
    star_rating: 4.8,
    review_count: 123,
  });
});

test('parses labeled MSI rating text from a page-level fallback', () => {
  assert.deepEqual(
    parseRatingText(null, 'Average Customer Rating Overall ★★★★☆ 4.2 (17)'),
    { star_rating: 4.2, review_count: 17 },
  );
});

test('does not treat unrelated parenthesized body counts as reviews', () => {
  assert.deepEqual(
    parseRatingText(null, 'Compatible Models (12) Accessories (5)'),
    { star_rating: null, review_count: null },
  );
});
