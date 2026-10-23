# Storefront cache and speed checks

Phase 17 · [implementation notes](../roadmap/phase-17-implementation.md) · [test results](phase-17-test-results.md)

Varnish sits in front of the storefront and keeps public pages in memory. The core tells it when a page is out of date. This page says how to run it locally, how it decides what to keep, and what to do in operations.

## Run it locally

1. Build: `npm run build`.
2. Make a purge secret: `openssl rand -hex 32`. Varnish refuses to start without one, and refuses an all-zero one.
3. Start the core, worker and storefront as usual, with the settings below.
4. Start Varnish: `CACHE_PURGE_SECRET=<secret> docker compose --profile speed up -d varnish`.

Shoppers' address is `http://localhost:6081`. The purge port is `127.0.0.1:6082`, on this machine only. `STOREFRONT_PORT`, `VARNISH_PORT` and `VARNISH_PURGE_PORT` change the ports. Plain `npm run services:up` (PostgreSQL and Redis) works as before: Varnish only starts with the `speed` profile.

Core settings (`apps/core/.env`):

```dotenv
CACHE_STORE_ID=store1
CACHE_PURGE_URL=http://127.0.0.1:6082/
CACHE_PURGE_SECRET=<the same secret>
CACHE_WARM_UP=true
STOREFRONT_URL=http://localhost:6081
```

Storefront settings (`apps/storefront/.env`): `SITE_URL=http://localhost:6081`, `CACHE_STORE_ID=store1`, and the same cache Redis and `REDIS_KEY_PREFIX` as the core.

`STOREFRONT_URL` must be the address shoppers type. The warm-up requests pages there, and Varnish's cache key includes the Host, so a warm-up through any other address would fill entries no shopper uses.

## The speed suite

`npm run test:speed` (after `npm run build`, with PostgreSQL, Redis and Docker running). It starts its own database, core, worker, storefront and Varnish container on free ports, with a fresh random secret, and removes them at the end. It refuses to run with `APP_ENV` staging or production. Reports and logs go to `.performance/` (ignored by git); CI uploads them.

- `SPEED_ALL_BROWSERS=1` also runs the whole browser suite through Varnish.
- `SPEED_CORE_DIR=<folder>` runs another build of the core (default `apps/core/dist`).
- Install Chromium once: `npx playwright install chromium`.

## What Varnish keeps

**Kept:** pages the storefront marks as shareable (`X-Cache-Store`), for anonymous GET and HEAD requests: home, products, categories, content pages, sales pages, search suggestions, sitemaps.

- Pages: 7 days. Purges keep them fresh.
- A 404: 60 seconds.
- Anything else uses its own `max-age` (search suggestions 60 seconds, sitemaps an hour).
- If the storefront is down, the last copy is served for up to 24 hours.
- Browsers check again on every visit, so a purge shows on the next reload.

**Never kept:** cart, checkout, account, order tracking (`/track/`, `/t/…`), APIs, previews, search results, a sales page's order and thank-you pages, old WordPress links (`/?p=…`), and any request with an `Authorization` header or a session, admin, auth or CSRF cookie. These rules match by path prefix, so `/account/x.css` is private too. Other cookies (analytics) are dropped on public pages, and stored pages never set cookies. Redirects are never kept either.

**The cache key** is the Host and the address, with only the query parameters the page reads:

| Page | Parameters kept |
|---|---|
| Categories | `filter.<key>`, `page`, `sort` |
| Search suggestions | `q` |
| `/theme.css` | `v` |
| Everything else | none |

Everything else (`utm_*`, click IDs, `?x=anything`) is left out of the key and out of the request the storefront sees, so random parameters can't fill the cache. Parameters are sorted. A redirect still carries the shopper's own tracking parameters: Varnish adds them back to the redirect's address.

**Two memory stores.** Real pages live in `main` (128 MB, `VARNISH_MEMORY`). Things anyone can create without limit live in `volatile` (16 MB, `VARNISH_VOLATILE_MEMORY`): 404s, filtered category pages, suggestions, and responses without `s-maxage`. A flood of those pushes out only each other.

**Errors.** If the storefront doesn't answer and there's no copy, Varnish serves its own small Bangla and English "temporarily unavailable" page (503, retry in a minute). Its health check is `/health/live`, which answers whenever the storefront runs, even when the core is down. So with the core down, the storefront still serves its own "unavailable" page, and cart and checkout say so properly. During a background refresh, an error or a "busy" (429) answer never replaces the copy shoppers are getting.

## How pages are kept fresh

Every cached page carries tags. The core purges by tag. The two lists are in `apps/storefront/src/lib/cache-policy.ts` and `apps/core/src/plugins/cache-purge/tags.ts`.

