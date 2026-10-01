import fs from 'node:fs/promises';
import path from 'node:path';
import { productIdentity } from './product.js';

function requireProductIdentity(product) {
  const identity = productIdentity(product);
  if (!identity) {
    throw new Error('Cannot store a product without item_id, mpn, or url.');
  }
  return identity;
}

function sortProducts(products) {
  return [...products].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
}

export class JsonCatalogRepository {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version ?? 1,
        updated_at: parsed.updated_at ?? null,
        products: Array.isArray(parsed.products) ? parsed.products : [],
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, updated_at: null, products: [] };
      throw error;
    }
  }

  async save(catalog) {
    const storedCatalog = {
      version: 1,
      updated_at: new Date().toISOString(),
      products: catalog.products,
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(storedCatalog, null, 2)}\n`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, this.filePath);
    console.debug(`Saved catalog to: ${this.filePath}`);
    return storedCatalog;
  }

  async upsertMany(products) {
    const catalog = mergeProducts(await this.load(), products);
    return this.save(catalog);
  }

  async replaceAll(products) {
    for (const product of products) requireProductIdentity(product);
    return this.save({ version: 1, products: sortProducts(products) });
  }
}

function mergeProducts(catalog, products) {
  const map = new Map();

  for (const product of catalog.products) {
    map.set(requireProductIdentity(product), product);
  }

  for (const product of products) {
    map.set(requireProductIdentity(product), product);
  }

  return {
    ...catalog,
    products: sortProducts(map.values()),
  };
}
