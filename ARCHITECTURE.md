# Architecture

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
