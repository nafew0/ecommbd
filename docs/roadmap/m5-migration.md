# M5 · WooCommerce migration

> Phases 21–22 · [Roadmap overview](README.md)
> **Exit criteria:** a copy of a real WooCommerce store migrates with a clean verification report, customers keep their passwords, and a crawl of the old sitemap finds zero broken URLs.

Migration is the product's front door: it's what convinces a WooCommerce merchant to move. It has to be **exact** (no lost orders, correct totals), **repeatable** (safe to run again), **gentle** (it mustn't knock over the old, often weak, host) and **honest** (a report says exactly what wasn't migrated and why).

---

## Phase 21 — WooCommerce importer: catalog, customers and orders

| | |
|---|---|
| Milestone | M5 |
| Delivers | Import products, variations, images, categories, tags, customers and orders (P0); connection with WooCommerce API keys (P0); dry run with report (P0) |
| Depends on | 02, 03, 04, 09 |
| Size | XL (split into 21a catalog + images and 21b customers + orders if needed) |
| Needs | Anonymized exports or test copies of 3–5 real BD WooCommerce stores, with the owners' permission |

**Goal.** Move a real WooCommerce store's catalogue, customers and order history exactly, safely and repeatably, through WooCommerce's REST API.

### Decide at start

- **How historical orders are stored.** Two options:
  - (a) Create real Vendure orders with fixed totals in their final states.
  - (b) **Store history in a read-only `LegacyOrder` table**, shown in the Dashboard, customer history, search and reports, and convert only recent *open* orders into real Vendure orders through the normal flow.

  Option (b) is recommended: it never fights Vendure's pricing and state rules, so it can't corrupt real orders. Prove the choice with a spike on 1,000 real orders.
- **Which open orders become live orders:** recommended, only Woo orders in `processing`/`on-hold`/`pending` from the last 14 days, after the merchant reviews the list.
- **Image source hosts** allowed by the SSRF guard: the store's own domain and any CDN hosts discovered in the product data, shown to the merchant to confirm.

### Build (plugin `woo-import`)

1. **Source connector interface** (REST now; the helper plugin in phase 22 implements the same interface):
   - `inspect` (versions, counts, settings)
   - `listProducts`, `listVariations`, `listCategories`, `listTags`, `listCustomers`, `listOrders`, `listCoupons`, `listReviews`
   - each `list*` call takes a cursor and `modifiedAfter`
2. **REST connector** for WooCommerce REST API v3, with **read-only** consumer keys:
   - **Adaptive page size:** start at 100; on timeouts or 5xx errors, back off to 50, 20 and 10.
   - **Gentle on the old host:** at most 2 concurrent requests by default, with backoff and retry on 429/5xx.
   - **Timestamps** in GMT (`date_created_gmt`, `date_modified_gmt`), whatever the WordPress timezone setting is.
3. **Job orchestration** (Vendure job queue):
   - **Steps:** connect → inspect → dry run → import catalog → images → customers → orders → verify.
   - **Saved progress:** cursors are checkpointed, so a crash or deploy resumes where it stopped.
   - **Idempotent upserts:** keyed by an `ImportMapping` table of (source, entity type, source ID) → our ID. A second run updates; it never duplicates.
   - **No side effects** during import: no SMS, emails, Meta events, stock movements, cache purges (one purge-all at the end) or webhooks. A request-context flag carries this, and every listener checks it.
4. **Catalog mapping:**
   - **Product types:**
     - simple → a product with one variant
     - **variable** → a product with options and variants
     - global attributes (`pa_*`) become facets and options; local attributes become options
     - grouped and external products are skipped and listed in the report
   - **Prices and stock:**
     - prices are whole taka; a sale price becomes the variant price, with the regular price kept as "compare at"
     - a scheduled sale becomes a dated promotion, or is reported
     - stock quantity, `manage_stock` and backorders are mapped
   - **Identifiers:** SKUs kept; duplicates get a suffix and are reported.
   - **Physical data:** weight converted to grams from the store's unit; dimensions too.
   - **Categories and tags:** categories (with nesting) become collections; tags become the "tag" facet.
   - **Status:** draft, private and pending products are imported **disabled**.
   - **Slugs are kept exactly**, including Bangla slugs, so URLs don't change.
   - **Descriptions:**
     - HTML is sanitized
     - images inside descriptions are imported and their URLs rewritten
     - page-builder shortcodes (`[vc_row]` and similar) are stripped and counted in the report
