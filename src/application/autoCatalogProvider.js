function isUsableCatalog(catalog) {
  return Array.isArray(catalog?.products)
    && catalog.products.length > 0
    && catalog.products.every((product) => product?.url && product?.title);
}

export class AutoCatalogProvider {
  constructor({ repository, buildCatalog, logger = console }) {
    this.repository = repository;
    this.buildCatalog = buildCatalog;
    this.logger = logger;
    this.buildPromise = null;
  }

  async getCatalog({ refresh = false } = {}) {
    const current = await this.repository.load();

    if (!refresh && isUsableCatalog(current)) {
      this.logger.log(`Using saved catalog: ${current.products.length} products.`);
      return current;
    }

    if (!refresh && current.products.length > 0) {
      this.logger.warn('Saved catalog is invalid or contains non-product records; rebuilding it.');
    }

    if (!this.buildPromise) {
      this.buildPromise = (async () => {
        this.logger.log(refresh ? 'Refreshing MSI catalog...' : 'Catalog data requested; analyzing MSI catalog automatically...');
        const result = await this.buildCatalog();
        const catalog = result?.catalog ?? await this.repository.load();
        this.logger.log(`Catalog analysis complete: ${catalog.products.length} products available.`);
        return catalog;
      })().finally(() => {
        this.buildPromise = null;
      });
    }

    return this.buildPromise;
  }

  async getProducts(options) {
    return (await this.getCatalog(options)).products;
  }
}
