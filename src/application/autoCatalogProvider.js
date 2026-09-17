export class AutoCatalogProvider {
  constructor({ repository, buildCatalog, logger = console }) {
    this.repository = repository;
    this.buildCatalog = buildCatalog;
    this.logger = logger;
    this.buildPromise = null;
  }

  async status() {
    const catalog = await this.repository.load();

    return {
      loaded: catalog.products.length > 0,
      products: catalog.products.length,
      updated_at: catalog.updated_at ?? null,
      analyzing: Boolean(this.buildPromise),
    };
  }

  async getCatalog({ refresh = false } = {}) {
    const current = await this.repository.load();

    if (!refresh && current.products.length > 0) {
      return current;
    }

    if (!this.buildPromise) {
      this.buildPromise = (async () => {
        this.logger.log(
          'Catalog data requested; analyzing MSI catalog automatically...'
        );

        const result = await this.buildCatalog();

        const catalog =
          result?.catalog ?? await this.repository.load();

        this.logger.log(
          `Catalog analysis complete: ${catalog.products.length} products available.`
        );

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