5. **Images:**
   - featured, gallery and variation images are downloaded through the **SSRF guard** and processed by phase 09's pipeline
   - de-duplicated by URL and content hash
   - per-image failures (404, hotlink protection) are reported without stopping the import
6. **Customers:**
   - **Phones** are normalized from billing and shipping phone fields and become the customer key (phase 03).
   - **Duplicates** are merged by phone, then by email.
   - **Addresses:**
     - WooCommerce's Bangladesh state codes (`BD-01`…`BD-64`, one per district) map to our districts
     - thanas are matched fuzzily from the city and address text
     - unresolved addresses get "Other", plus a flag in the report
   - **Guest orders** create guest customers.
7. **Orders:**
   - **Legacy records keep totals exactly** as WooCommerce recorded them, with no recalculation:
     - line items (product snapshot: name, SKU, variation, quantity, price, tax)
     - shipping lines, fees, coupons and discounts
     - payment method title and transaction ID
     - Woo status, dates (created, paid, completed)
     - customer note, private and customer order notes, refunds
   - **Woo order numbers are kept** as display numbers, and our sequence (phase 04) continues after the highest.
   - **Recent open orders**, after merchant review, become real orders in **New** through the draft-order flow, so they enter the normal workflow.
8. **Dry-run report:**
   - counts per entity, and what will be skipped and why
   - duplicate SKUs, unmapped addresses, missing images, shortcode counts
   - an estimated duration, downloadable as CSV/HTML
9. **Verification report** after import:
   - counts match
   - order revenue per month matches WooCommerce's totals exactly
   - 20 random sample records compared field by field
   - image coverage
10. **Migration screen** (Dashboard, for our team during the pilot; the self-serve version is phase 40): connect, dry run, review open orders, import with a progress bar and live log, then verify.
11. **Key cleanup:** consumer keys are deleted once the migration is marked complete, and the merchant is reminded to revoke them in WooCommerce.

### Edge cases

- **WooCommerce variety:**
  - versions 3.x to 9.x
  - classic post storage or HPOS (the REST API hides the difference)
  - stores with tax-inclusive or tax-exclusive settings
  - currency not BDT (reported, never converted)
- **Product data:**
  - products with 200+ variations
  - variations with "Any size" attributes (expanded or reported)
  - Bangla attribute values
  - prices stored as strings with commas
  - negative stock
  - descriptions with inline scripts or iframes (removed), huge descriptions, emoji
- **Images:**
  - broken URLs (404); images behind hotlink protection, a bot challenge (Cloudflare) or basic auth (use the phase 22 plugin instead)
  - WebP or AVIF sources
  - the same image with different query strings
- **Customers and phones:**
  - phones in the wrong field, several phones in one field
  - guest orders without any phone (imported, flagged)
  - customers with the same email and different phones, or the same phone and different emails
- **Orders:**
  - deleted products referenced by old orders (the snapshot keeps the details)
  - deleted customers
  - 20,000+ orders spanning years
- **Source problems:**
  - the old host goes down mid-import (resume later)
  - rate limits from the host (429 → backoff)
  - REST API blocked by a security plugin such as Wordfence (detected and explained, pointing to the helper plugin)
  - mixed timezones (always use GMT fields)

### Security

- Consumer keys are encrypted and deleted after completion. The UI only asks for **Read** keys, and the connector never calls write endpoints.
- **SSRF guard** on every image download: allowed hosts only, no private IP ranges, DNS checked at connect time, size limits, and type checked by the image pipeline.
- Every imported HTML field is sanitized; nothing imported is ever rendered unsanitized.
- Running a migration needs the `RunMigration` permission (owner and our operations team). Every run is recorded.
- Report files contain personal data, so they're generated on demand, never stored publicly, and expire.

### Tests

