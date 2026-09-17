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

## Crawl

Use the saved catalog when available:

```bash
npm run crawl
```

Force a full refresh:

```bash
npm run crawl -- --refresh true
```

The default crawl settings are concurrency `10` and a `100 ms` minimum delay between detail-page starts. They can be overridden with CLI flags or environment variables.

## Docker

```bash
docker compose build; docker compose run --rm scraper npm run crawl
```

The `output` directory is mounted into the container so the catalog persists between runs.

## Optional HTTP API

The project still includes the optional catalog API:

```bash
npm run serve
```

It exposes the existing `/health`, `/products`, and `/compare` endpoints from `src/server.js`.
