# Architecture

The project is a small modular monolith.

```text
CLI --------------------+
                        |
HTTP API --> repository |--> search / compare
                        |
                        v
                   catalog.js
                        |
              +---------+---------+
              |                   |
          repository          scraper/
                                  |
                       browser / discovery /
                       extractor / locators
```

## Modules

- `src/cli.js` — command parsing, output formatting, and command dispatch.
- `src/catalog.js` — catalog lifecycle and scraping orchestration: load/build catalog, scrape one product, and resolve missing comparison products.
- `src/repository.js` — JSON catalog persistence.
- `src/search.js` — pure product search/filtering.
- `src/compare.js` — product resolution and comparison rows.
- `src/product.js` — product normalization and validation helpers.
- `src/scraper/` — MSI/Playwright-specific browser, discovery, extraction, product URL building, and centralized locator code.
- `src/shared/consoleLogger.js` — process-wide timestamped console logging.
- `src/server.js` — optional read-only HTTP API over the saved catalog.

The scraper-specific code is isolated from search/comparison logic so MSI page changes do not leak into the rest of the application.
