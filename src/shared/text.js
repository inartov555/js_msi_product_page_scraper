export function cleanText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\d+) (gb|tb|mb|kb|ghz|mhz|khz|w|kw|v|a)\b/g, '$1$2')
    .trim();
}

export function canonicalSpecKey(value) {
  return normalizeText(value)
    .replace(/\bmanufacturer (part|number)\b/g, 'mpn')
    .replace(/\bmodel number\b/g, 'mpn')
    .replace(/\bmemory ram\b/g, 'memory')
    .replace(/\bvideo graphics\b/g, 'graphics')
    .trim();
}

export function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : null;
}
