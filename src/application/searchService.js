import { buildSpecMap } from '../domain/product.js';
import { canonicalSpecKey, normalizeText } from '../shared/text.js';

function searchableText(product) {
  return normalizeText([
    product.title,
    product.brand,
    product.product_category,
    product.description,
    product.item_id,
    product.mpn,
    ...(product.specs ?? []).flatMap((spec) => [spec.name, spec.value]),
  ].filter(Boolean).join(' '));
}

function scoreProduct(product, queryTokens) {
  if (!queryTokens.length) return 1;
  const title = normalizeText(product.title);
  const category = normalizeText(product.product_category);
  const haystack = searchableText(product);
  let score = 0;
  for (const token of queryTokens) {
    if (!haystack.includes(token)) return 0;
    if (title.includes(token)) score += 8;
    else if (category.includes(token)) score += 4;
    else score += 1;
  }
  return score;
}

function matchesSpecFilters(product, filters) {
  if (!filters.length) return true;
  const specMap = buildSpecMap(product.specs);
  return filters.every(({ key, value }) => {
    const wantedKey = canonicalSpecKey(key);
    const wantedValue = normalizeText(value);
    for (const [actualKey, spec] of specMap.entries()) {
      if (!actualKey.includes(wantedKey) && !wantedKey.includes(actualKey)) continue;
      if (normalizeText(spec.value).includes(wantedValue)) return true;
    }
    return false;
  });
}

export function searchProducts(products, {
  query = '',
  category = null,
  minPrice = null,
  maxPrice = null,
  availability = null,
  specs = [],
  limit = 20,
} = {}) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  const normalizedCategory = normalizeText(category);
  return products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter(({ product, score }) => {
      if (score <= 0) return false;
      if (normalizedCategory && !normalizeText(product.product_category).includes(normalizedCategory)) return false;
      const effectivePrice = product.sale_price ?? product.price;
      if (minPrice != null && (effectivePrice == null || effectivePrice < minPrice)) return false;
      if (maxPrice != null && (effectivePrice == null || effectivePrice > maxPrice)) return false;
      if (availability && product.availability !== availability) return false;
      return matchesSpecFilters(product, specs);
    })
    .sort((a, b) => b.score - a.score || (a.product.title ?? '').localeCompare(b.product.title ?? ''))
    .slice(0, limit)
    .map(({ product, score }) => ({ ...product, _score: score }));
}
