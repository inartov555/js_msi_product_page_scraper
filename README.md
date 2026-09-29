# MSI Catalog Scraper

JavaScript + Node.js + Playwright scraper for the MSI US Store. It supports single-product scraping, full catalog crawling, local search, and product comparison.

## Requirements

- Docker

## Commands

Start with Docker

```bash
./run_sraper.sh crawl -- --refresh false
./run_sraper.sh scrape -- https://us-store.msi.com/PC-Components/MAG-A650BN
./run_sraper.sh compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
./run_sraper.sh search "A520M-A PRO"
./run_sraper.sh serve
./run_sraper.sh test
```

Comparison tables are saved to `output/comparison.csv` by default. Use `--output <file>` to override the path.

## Catalog

The full catalog is stored in:

```text
output/catalog.json
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
