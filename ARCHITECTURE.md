# Architecture

## Goal

Turn the one-page MSI scraper into an ingestion/search system:

```text
MSI category pages
      |
      v
Product discovery -----> product URLs
      |                       |
      |                       v
      |                 detail extractor
      |                       |
      |                       v
      +----------------> normalized Product
                              |
                              v
                       CatalogRepository
                              |
                +-------------+-------------+
                |                           |
                v                           v
           SearchService               CompareService
                |                           |
                +-------------+-------------+
                              |
                         CLI / HTTP API
```

## Boundaries

- `src/adapters/msi/`: website-specific selectors, pagination discovery, and DOM extraction.
- `src/domain/`: normalized product model helpers and specification identity rules.
- `src/application/`: use cases. No Playwright selectors here.
- `src/infrastructure/`: browser/session and persistence implementations.
- `src/cli.js`, `src/server.js`: delivery layers only.

This separation matters because a website redesign should mostly affect `adapters/msi`, while changing JSON persistence to SQLite/PostgreSQL or replacing the CLI with a UI should not require rewriting the scraper.

## Ingestion strategy

1. Start from top-level catalog pages.
2. Request listings with `limit=60` and advance `page=N` until a page produces no new products.
3. Deduplicate canonical product URLs across categories.
4. Scrape detail pages through a bounded worker pool.
5. Extract product data from the verified MSI DOM selectors.
6. Normalize specs into name/value pairs and replace the full catalog snapshot after a successful crawl.

The crawler defaults are concurrency 10 and a 100 ms minimum delay between detail-page starts, enforced by a shared rate gate. Tune these only after observing the site's behavior and applicable crawling rules.

## Search

Search is local over the latest catalog snapshot. A query must match all query tokens; title hits score highest, then category, then other product/spec text. Optional filters include category, effective price, availability, and arbitrary specifications.

Specification filters use normalized keys, so differences such as capitalization, punctuation, `MEMORY (RAM)` vs `memory ram`, or `Manufacturer Number` vs `manufacturer number` do not require exact spelling.

## Comparison

Comparison resolves products by product ID, MPN, full/partial title, or URL. It then builds a union of normalized specification keys and produces a matrix. Equal rows are hidden by default so differences are immediately visible; `--all` includes common parameters.

## Persistence

`JsonCatalogRepository` is deliberately behind a repository boundary. JSON is convenient for a small/medium MSI catalog and easy to inspect or version. For higher volume, concurrent writers, faceted analytics, or many API users, implement the same repository contract with SQLite/PostgreSQL and optionally put Elasticsearch/OpenSearch/Meilisearch behind the search service.

## Failure behavior

- Page loads use bounded retries with backoff.
- Access-denied/HTTP-error pages fail explicitly rather than being indexed as products.
- A failed product prevents the full catalog snapshot from being overwritten, preserving the previous complete catalog.
- Catalog writes are atomic (`.tmp` then rename).
- Incomplete extracted products produce warnings.

## Next production steps

For a long-running service, add a job queue, per-URL freshness metadata, incremental refresh rules, structured metrics, persistent crawl errors, robots-policy enforcement, and integration tests against stored HTML fixtures. The current boundaries are already arranged so those features can be added without coupling them to extraction logic.
