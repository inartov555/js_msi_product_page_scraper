# MSI Catalog Scraper

Node.js + Playwright scraper for the MSI US Store. It supports single-product scraping, full catalog crawling, local search, and product comparison.

## Requirements

- Node.js 20+
- Docker (optional)

## Commands

```bash
npm run scrape
npm run crawl
npm run search -- "RTX 5090"
# Comparison tables are saved to `output/comparison.csv` by default.
# Use `--output <file>` to override the path.
npm run compare -- "PRODUCT_A" "PRODUCT_B"
npm test
```

## Catalog

The full catalog is stored in:

```text
output/catalog.json
```

A single scraped product is stored by default in:

```text
output/single-product.json
```

The default crawl settings are concurrency `10` and a `100 ms` minimum delay between detail-page starts. They can be overridden with CLI flags or environment variables.

## Docker

```bash
# command_to_run, e.g.:
#          "scrape"
#          "crawl -- --refresh false"
#          "search A520M-A PRO"
#          "compare -- MAG Z890 TOMAHAWK WIFI PRO Z890-P WIFI"
#          "serve" # if you need a scrapper service
#          "test"

SCRAPER_COMMAND="$command_to_run" docker compose up --build
```

The `output` directory is mounted into the container so the catalog persists between runs.

## Optional HTTP API

The project still includes the optional catalog API:

```bash
npm run serve
```

It exposes the existing `/health`, `/products`, and `/compare` endpoints from `src/server.js`.
