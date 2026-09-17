import { canonicalSpecKey, cleanText } from '../shared/text.js';

export function normalizeAvailability(value) {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;
  if (/pre[- ]?order|preorder/.test(text)) return 'pre_order';
  if (/out\s*of\s*stock|sold out|notify me|outofstock/.test(text)) return 'out_of_stock';
  if (/in\s*stock|add to cart|instock/.test(text)) return 'in_stock';
  return null;
}

export function buildSpecMap(specs = []) {
  const map = new Map();
  for (const spec of specs) {
    const key = canonicalSpecKey(spec?.name);
    if (!key) continue;
    const value = cleanText(spec?.value);
    if (!map.has(key) || (!map.get(key).value && value)) {
      map.set(key, { name: cleanText(spec?.name), value });
    }
  }
  return map;
}

export function findSpecValue(specs, matcher) {
  return specs.find((spec) => matcher.test(spec.name ?? ''))?.value ?? null;
}

export function productIdentity(product) {
  return product.item_id || product.mpn || product.url;
}

export function validateProduct(product) {
  const problems = [];
  if (!product?.url) problems.push('url');
  if (!product?.title) problems.push('title');
  if (product?.price == null && product?.sale_price == null) problems.push('price/sale_price');
  if (!product?.image_url) problems.push('image_url');
  if (!Array.isArray(product?.specs) || product.specs.length < 1) problems.push('specs');
  return problems;
}
