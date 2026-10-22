# Phase 17 test results

2026-10-23 · SolCodex · isolated `solcodex` worktree, main merged through Phase 16

## Scope and environment

Built the plan in [phase-17-implementation.md](../roadmap/phase-17-implementation.md): actual Varnish 7.7.0 and matching xkey, Vendure/core worker, production Astro build, PostgreSQL 17 and separate Redis queue/cache instances. The speed harness uses its own database, Redis prefix, random local ports and container; it removes its database, container and processes afterward. Fixtures are synthetic. Chromium runs desktop and Pixel 7 projects; performance uses simulated mobile 4G (150 ms RTT, 1,638.4 Kbps, 4× CPU slowdown).

## Results

| Check | Result |
|---|---|
| Workspace unit tests | 854 passed across admin, core, storefront and shared packages |
| Backend integration suite | 253 passed across 22 files, using four workers |
| Real-Varnish cache browser suite | 9 passed |
| Full desktop/phone browser regression through Varnish | 161 passed, 63 device-specific/conditional skips; no failures |
| Product and category freshness | Both show the edit within 2,628 ms (3,000 ms budget) |
| Warmed 50-request public crawl | 100% cache hits (>90% required) |
| Production bundle checks | Every client bundle passed size-limit; aggregate product/sales budgets passed in browser tests |
| Lighthouse | All six runs passed assertions; details below |
| Deliberate negative gates | Oversized fixture and impossible LCP assertion both failed for the expected reason |
| Restart warm-up | Restarted the real Varnish container; worker populated public objects without visitor requests |
| Outage grace | Stopped the actual storefront process; cached product stayed 200/HIT after soft purge |
| Hard invalidation | Authenticated hard purge removed the stale object; unavailable origin returned 503 |
| Static checks/build | Lint, workspace typecheck and all production builds passed |

The full browser run covers carts/checkout with and without JavaScript, sales-page ordering, attribution, search, the page editor, English/Bangla, and the existing WooCommerce migration/cutover screens through Varnish. Skips are declared project/conditional branches in the existing suite, rather than failures treated as passes.

## Lighthouse evidence

Three cold simulated-mobile measurements per URL, using Lighthouse 12.6.1 through LHCI 0.15.1. The fixture includes a catalog with product images and a sales page with its order form. Measurements below are from the full browser/performance run, completed at `2026-10-22T18:38:59Z` (2026-10-23 in Dhaka).

| Page | LCP runs (ms) | Median LCP | Performance | CLS | TBT |
|---|---|---|---|---|---|
| Product | 1,225.7 / 1,221.8 / 1,369.5 | 1,225.7 ms | 100/100 | 0 | 0 ms |
| Sales page with order form | 1,218.6 / 1,369.1 / 1,366.4 | 1,366.4 ms | 100/100 | 0 | 0 ms |

Budgets: median LCP ≤1,500 ms, performance ≥95, CLS <0.1, TBT <200 ms as the lab INP proxy; product JavaScript ≤30 KB gzip, sales/checkout ≤45 KB. Initial testing found that uncompressed CSS missed LCP; enabling text compression fixed the transfer bottleneck. Raw Lighthouse JSON/HTML reports and application logs are generated in `.performance/`; CI uploads this directory for seven days.

## Correctness and privacy checks

- Transaction rollback leaves no purge; committed events batch/deduplicate; refused deliveries retain the outbox for retry. Native catalog, content publish, menus/settings/theme and bulk import completion are wired into the outbox. Core integration tests check stock crossing zero, promotion boundary replacement/backfill and bulk suppression.
- Redis/LRU invalidation reaches multiple storefront processes. A generation check rejects cache refill by an older in-flight load; pending loads are detached after invalidation.
- Two independent no-JavaScript browser contexts keep distinct cart quantities and private checkout responses. Authorization, session/admin markers, preview, account/tracking and sales-page order routes bypass shared storage. Public responses do not set session cookies.
- Host/language and functional-query isolation, forwarding-header poisoning, encoded URL redirects, tracking-key normalization and per-visitor redirect attribution are checked. Public PURGE is refused; the separate control listener requires localhost and its secret. HEAD and conditional requests work.
- Metrics reject unexpected fields and invalid values, deduplicate updates, enforce same origin and permissions, calculate known daily p75 correctly, and delete expired samples. No URL, query, customer/session identifier, referrer, IP or user agent is stored in the metric entity.

## Reproduction and limits

Follow [storefront-cache.md](storefront-cache.md) for environment configuration. After installing dependencies and starting PostgreSQL/Redis:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e -w @ecommbd/core -- --maxWorkers=4
npm run build
npx playwright install chromium
SPEED_ALL_BROWSERS=1 npm run test:speed
```

Backend tests and the browser harness should run separately on a small local database. An overlapping run exhausted PostgreSQL's connection cap; the isolated rerun passed all 253 tests using four workers. Earlier full integration testing passed 252 tests before the promotion-backfill test was added.

This is local integration/lab evidence. It does not establish Bangladesh ISP TTFB, production p75 LCP/INP, real traffic hit ratios, store capacity or production Nginx routing. Deployment installs, trusted proxy addresses, TLS/Brotli, per-store backends and maintenance/suspension wiring remain Phases 23–29. Real-user samples need production traffic; the reporting API is ready for Phase 41. GitHub CI is wired but was not run remotely in this task. No deployment, push or PR was performed.
