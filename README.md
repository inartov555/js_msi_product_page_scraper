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
npm run compare -- "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
npm test
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

The application defaults to crawl concurrency `20` and a `100 ms` minimum delay between detail-page starts. Environment variables or CLI flags can override these values; the supplied Docker environment example uses concurrency `10`.

## Docker

The existing Docker setup accepts one command string through `SCRAPER_COMMAND`:

```bash
SCRAPER_COMMAND="crawl -- --refresh false" docker compose up --build
```

The project wrapper keeps the same one-string interface:

```bash
./run_sraper.sh "scrape"
./run_sraper.sh "crawl -- --refresh false"
./run_sraper.sh "search -- 'A520M-A PRO'"
./run_sraper.sh "compare -- 'MAG Z890 TOMAHAWK WIFI' 'PRO Z890-P WIFI'"
./run_sraper.sh "test"
```

The `output` directory is mounted into the container so the catalog persists between runs.

## Optional HTTP API

```bash
npm run serve
```

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
│   ├── locator.js
│   └── selectors.js
└── shared/
    ├── consoleLogger.js
    └── text.js
```

See `ARCHITECTURE.md` for module responsibilities.
