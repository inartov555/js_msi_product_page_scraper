import { DEFAULT_BASE_URL } from '../../config.js';

const PRODUCT_PREFIXES = [
  '',
  'Intel-Platform-Motherboard',
  'AMD-Platform-Motherboard',
  'Graphics-Cards',
  'Laptops',
  'Desktops',
  'Monitors',
  'PC-Components',
];

function isHttpUrl(value) {
  return /^https?:\/\//i.test(
    String(value ?? '').trim()
  );
}

function productSlug(selector) {
  return String(selector ?? '')
    .trim()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildMsiProductUrlCandidates(
  selector,
  baseUrl = DEFAULT_BASE_URL
) {
  if (isHttpUrl(selector)) {
    return [String(selector).trim()];
  }

  const slug = productSlug(selector);

  if (!slug) {
    return [];
  }

  return PRODUCT_PREFIXES.map((prefix) =>
    new URL(
      prefix
        ? `${prefix}/${slug}`
        : slug,
      `${baseUrl}/`
    ).href
  );
}
