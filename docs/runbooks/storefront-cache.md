# Storefront cache and speed checks

Phase 17 · [implementation plan](../roadmap/phase-17-implementation.md)

## Local setup

The speed profile adds Varnish without changing the usual development ports. Build the applications first, start the core/worker/storefront as usual, then run `docker compose --profile speed up -d varnish`. The public cache is at `http://localhost:6081`; its control port is bound to host loopback at `127.0.0.1:6082`. The image builds matching Varnish and xkey packages from Debian stable. `STOREFRONT_PORT` changes the backend port; `VARNISH_PORT` and `VARNISH_PURGE_PORT` change the published ports.

Set a real `CACHE_PURGE_SECRET` with `openssl rand -hex 32`, and give the same value to the Varnish container and core. The compose fallback of 64 zeroes is a development fixture only. Configure the core:

```dotenv
CACHE_STORE_ID=store1
CACHE_PURGE_URL=http://127.0.0.1:6082/
CACHE_WARM_URL=http://127.0.0.1:6081
STOREFRONT_URL=http://localhost:6081
```

On the storefront, set `SITE_URL=http://localhost:6081`, `CACHE_STORE_ID=store1`, and the same cache Redis connection and `REDIS_KEY_PREFIX` as the core. Keep server/worker secrets consistent. The namespace must be unique per store. Redis is necessary for coordinating multiple storefront processes; without it, their local caches merely expire, and the full freshness guarantee does not apply.

`npm run test:speed` owns a disposable database, core, worker, storefront and Varnish container on free local ports, runs the cache tests and performance assertions, then removes those resources. Standard PostgreSQL and Redis services must already be running. Build first and install Playwright Chromium (`npx playwright install chromium`). Use `SPEED_ALL_BROWSERS=1 npm run test:speed` to run the entire existing desktop/phone browser suite through Varnish too. The harness refuses staging/production environments. Reports and logs are in ignored `.performance/` and `.lighthouseci/` directories; CI uploads the speed report.

## Cache policy

- Anonymous public HTML has a seven-day shared TTL, 24 hours of grace and one hour of revalidation retention. Anonymous 404s have a 60-second TTL. Browsers revalidate full pages, so a shared-cache purge is effective on reload. Explicit short-lived fragments and immutable versioned styles retain their browser policy. Private requests and errors are never cached.
- Host and functional query parameters identify an object. Tracking parameters are omitted from the cache key, while the original query still reaches the origin so canonical redirects can retain each visitor's attribution. Tracked redirects bypass shared redirect objects and carry `no-store`. Canonical Unicode/encoded URL variants redirect to the common destination; redirect spellings do not replace its 200 object.
- Cart, checkout, account, tracking, APIs, previews and sales-page order/thank-you routes bypass Varnish. Authorization and any session/admin/auth/CSRF cookie also bypass it. Other cookies are stripped on public routes, and cacheable responses cannot set cookies. Public HTML contains no shopper identity or server-rendered cart state.
- Every public object has a store tag plus bounded type/dependency tags. Entity IDs supplement broad catalog/layout dependencies. Headers are capped at 100 tags and 6,000 characters; oversized invalidation batches fall back to the store tag.
- Product, variant, collection, facet, asset and relevant global-setting events write an outbox in their mutation transaction. Custom page, menu, settings, theme and publish events do the same. The two-second window coalesces committed changes. Workers clear Redis/LRU data first, then invalidate Varnish; failed deliveries remain in the outbox and retry. Stock changes invalidate only when availability crosses zero (an unknown initial stock state refreshes conservatively once). Migration records suppress individual purges and enqueue a full refresh when finalization commits.
- Promotion start/end boundaries are stored durably. A fine-grained worker sweep and a Vendure scheduled-task fallback process due boundaries. Startup rebuilds future boundaries for existing promotions and refreshes the store after downtime/deployment.
- Normal invalidation is soft: a request may receive the previous page while the fresh version renders in the background. With the origin down, grace deliberately serves old public pages for up to 24 hours; checkout still goes to the core and validates current prices/stock. Warm-up after full invalidation and Varnish restart requests home, up to ten categories and fifty recent enabled products, in the store's default language. It uses a separate queue, so warming cannot delay invalidation.

## Operations and production handover

Public PURGE requests are rejected even through a Docker port-forward. The separate control listener requires localhost plus the shared secret. The Docker relay allows a host-loopback connection to reach that localhost listener; the public listener cannot invoke it. Never publish the control port to the internet. In production, only the local core should reach it.

Normal full invalidation:

```sh
curl -X PURGE http://127.0.0.1:6082/ \
  -H "X-Purge-Token: $CACHE_PURGE_SECRET" -H 'X-Purge-Tags: store1:store'
```

For a deliberate maintenance/suspension change or removal that must not use grace, add `-H 'X-Purge-Mode: hard'`. This removes old objects completely; an unavailable origin then returns 503 rather than stale content. Phase 23/24 deployment and store-state transitions must call this form when appropriate. An ordinary infrastructure outage uses soft invalidation/grace.

The VCL ignores forwarded host/protocol and rewrite headers. It accepts a real client IP only from the explicit loopback `trusted_proxy` ACL and otherwise replaces it with the direct client address. Phase 23 must keep the listener private behind Nginx and configure any different trusted proxy address explicitly. Production Nginx also routes `/cache-metrics` to core, enforces the small body limit, serves immutable assets directly and adds TLS/Brotli. Multi-store backend provisioning remains Phase 23/24; do not deploy the single-backend local profile as a shared multi-store router.

## Measurement

`web-vitals` samples 10% of visits by default (`VITALS_SAMPLE_RATE`; zero disables it). The beacon sends just an ephemeral metric ID, `LCP`/`INP`/`CLS`, a bounded number and a route category. It sends no exact URL, query, referrer, customer identifier, cookie, IP or user agent. Only same-origin requests are accepted, with a 2 KB limit, a per-process request cap and a per-store daily sample cap. IDs deduplicate updates; samples expire after 31 days. `cacheDailyVitals` requires `ReadSettings` and returns daily per-channel/route p75 over the last month for Phase 41.

CI checks every client JavaScript bundle with size-limit, and the existing browser tests enforce aggregate product/sales-page gzip budgets. Lighthouse runs three cold mobile simulations on product and sales pages: median LCP ≤1.5 seconds, CLS <0.1 and TBT <200 ms as the lab INP proxy, plus performance score ≥95. An intentionally oversized fixture and an impossible LCP assertion must both fail, proving the gates are active. Real-user INP and p75 are measured by the beacon; lab scores do not establish Bangladesh ISP latency or production field results.
