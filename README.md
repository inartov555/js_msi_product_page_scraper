# MSI Product Page Scraper

Small production-style scraper for the MSI US Store product page from the test task. It uses **Node.js + JavaScript + Playwright**, runs Chromium in headless mode, normalizes the requested fields, and writes the result to `output/product.json`.

## Target page

`https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI`

The target URL is the default constant in `src/scrape.js`. An optional URL can also be passed as the first CLI argument for local debugging.

## Requirements

- Node.js 20+
- npm

## Run

```bash
npm install
npx playwright install chromium
npm run scrape
```

After the command finishes, `output/product.json` is created or overwritten.

Optional URL override:

```bash
npm run scrape -- "https://us-store.msi.com/..."
```

## Approach

The implementation is intentionally small to fit the task's 2–3 hour timebox.

- Playwright opens the live product page in headless Chromium.
- The scraper waits for product content instead of using a fixed sleep.
- Structured product data (`application/ld+json`) is used when available because it is generally more stable than presentation CSS classes.
- DOM fallbacks are used for title, breadcrumbs, images, price/availability, product ID, and technical specifications.
- Specification extraction prefers a real key/value table and falls back to definition lists or spec-like rows.
- Prices are normalized to JavaScript numbers.
- Missing scalar fields are normalized to `null`; missing list fields remain empty arrays.
- Output field names match the schema from the task exactly.
- Browser cleanup is handled in `finally` so Chromium is closed if extraction fails.

## Notes on selector stability

The scraper avoids absolute selectors such as `div:nth-child(...)`. It prefers semantic attributes, JSON-LD, breadcrumb containers, table rows, and common product/specification containers. This keeps the implementation readable while still providing fallbacks if a single selector changes.

## Output

A sample `output/product.json` is included in the repository as requested. Live values such as price, availability, images, and product data may change when the scraper is run again.
