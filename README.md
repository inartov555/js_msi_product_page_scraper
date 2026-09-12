# MSI Product Page Scraper

Small scraper for the MSI US Store product page. It uses **Node.js + JavaScript + Playwright**, runs Chromium in headless mode, normalizes the requested fields, and writes the result to `output/product.json`.

## Requirements

- Node.js 20+
- npm

Run next commands from below in the project root folder before running tests

```bash
npm install
npx playwright install chromium
```

## Run

Optional URL override:

```bash
targetUrl=`https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI`

# url = $targetUrl
# isHeadless = true/false/not set

npm run scrape $url $isHeadless

# E.g.
npm run scrape $targetUrl
```

After the command finishes, `output/product.json` is created or overwritten.

## Output

A sample `output/product.json` is included in the repository as requested. Live values such as price, availability, images, and product data may change when the scraper is run again.
