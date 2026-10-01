# MSI Catalog Scraper

JavaScript + Node.js + Playwright scraper for the MSI US Store. It supports single-product scraping, full catalog crawling, local search, and product comparison.

## Requirements

- Docker

## Commands

Start with Docker

```bash
./run_sraper.sh crawl -- --refresh false
./run_sraper.sh scrape -- https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II
./run_sraper.sh compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
./run_sraper.sh search "A520M-A PRO"
./run_sraper.sh serve
./run_sraper.sh test
```

## Changes: V2 vs. V1

- **Full catalog crawling**
  V2 expands the scraper from a single MSI product page to full catalog discovery across laptops, desktops, monitors, graphics cards, motherboards, PC components, gaming gear, and EV chargers.

- **Concurrent catalog discovery**
  Independent MSI category pages can be discovered in parallel while pagination inside each category remains sequential.

- **Concurrent product scraping**
  Discovered product pages can be processed with configurable worker concurrency to speed up full catalog collection.

- **Product comparison**
  Multiple products can be resolved by title, ID, MPN, or URL and compared across pricing, availability, ratings, identifiers, categories, and technical specifications.

- **CSV search and comparison output**
  Search results can be written to `output/search.csv`, while product comparisons are saved to `output/comparison.csv`.

- **Dedicated single-product output**
  Single-product scraping now writes to `output/single-product.json` instead of using the original V1 product output file.

- **HTTP catalog API**
  V2 adds a read-only HTTP server with `/health`, `/products`, and `/compare` endpoints over the saved catalog.

- **Expanded CLI**
  The original single `scrape` command is expanded with dedicated `scrape`, `crawl`, `search`, `compare`, `serve`, and `test` commands.

- **Docker support**
  V2 adds a Playwright Docker image, Docker Compose configuration, environment configuration, and a helper script for running scraper commands inside containers.

- **Automated test suite**
  V2 adds Node.js tests covering search, comparison, product normalization, browser retries, discovery concurrency, and scraper locator centralization.

- **Structured runtime logging**
  V2 introduces shared timestamped console logging and clearer progress messages for catalog discovery and product scraping.

## Catalog

The full catalog is stored in:

```text
output/catalog.json
```

Comparison tables are saved to:

```text
output/comparison.csv
```

Search results are saved to:

```text
output/search.csv
```

A single scraped product is stored by default in:

```text
output/single-product.json
```

The `output` directory is mounted into the container so the catalog persists between runs.

It exposes the existing `/health`, `/products`, and `/compare` endpoints from `src/server.js`.

## Source layout

```text
src/
├── cli.js
├── catalog.js
├── compare.js
├── config.js
├── product.js
├── repository.js
├── search.js
├── server.js
├── scraper/
│   ├── browser.js
│   ├── discovery.js
│   ├── extractor.js
│   ├── locators.js
│   └── productUrl.js
└── shared/
    ├── consoleLogger.js
    └── text.js
```

See `ARCHITECTURE.md` for module responsibilities.
