# MSI Catalog Scraper

JavaScript + Node.js + Playwright scraper for the MSI US Store. It supports single-product scraping, full catalog crawling, local search, and product comparison.

## Requirements

- Docker

## Commands

Start with Docker

```bash
./run_scraper.sh crawl --refresh false
./run_scraper.sh scrape https://us-store.msi.com/Desktops/Vision-ZS-9NVV-2080US  # collect data of a product
./run_scraper.sh compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
./run_scraper.sh search "Motherboards"
./run_scraper.sh serve      # scraper service with APIs
./run_scraper.sh test:unit  # only unit tests
./run_scraper.sh test:e2e   # only end-to-end tests
./run_scraper.sh test:all   # all available tests
```

## Changes: main (currently the same as V2.1)

- **Separate unit and E2E test suites**  
  Tests are now organized into dedicated `test/unit_tests/` and `test/end2end/` suites and can be run independently with `test:unit`, `test:e2e`, or together with `test:all`.

- **Reliable CI test execution**  
  GitHub Actions now runs the complete unit and end-to-end test suite through `npm run test:all`.

- **Automatic environment initialization**  
  `run_scraper.sh` creates `.env` from `.env.example` or `env.example` when no local environment file exists.

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

The `serve` command starts the Dockerized API. The end-to-end serve test checks `/health`, `/products`, `/compare`, validation errors, unknown products, and unknown routes. Docker Compose is required.
The API exposes the `/health`, `/products`, and `/compare` endpoints from `src/server.js`.

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
