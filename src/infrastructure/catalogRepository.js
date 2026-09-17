import fs from 'node:fs/promises';
import path from 'node:path';
import { productIdentity } from '../domain/product.js';

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
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      products: catalog.products,
    }, null, 2)}\n`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async upsertMany(products) {
    const catalog = await this.load();
    const map = new Map(catalog.products.map((product) => [productIdentity(product), product]));
    for (const product of products) map.set(productIdentity(product), product);
    catalog.products = [...map.values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    await this.save(catalog);
    return catalog;
  }
}