| Change | What is refreshed |
|---|---|
| A product, its variants or channels | That product's page, sales pages that sell it, sections showing it, and every listing (home, categories, suggestions) |
| A category | Its pages, every listing, and the header's top categories (only when the store has no header menu) |
| A category's products (its filters ran) | That category, its products' pages, every listing |
| Stock: "in stock", "only a few left" or "sold out" changes | That product's pages and the listings. A sale that changes nothing shoppers see purges nothing |
| Facets, options, tax rates, Vendure's global settings | Every page showing a product |
| A promotion saved, starting or ending | Every page showing a product. Starts and ends are scheduled for their time |
| An image edited or deleted | The whole store (rare) |
| Settings, theme, menus | The whole store (they're on every page) |
| Pages, layouts, sales pages | What our plugins name: content pages, pages built from sections, sales pages |
| A WooCommerce import | Nothing while it runs, then the whole store once, then a warm-up |

Content pages are not refreshed by catalog changes, unless their sections show products.

**Listings twice.** Category and home listings come from Vendure's search index, which the worker updates after the change. So listings are refreshed a second time, about `CACHE_LISTING_SETTLE_MS` (10 seconds) later. If the index is still busy then, the core waits for it (up to 10 minutes), then waits out bd-search's few-second catalog cache before refreshing.

**How a purge travels.** The change writes a row in its own transaction (a rolled-back change purges nothing). The worker looks for due rows four times a second. Rows written within 2 seconds of each other go out as one purge. The storefront's data cache in Redis is cleared first, then Varnish gets a soft purge: the old page is still served while the new one renders. A purge Varnish refuses stays in the table and is tried again 5 seconds later. While the cache Redis is down, purges wait for it.

**Only the worker delivers.** Server processes only write rows. With several workers, a lock lets one deliver per store at a time.

**Restarts.** Restarting the core or deploying purges nothing. A promotion start or end that passed while the worker was down is still in the table and goes out on the next round.

**Imports.** While a WooCommerce import runs, its changes and the jobs they start purge nothing. When it finishes (after its search reindex), one purge of the whole store and a warm-up follow. If an import dies, a purge of the whole store still runs 5 minutes after its last change.

## Warm-up

With `CACHE_WARM_UP=true`, the worker warms the cache after a purge of the whole store, and after Varnish restarts (it asks Varnish's purge port for a random ID that changes at every start). It requests, through `STOREFRONT_URL`, in the store's default language:

1. the home page;
2. the header menu's links in menu order, or, without a menu, the top categories in their order (as the header shows them), up to 10;
3. the 50 best-selling products: units in delivered orders over the last 90 days, newest first among equals (bd-search's "popular" order; only enabled products still in the search index).

Each run's list shows in the Dashboard's job list (queue `storefront-cache-warm`). Warm-up never blocks purges or orders.

## Operations

**The purge port is for the core only.** Two checks guard it: the caller's address (the container itself, or Docker's gateway, which is how the host's own connections arrive) and the shared secret. Other containers on the Docker network are refused. Never publish the port on a public address. `CACHE_PURGE_ALLOW` sets the allowed addresses where Docker behaves differently.

Purge the whole store:

```sh
curl -X PURGE http://127.0.0.1:6082/ \
  -H "X-Purge-Token: $CACHE_PURGE_SECRET" -H 'X-Purge-Tags: store1:store'
```

For maintenance or suspension, add `-H 'X-Purge-Mode: hard'`: old copies are removed outright, so a down storefront then shows the 503 page instead of old pages. Ordinary outages use the normal (soft) purge and grace.

**Production (phases 23 and 24) must:**

- forward only the store's own host names to Varnish, unchanged (the Host is part of the key);
- set `X-Real-IP` from Nginx on the same machine (the only trusted proxy);
- route `/cache-metrics` to the core;
- keep the purge port private, with a real secret.

Per-store backends, TLS and Brotli are phase 23's.

## Speed measurement

The speed beacon reports LCP, INP and CLS from a sample of visits (`VITALS_SAMPLE_RATE`, 10% by default; 0 turns it off). Staff with ReadSettings read the daily 75th percentile per kind of page (`cacheDailyVitals`); reports come in phase 41.

- **What a page ships.** With the beacon off, nothing. With it on, a 368-byte loader (gzipped). Only sampled visits then load web-vitals (3.06 KB).
- **What is sent.** The metric, its value, web-vitals' random ID for the page view and the kind of page (product, category…).
- **What is stored.** The same, with the ID hashed and the Dhaka day. No address, query, referrer, cookie, IP or device.
- **Limits.** The core accepts beacons only from the store's Origin, at most 512 bytes. The Origin stops other sites' pages, not scripts, so there are limits too: 60 a minute and 1,000 a day per visitor address (the address is hashed, never stored), 1,200 a minute and 50,000 a day per store. Many shoppers can share one mobile operator address, which is why the per-address limit isn't lower.
- **Retention.** Samples are deleted after 31 days.

**Budgets.** CI checks every built script (30 KB gzipped, 45 KB for checkout and sales pages; the beacon's loader 600 bytes and web-vitals 3.5 KB) and runs Lighthouse three times each on a product page and a sales page, on a throttled phone: LCP at most 1.5 s, CLS under 0.1, blocking time under 200 ms (the lab stand-in for INP), performance score at least 95. The suite also checks that a deliberately oversized script and an impossible LCP budget fail.
