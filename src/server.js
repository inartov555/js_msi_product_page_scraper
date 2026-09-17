import http from 'node:http';
import { DEFAULT_CATALOG_FILE } from './config.js';
import { JsonCatalogRepository } from './infrastructure/catalogRepository.js';
import { searchProducts } from './application/searchService.js';
import { compareProducts, resolveProduct } from './application/compareService.js';

const port = Number(process.env.PORT || 3000);
const repository = new JsonCatalogRepository(process.env.CATALOG_FILE || DEFAULT_CATALOG_FILE);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function parseSpecs(searchParams) {
  return searchParams.getAll('spec').map((entry) => {
    const index = entry.indexOf('=');
    if (index < 1) throw new Error(`Invalid spec filter: ${entry}`);
    return { key: entry.slice(0, index), value: entry.slice(index + 1) };
  });
}

function optionalNumber(searchParams, name) {
  if (!searchParams.has(name)) return null;
  const value = Number(searchParams.get(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function limitNumber(searchParams) {
  const value = optionalNumber(searchParams, 'limit') ?? 20;
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('limit must be an integer between 1 and 500.');
  return value;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { products } = await repository.load();

    if (url.pathname === '/health') return json(res, 200, { ok: true, products: products.length });

    if (url.pathname === '/products') {
      const results = searchProducts(products, {
        query: url.searchParams.get('q') || '',
        category: url.searchParams.get('category'),
        minPrice: optionalNumber(url.searchParams, 'minPrice'),
        maxPrice: optionalNumber(url.searchParams, 'maxPrice'),
        availability: url.searchParams.get('availability'),
        specs: parseSpecs(url.searchParams),
        limit: limitNumber(url.searchParams),
      });
      return json(res, 200, { count: results.length, products: results });
    }

    if (url.pathname === '/compare') {
      const selectors = url.searchParams.getAll('id');
      if (selectors.length < 2) return json(res, 400, { error: 'Pass at least two ?id= selectors.' });
      let selected;
      try {
        selected = selectors.map((selector) => resolveProduct(products, selector));
      } catch (error) {
        const status = /^No product matches/.test(error.message) ? 404 : 400;
        return json(res, status, { error: error.message });
      }
      const rows = compareProducts(selected, {
        includeEqual: url.searchParams.get('all') === 'true',
        fields: url.searchParams.getAll('field'),
      });
      return json(res, 200, { products: selected, rows });
    }

    return json(res, 404, { error: 'Not found', endpoints: ['/health', '/products', '/compare'] });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`Catalog API listening on http://localhost:${port}`));
