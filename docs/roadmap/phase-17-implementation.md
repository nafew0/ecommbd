# Phase 17 implementation plan

2026-10-22 · SolCodex · based on main through Phase 16, retaining Phases 21–22

## Decisions before coding

1. Keep stock/price freshness driven by invalidation, without a product-page polling script. Varnish caches anonymous public pages for seven days, keeps 24 hours of grace and caches anonymous 404s for 60 seconds. Public objects carry a validated store namespace and bounded dependency tags. Private/session/authorization requests, previews and sales-page order/thank-you routes always pass through.
2. Run the same VCL locally and in deployment. Build Varnish and xkey from matching Debian stable packages. Public traffic and the localhost-only invalidation listener are separate: public PURGE requests fail even when a development port forwards through Docker. Host stays in the cache key; untrusted forwarding headers cannot change rendered content. Sort query parameters and remove tracking parameters, while preserving functional filters and language paths.
3. Add a `cache-purge` Vendure plugin. Mutation events write an invalidation outbox in the transaction. A two-second window batches tags; the job queue delivers retries, clearing the storefront Redis/LRU data caches before Varnish. Explicit content/settings events cover custom plugins. Stock availability is remembered so ordinary sales do not invalidate the entire catalog; crossing in/out of stock does. Promotion boundaries are durable future invalidations. Bulk migration records suppress individual purges, then enqueue one full refresh.
4. Prefer correctness with broad page-type dependencies for catalog/listing changes; retain entity tags for targeted pages. Theme switches and bulk changes refresh the store. Purge-all queues a bounded warm-up of home, categories and up to 50 products. A restart/health recovery also triggers a bounded warm-up. Failed warm-up must not prevent shoppers ordering or lose the invalidation.
5. Add enforced production-build budgets: size-limit for client bundles and Lighthouse CI on representative product and sales/checkout pages. Product JS stays within 30 KB gzip, sales/checkout within 45 KB, throttled-mobile LCP within 1.5 seconds, CLS below 0.1, with a 200 ms blocking-time proxy for INP. Tests deliberately exceed a budget to prove the gate fails. Lab measurements do not establish Bangladesh ISP latency or real-user p75.
6. Use sampled `web-vitals` beacons for LCP, INP and CLS. Send only bounded numeric metrics, an ephemeral deduplication ID and a route category; no customer/session identity, exact URL, query, referrer or device/IP fields are stored. Bound and rate-limit ingestion, keep a short retention window, and expose per-store daily p75 through a permission-protected API for Phase 41.

## Implementation order

- Merge current main and resolve generated schema plus middleware while retaining both feature sets.
- Add the Varnish image/VCL and compose configuration, then storefront cache policy/tags.
- Add durable invalidation, stock boundary tracking, promotion scheduling and warm-up; wire existing content/settings/import changes into it.
- Add sampled metrics and performance budget tooling/CI.
- Generate additive migrations, run focused tests with actual Varnish, then commerce/browser regressions and production builds. Record actual evidence and any external acceptance limits.

## Verification

- Varnish: MISS/HIT, tag purge refreshes product/category, tracking queries share objects, functional queries stay separate, host/language isolation, cookie/authorization/preview/private-path bypass, no Set-Cookie on cached responses, public purge rejected, HEAD/conditional requests, healthy refresh and outage grace, bounded tags and crawl hit ratio above 90%.
- Core: transactional outbox/rollback, batching/deduplication/retries, publish/settings/menu/theme/catalog events, stock crossing only, promotion boundaries, bulk import coalescing and warm-up bounds. Metrics validation, deduplication, privacy, permissions, retention and p75.
- Browser: two independent shopper sessions through Varnish; cart, checkout, tracking, sales-page order and preview cannot leak across sessions; English/Bangla page freshness after editing. Run existing relevant browser suites too.
- Performance: collect actual Lighthouse reports against built applications, enforce bundle budgets, and run an intentional failing fixture to prove CI assertions fail.

## Primary references

- [Varnish grace](https://varnish-cache.org/docs/7.7/users-guide/vcl-grace.html), [purging](https://varnish-cache.org/docs/7.7/users-guide/purging.html) and [xkey API](https://github.com/varnish/varnish-modules/blob/master/src/vmod_xkey.vcc).
- [Matching Debian Varnish modules](https://packages.debian.org/trixie/varnish-modules).
- [Vendure event transactions](https://docs.vendure.io/current/core/developer-guide/events).
- [Lighthouse CI assertions](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md) and [web-vitals measurement](https://github.com/GoogleChrome/web-vitals).

Production installation, per-store backend provisioning and Bangladesh ISP measurements remain Phases 23–29. This phase supplies the tested configuration and application behavior.

## Implementation handover · 2026-10-23

Implemented in `infra/varnish`, the `cache-purge` core plugin and storefront cache policy. The generated additive migration creates the outbox, stock-availability state and bounded anonymous vital samples. Existing content resolvers now publish inside transactions; WooCommerce finalization commits its full refresh with the migration result. Promotion boundaries are rebuilt on startup for existing stores. Concurrent initial stock events use an atomic state upsert.

The bounded warm-up selects fifty recent enabled products and up to ten public categories in the default language; sales-weighted ranking can replace that selection after production traffic exists. Varnish exposes a per-boot instance marker so the worker can detect a restart without waiting for a visitor. Maintenance uses authenticated hard purge; ordinary changes use soft purge and outage grace.

Actual Lighthouse testing exposed uncompressed stylesheet transfer as an LCP bottleneck. Text compression in Varnish brought both representative pages under budget. Search suggestion fragments keep their explicit one-minute browser policy; page HTML revalidates. Tracking parameters share public 200 objects, while tracked redirects preserve each visitor's parameters and bypass shared redirect objects.

See the [test report](../runbooks/phase-17-test-results.md) and [cache runbook](../runbooks/storefront-cache.md). Generated reports stay in ignored `.performance/` locally and are uploaded by CI. The workflow is configured; no remote CI run or production field claim is asserted here.
