# Phase 17 test results

2026-10-23 · SolCodex · `solcodex` worktree, main merged through Phase 16 · after the review fixes

What was run, what it showed, and what it doesn't show. How the cache works is in the [cache runbook](storefront-cache.md).

## Setup

- Real Varnish 7.7.0 with xkey (the `infra/varnish` image), the built storefront, the core and its worker, PostgreSQL 17, and separate queue and cache Redis instances, all on one Mac (Docker Desktop).
- The speed suite makes its own database, Redis prefix, purge secret, free ports and container, and removes them afterwards. Fixtures are synthetic: 53 products, nested categories, an "About us" page, menus and a sales page.
- Lighthouse runs on a simulated phone: 150 ms round trip, 1.6 Mbps, CPU four times slower.

## Results

| Check | Result |
|---|---|
| Core unit tests for the cache (`cache-tags`, `cache-vitals`, `env-schema`) | 10 passed |
| Core end-to-end, `cache-purge.e2e-spec.ts` | 16 passed |
| Core end-to-end, the bd-sections layout purge test | passed (purges still reach the data cache in a single-process server) |
| Storefront unit tests | 67 passed (9 files) |
| Typecheck and lint | core `tsc` and `astro check` clean; ESLint clean on the changed files |
| Speed suite, real Varnish (`npm run test:speed`) | all 10 cache tests passed; every later step passed |
| A product edit on cached pages | product and category showed the new name after 2.4 s (budget 3 s) |
| Content page after that edit | the same cached object before and after (not purged, not even softly) |
| Stock through a real order | 3 in stock, one ordered: the product page showed "Only a few left" within 5 s |
| Crawl | 125 distinct pages (106 product pages, 6 categories, content pages, home in both languages, a sales page). First pass: 4 already cached. Second pass: 125 hits (100%) |
| Private routes | cart, checkout, account, `account/x.css`, tracking, a sales page's order and thank-you pages, a preview and search results: each fetched twice, both times passed through and `no-store`. Same for a session cookie and an `Authorization` header |
| Two shoppers | each saw only their own cart quantity, checkout summary and account page; every response passed through and `no-store` |
| Query parameters | tracking and unknown parameters reused the same cached object; `sort` values stayed separate; parameter order didn't matter |
| Purge port | refused on the public port, refused without the secret; only the purge port shows Varnish's start ID |
| Core and worker restart | the cached product page was the same object afterwards: no purge |
| Varnish restart | the worker warmed 53 pages (home, 2 menu links, 50 best sellers); each was a HIT for a shopper's own request |
| Outage grace | storefront stopped, soft purge: the cached page was still served (200, HIT) |
| Hard purge | with the storefront stopped: 503 with Varnish's Bangla and English page |
| Speed beacon | a sampled visit loaded web-vitals; leaving the page sent beacons; the core stored them (daily count for product pages went up) |
| Beacon endpoint (end-to-end) | wrong Origin 403, extra field 400, over 512 bytes 413, the 61st request in a minute from one address 429; samples per Dhaka day; IDs stored hashed; 31 days kept |
| JavaScript budgets (size-limit) | every built script passed. The beacon's loader 368 B gzipped (limit 600 B); web-vitals 3.06 kB (limit 3.5 kB, sampled visits only) |
| Broken budgets | a 32 KB random script and an impossible LCP budget both failed, for the right reason |

The Varnish rules were also checked by hand against a stand-in storefront: the error page, a 429 during a refresh keeping the old copy, the query rules, the redirect keeping tracking, and another container being refused on the purge port even with the right secret. The `docker compose` service was checked on its own network from the host on Docker Desktop for Mac.

## Lighthouse

Three runs per page, Lighthouse 12.6.1 through LHCI 0.15.1, from the final run.

| Page | LCP, each run (ms) | Median LCP | Performance | CLS | Blocking time |
|---|---|---|---|---|---|
| Product | 1,371 / 1,234 / 1,217 | 1,234 ms | 100 | 0 | 0 ms |
| Sales page with its order form | 1,367 / 1,364 / 1,360 | 1,364 ms | 100 | 0 | 0 ms |

Budgets: median LCP at most 1.5 s, performance at least 95, CLS under 0.1, blocking time under 200 ms (the lab stand-in for INP). Reports and logs are in `.performance/`.

## How to repeat

```sh
npm run services:up
npm run build
npx playwright install chromium
npm run test:speed
cd apps/core && npx vitest run -c vitest.e2e.config.mts test/e2e/cache-purge.e2e-spec.ts
npm test -w @ecommbd/storefront
```

This run used a separate build of the core (`SPEED_CORE_DIR`), because the shared `apps/core/dist` belongs to the whole worktree. That build also added the `cache_stock_state.level` column by hand, until the worktree's migrations are generated.

## What this doesn't show

- **Not measured:** Bangladesh ISP latency (the 150 ms TTFB target), real-user p75, hit ratios under real traffic, store capacity, and many shoppers at once.
- **Not run:** the CI step on GitHub, and `SPEED_ALL_BROWSERS=1` (the whole browser suite through Varnish).
- **Not built yet:** production Nginx routing, trusted proxies, TLS and Brotli (phases 23–29).
- **Local only:** the crawl's 100% is one quiet machine with no other traffic. Real traffic has more pages, purges and evictions.
- **Depends on production setup:** the beacon's per-address limit was tested from one address. In production it needs the shopper's real address from Nginx (Express's `trustProxy`); locally every beacon arrives through the storefront's proxy, from one address.
