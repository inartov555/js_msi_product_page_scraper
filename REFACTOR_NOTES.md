# Refactor solution

This version applies the highest-value changes found during review while preserving the existing public behavior.

## Implemented

### Discovery scheduler simplified
`src/scraper/discovery.js` now uses:
- one sequential pagination loop per seed/category;
- one small shared semaphore for the global request limit;
- retry logic local to the listing request;
- a shared pause timestamp for 403/429 throttling.

The former event scheduler (`events`, `Promise.race`, active/done scheduling state, retry/cooldown/resume events, rotating cursor) was removed.

### Browser profiles simplified
`src/config.js` now contains three coherent desktop profiles instead of a very large mixed desktop/mobile user-agent list. The fixed desktop viewport is no longer paired with Android/mobile identities. Browser-profile selection is stateless and deterministic when a random source is supplied.

### Header tests corrected
`test/browser-context-headers.test.js` now tests the actual behavior:
- desktop context shape is preserved;
- the supplied random source deterministically selects a different profile.

The old test passed because hidden sequential module state advanced between calls; it did not actually test randomness.

### Test commands separated
- `npm test` / `npm run test:unit` run deterministic tests only.
- `npm run test:e2e` runs the live application/network suite.
- `npm run test:all` runs both.

The E2E file was renamed so the normal `*.test.js` pattern does not load it.

### Retry policy tightened
Unknown product-scraping errors are no longer assumed retryable. Known timeout/network/server failures are retried, but programming errors fail immediately rather than being hidden behind repeated attempts.

### Dead CLI documentation removed
The help entry for `--json` was removed because no implementation existed for it.

## Verification

`npm test` passes all 22 deterministic tests with 0 skipped tests.

## Recommended next step

The most important remaining improvement is fixture-based testing for `src/scraper/extractor.js`. Save representative MSI product HTML pages (normal price, sale price, out of stock, missing reviews, etc.) and assert the full normalized product object. The current live E2E test is primarily a smoke test and does not verify most extraction fields.
