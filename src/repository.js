import fs from 'node:fs/promises';
import path from 'node:path';
import { productIdentity, productIdentities } from './product.js';

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

function sharesIdentity(product, identities) {
  return productIdentities(product).some((identity) => identities.has(identity));
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
  for (const product of catalog.products) requireProductIdentity(product);
  const merged = [...catalog.products];

  for (const product of products) {
    requireProductIdentity(product);
    const identities = new Set(productIdentities(product));

    // A product may gain a stronger identifier on a later scrape (for example,
    // URL-only -> item_id + URL). Remove every old record sharing any stable
    // identifier before inserting the fresh record so enrichment cannot create
    // duplicates.
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (sharesIdentity(merged[index], identities)) merged.splice(index, 1);
    }

    merged.push(product);
  }

  return {
    ...catalog,
    products: sortProducts(merged),
  };
}
