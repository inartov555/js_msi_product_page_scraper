## Version #2 in progress...

## MSI Product Page Scraper

Small scraper for the MSI US Store product page. It uses **Node.js + JavaScript + Playwright**, runs Chromium in headless mode, normalizes the requested fields, and writes the result to `output/product.json`.

## Requirements

- Docker

Run next commands from below in the project root folder before running tests

```bash
npm install
npx playwright install chromium
```

## Run

### Default

```bash
docker build -t my-scraper; docker run --rm scraper
```

After the command finishes, `output/product.json` is created or overwritten.

## Output

A sample `output/product.json` is included in the repository as requested. Live values such as price, availability, images, and product data may change when the scraper is run again.