- **Fixtures:** anonymized real exports from 3–5 BD stores, plus a synthetic store containing every edge case above.
- **Idempotency:** importing twice gives identical counts and no duplicates.
- **Resume:** kill the process mid-orders, restart, and the result matches an uninterrupted run.
- **Exact totals:** revenue per month and per order match the source to the paisa.
- **Performance:** a store with **500 products and 20,000 orders imports unattended in under 1 hour** (the spec's success criterion) on a server like the production ones.

### Done when

- [ ] A copy of a real BD WooCommerce store imports through the REST API with a clean verification report.
- [ ] A second run changes nothing.
- [ ] The time criterion is met.
- [ ] No SMS, emails or Meta events fired during import.

### Not in this phase

The helper plugin, password hashes, SEO fields, redirects and cutover (22); the self-serve wizard (40).

---

## Phase 22 — WordPress helper plugin, passwords, SEO URLs and cutover

| | |
|---|---|
| Milestone | M5 |
| Delivers | Helper plugin as the main connection (P0); keep WooCommerce URLs and 301s (P0); final catch-up sync (P0); customers keep passwords (P1); coupons, reviews, SEO fields and Pixel ID (P1, pulled forward because the plugin exports them anyway) |
| Depends on | 21 |
| Size | XL (split into 22a plugin + import and 22b URLs + cutover if needed) |

**Goal.** Full-fidelity migration, including what the REST API can't provide, and a domain switch with no lost orders and no lost Google rankings.

### Decide at start

- **Minimum supported versions:** recommended PHP 7.4+, WordPress 5.8+ and WooCommerce 4+. Bangladeshi hosts often run old versions.
- **Password hashes:** how long unused legacy hashes are kept. Recommended: 12 months, then deleted, after which customers use OTP login or a reset.
- **Rollback window** after cutover: recommended 30 days, with the old store kept read-only.

### Build

1. **WordPress plugin** (`apps/wp-migrator`, PHP):
   - **Admin page:** paste the pairing code, then see progress, status and errors in Bangla and English.
   - **Read-only exporters**, chunked by ID range so they're memory-safe on cheap hosting. They export products, variations, attributes, categories and tags, media URLs, and customers including **password hashes** (customer role only, never admin hashes).
   - **Orders** are read through WooCommerce's own APIs, so both HPOS and classic storage work.
   - Also exported:
     - coupons and approved reviews
     - Yoast and RankMath SEO titles and descriptions
     - permalink settings (product and category bases)
     - rules from the Redirection plugin, if installed
     - PixelYourSite's Pixel ID
     - shipping zones and store settings (currency, weight unit), for reference
   - **Push only:** the plugin **sends** data to our import endpoint over HTTPS in HMAC-signed chunks and opens no inbound endpoints.
   - **Resumes** after timeouts, and chunk sizes adapt to `max_execution_time` and the memory limit.
   - **Uninstall** removes everything the plugin stored.
   - Follows WordPress coding standards: escaping, nonces, capability checks (`manage_woocommerce`) and sanitization.
2. **Pairing:**
   - The merchant generates a one-time code in our Dashboard (single use, expires in 1 hour).
   - The plugin exchanges it for an **upload token** scoped to the import endpoints of that one store, which expires after the migration window and can be revoked.
3. **Helper plugin connector** implementing phase 21's interface, with the extra data mapped:
   - Coupons → Vendure promotions with the same codes, limits and dates (rounding per the money rules).
   - Reviews → stored for phase 35, which displays them.
   - SEO fields → product and category SEO custom fields (phase 12).
   - The Pixel ID → pre-filled in phase 20's settings.
4. **Legacy passwords:**
   - a password-hashing strategy wrapper that keeps the legacy hash (encrypted) on the customer
   - **on the first successful login,** the password is verified with a port of WordPress's `wp_check_password`, covering:
     - **phpass** portable hashes (`$P$`, `$H$`)
     - **WordPress 6.8+** hashes (`$wp$2y$…`: bcrypt over a base64 HMAC-SHA384 of the password)
     - plain **bcrypt** (`$2y$`)
     - very old **MD5** hashes (32 hex characters)
   - The password is then **re-hashed with Vendure's strategy** and the legacy hash deleted.
   - The login screens come in phase 34; this phase proves it through the API.
5. **URL compatibility:**
   - **Product and category URLs:** product and category bases come from the permalink settings (custom bases such as `/shop/` or `/item/` are supported), and nested category paths are kept.
   - **Redirects table** with hit counts, holding:
     - WordPress pages mapped to our pages (or the home page)
     - attachment URLs → the product
     - `?p=123` and `?product=slug` URLs resolved
     - `/feed/` → 410 or home
     - Yoast and RankMath sitemap URLs → our sitemap
     - rules imported from the Redirection plugin
   - The Dashboard lists the most-hit unresolved 404s after cutover, with one-click redirects.
6. **Catch-up sync:** every connector supports `modifiedAfter`. The final sync runs right before DNS switches, during a short freeze of the old store (a WordPress maintenance mode guide).
7. **Cutover playbook and tools** (`docs/runbooks/cutover.md`, plus a checklist screen):
   - **Before cutover:**
     - DNS TTL lowered 24 hours ahead
     - store live on its platform subdomain
     - SSL ready
     - **gateway callback/IPN URLs updated** in the SSLCommerz and bKash merchant panels
     - courier webhooks updated
     - Meta domain verification
     - Search Console ownership
   - **Redirect crawler:** fetches the old store's sitemaps and checks that every URL returns 200 or a single 301 on the new store, with zero 404s.
   - **Rollback plan:** point DNS back; orders placed on the new store during the window are exported for re-entry.
   - **After cutover:** monitoring checklist covering orders arriving, payments verified, courier bookings, Meta events and 404 logs.

### Edge cases

- **Hostile or broken source sites:**
  - **A hacked WordPress site** (common among the merchants we target): treat all exported data as untrusted and sanitize everything. The plugin stays minimal and read-only. The playbook recommends a malware scan before migration.
  - **Cheap hosting limits** (30-second execution time, 128 MB memory): chunk sizes adapt, and progress survives timeouts.
  - **Security plugins blocking outbound requests** (Wordfence and others): detected, with allowlist instructions.
- **Unusual WordPress setups:**
  - **Multisite:** one site at a time, chosen by the merchant.
  - **Very old WooCommerce** without HPOS or newer APIs: fallback code paths, tested on the oldest supported version.
- **WooCommerce data variety:**
  - Custom order statuses from other plugins: mapped to the closest status, keeping the original label.
  - WooCommerce Subscriptions or Bookings data: not supported, clearly listed in the report.
  - **Multilingual plugins** (WPML, Polylang): the primary language is imported; the others are listed in the report.
  - Currency-switcher plugins: only the base currency is imported.
- **Customer identity:**
  - One email with several phones, or several emails on one phone: merged by phase 21's rules, with conflicts listed.
  - **Legacy accounts with an email but no phone:** keep email + password login (phase 34), and prompt to add a phone.
- **URL edge cases:**
  - redirect loops (detected by the crawler)
  - trailing-slash and uppercase differences
  - Bangla slugs encoded differently by different tools (normalized)

### Security

- **Signed chunks:** HMAC-SHA256 with a timestamp and nonce (no replays), TLS certificate verification on, and the token limited to this store's import endpoints.
- **Password hashes are secrets:** encrypted at rest, never logged, never exported, and deleted after first login or 12 months.
- **Plugin code review** against WordPress security practice (output escaping, nonces, capability checks), with recommended deactivation and removal after cutover.
- **No inbound attack surface** on the merchant's WordPress: the plugin never accepts requests from us.

### Tests

- **PHP unit tests** (PHPUnit) for every exporter on WordPress + WooCommerce test containers covering:
  - the oldest supported versions (PHP 7.4 / WP 5.8 / WooCommerce 4)
  - the latest versions
  - both HPOS and classic order storage
- **Password verification** against hashes generated by real WordPress code for every format, plus wrong-password cases.
- **Redirect crawler** on a fixture store with custom bases, nested categories, pages, attachments and old sitemap URLs: zero 404s.
- **Full rehearsal on staging:** migrate a pilot-like store, run the catch-up sync, and walk through the cutover checklist.

### Done when

- [ ] A pilot-like store migrates via the helper plugin, including password hashes, SEO fields, coupons, reviews and the Pixel ID.
- [ ] A crawl of the old sitemap against the new store finds **zero** 404s or redirect chains.
- [ ] Migrated customers authenticate through the API with their old WordPress passwords, which are then re-hashed.
- [ ] The cutover runbook is written and rehearsed on staging.

### Not in this phase

The login screens (34), the self-serve migration wizard (40), migrating from other platforms (later, if ever).
