import { DEFAULT_SEED_URLS } from '../config.js';
import { AutoCatalogProvider } from './autoCatalogProvider.js';

export function createAutoCatalog({
  repository,
  seedUrls = DEFAULT_SEED_URLS,
  concurrency = 3,
  delayMs = 300,
  headless = true,
  logger = console,
}) {
  return new AutoCatalogProvider({
    repository,
    logger,

    buildCatalog: async () => {
      const [
        { createBrowserSession },
        { CatalogService },
      ] = await Promise.all([
        import('../infrastructure/browser.js'),
        import('./catalogService.js'),
      ]);

      const session = await createBrowserSession({ headless });

      try {
        const service = new CatalogService({
          context: session.context,
          repository,
          logger,
        });

        return await service.crawl({
          seedUrls,
          concurrency,
          delayMs,
        });
      } finally {
        await session.close();
      }
    },
  });
}
