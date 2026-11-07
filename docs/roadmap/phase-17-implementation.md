# Phase 17 implementation notes

2026-10-22, revised 2026-10-23 after review · SolCodex · `solcodex` worktree, main merged through Phase 16

How the speed layer was built, and why. The [cache runbook](../runbooks/storefront-cache.md) says how it behaves and how to run it; the [test results](../runbooks/phase-17-test-results.md) say what was measured.

## Decisions

1. **Fresh pages by purging, not by a stock-checking script.** Product pages stay without JavaScript of their own. Varnish keeps public pages for 7 days, keeps the last copy for 24 hours if the storefront is down, and keeps 404s for 60 seconds. The core purges what changed.
2. **One VCL, locally and in production.** Varnish and its xkey module come from the same Debian release, so they always match. Shoppers and purges use separate ports. The Host is part of the cache key. Only the query parameters a page reads are part of it.
3. **A purge outbox in the core** (plugin `cache-purge`). A change writes a row in its own transaction. The worker delivers due rows: the storefront's data cache in Redis first, then Varnish.
4. **Precise tags.** A product change refreshes that product's pages and the listings, not content pages. Settings, theme and menus refresh everything, because every page shows them.
5. **Budgets in CI.** size-limit for every built script, Lighthouse on a throttled phone for a product page and a sales page. A deliberately broken budget must fail, so we know the checks work. Lab results are not field results.
6. **A sampled speed beacon** (web-vitals) for real-user p75. It is a deliberate exception to "no JavaScript on pages with nothing to interact with" ([decisions.md](../decisions.md), 2026-10-23): a 368-byte loader on every page, web-vitals only for sampled visits.

## What the review changed (2026-10-23)

The first version worked in the happy path but had gaps. Each is fixed and tested:

- **Stale listings after a purge.** Listings read Vendure's search index, which the worker updates after the change, through bd-search's 3-second cache. Listings now get a second purge once the index is idle and that cache has expired (`CACHE_LISTING_SETTLE_MS`). Category membership, product channels and tax rates now purge too, and so does a change to "only a few left".
- **Imports.** Per-record purges pause while an import runs, including the jobs it starts. The import's end (after its reindex) brings one purge-all and a warm-up. A dead import still gets a purge-all 5 minutes after its last change.
- **Purges were too broad and repeated.** Every page used to carry the catalog tags, so any edit purged the whole store. Tags are now per product, category, page and kind of page. Every process used to run the delivery loop and add jobs without limit; now only the worker delivers, directly, with a per-store lock. Boot no longer purges or warms: boundaries passed while down are delivered, and warm-up runs only after a real Varnish restart or a purge-all. The promotion code is shared.
- **Warm-up filled the wrong entries.** It requested an internal address, so the Host (part of the key) differed from shoppers'. It now goes through `STOREFRONT_URL`. "Top" pages are now the header menu (or the top categories) and bd-search's best sellers, not the newest 50.
- **The beacon.** Off now means no script at all; on means a small loader that loads web-vitals only for sampled visits. The endpoint has per-address and per-store limits, a strict 512-byte payload, one statement per sample (no lock), and Dhaka days for reports and clean-up.
- **Varnish.** A bilingual 503 page instead of a blank one. The health probe no longer depends on the core. A 429 during a refresh keeps the old copy. The purge port checks the caller's address (no relay making everyone look local) and Varnish refuses an empty or all-zero secret. Unknown query parameters no longer create cache entries. The unused redirect rules are gone (redirects are never kept). Varnish's start ID is only on the purge port.
- **Tests that claimed more than they checked.** The crawl is now over 125 distinct pages. Private routes are fetched twice. Warm-up is checked page by page with the shopper's Host. New tests cover content pages staying cached, restarts, promotion boundaries and a stock change through a real order.

## Where things are

- `infra/varnish/`: the VCL (`default.vcl`), its start script (`entrypoint.sh`), the image.
- `apps/core/src/plugins/cache-purge/`: the outbox and delivery (`cache-purge.service.ts`), tag names (`tags.ts`), the beacon endpoint (`vitals.ts`).
- `apps/storefront/src/lib/cache-policy.ts`: private requests and page tags. Pages add their own tags in their frontmatter (`setCacheTags`).
- `apps/storefront/src/components/Vitals.astro`, `src/scripts/vitals.ts`: the beacon.
- `scripts/speed-check.mjs`, `tests/speed/`, `.size-limit.cjs`, `.lighthouserc.cjs`: the speed suite.

## Not in this phase

Production install, Nginx, trusted proxy addresses, TLS and Brotli, per-store backends and the store-state switches (maintenance, suspension) are phases 23–24. Bangladesh ISP latency and real-user p75 need production traffic; the reports are phase 41.

## References

- [Varnish grace](https://varnish-cache.org/docs/7.7/users-guide/vcl-grace.html), [purging](https://varnish-cache.org/docs/7.7/users-guide/purging.html) and [xkey](https://github.com/varnish/varnish-modules/blob/master/src/vmod_xkey.vcc).
- [Vendure events and transactions](https://docs.vendure.io/current/core/developer-guide/events).
- [Lighthouse CI assertions](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md) and [web-vitals](https://github.com/GoogleChrome/web-vitals).
