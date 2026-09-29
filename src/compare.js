import { buildSpecMap } from './product.js';
import { normalizeText } from './shared/text.js';

const CORE_FIELDS = [
  ['Price', (product) => product.price],
  ['Sale price', (product) => product.sale_price],
  ['Availability', (product) => product.availability],
  ['Rating', (product) => product.star_rating],
  ['Review count', (product) => product.review_count],
  ['Category', (product) => product.product_category],
  ['MPN', (product) => product.mpn],
  ['GTIN', (product) => product.gtin],
];

export function resolveProduct(products, selector) {
  const needle = normalizeText(selector);
  const exact = products.find((product) =>
    [product.item_id, product.mpn, product.url, product.title].some((value) => normalizeText(value) === needle));
  if (exact) return exact;

  const matches = products.filter((product) =>
    [product.item_id, product.mpn, product.url, product.title].some((value) => normalizeText(value).includes(needle)));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No product matches "${selector}".`);
  throw new Error(`Ambiguous product selector "${selector}". Matches: ${matches.slice(0, 8).map((item) => item.title).join('; ')}`);
}

function valuesSame(values) {
  const normalized = values.map((value) => normalizeText(value));
  return normalized.every((value) => value === normalized[0]);
}

export function compareProducts(products, { includeEqual = false, fields = null } = {}) {
  if (products.length < 2) throw new Error('At least two products are required for comparison.');

  const rows = CORE_FIELDS.map(([parameter, getValue]) => ({
    parameter,
    values: products.map(getValue),
  }));

  const specMaps = products.map((product) => buildSpecMap(product.specs));
  const allSpecKeys = new Set(specMaps.flatMap((map) => [...map.keys()]));
  for (const key of [...allSpecKeys].sort()) {
    const displayName = specMaps.map((map) => map.get(key)?.name).find(Boolean) ?? key;
    rows.push({
      parameter: displayName,
      values: specMaps.map((map) => map.get(key)?.value ?? null),
    });
  }

  const fieldNeedles = fields?.length ? fields.map(normalizeText) : null;
  return rows
    .map((row) => ({ ...row, same: valuesSame(row.values) }))
    .filter((row) => includeEqual || !row.same)
    .filter((row) => !fieldNeedles || fieldNeedles.some((needle) => normalizeText(row.parameter).includes(needle)));
}
