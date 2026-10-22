# Phase 21 implementation and handover plan

2026-10-22 · SolCodex · branch `solcodex` · phase 21 only

## Review of the existing code

- Reuse Vendure product/variant/option/facet/collection services directly. The one-page product form supports only one variation dimension and regenerates slugs, so it cannot be the importer.
- Reuse the shared guarded HTTP client, HTML sanitizer and encryption helpers. Source URLs and image hosts must remain subject to SSRF checks.
- Reuse the phase 09 asset storage pipeline and `BdImageService`. Import images from bounded buffers; never pass source image URLs to Vendure's unrestricted downloader.
- Keep historical orders in separate, read-only records. Creating them as live orders would recalculate old totals and allocate stock, and could trigger payment/SMS/integration events.
- Customer merging must preserve existing account ownership. This phase imports customer profiles and history; it creates no login or password credentials.
- M3 owns storefront rendering and M4 owns gateway/courier/Meta behavior. Historical imports create no order/payment events. Catalog integration listeners can use the internal `isWooImportContext` guard and invalidate once on `WooImportCompletedEvent`. Image processing and existing slug registration still run.

## Phase 21

1. Add migration sources, resumable runs, record mappings, issues and legacy orders as plugin entities, with a generated additive migration.
2. Add an HTTPS, read-only `/wp-json/wc/v3` connector. Use ascending IDs and absolute offsets; reducing batch size never changes how far we have read. Checkpoint every record, persist the chosen size, and stop/resume visibly after failures.
3. Inspect and dry-run first. Read source currency, tax settings and weight unit. Require explicit image-host approval. Persist a created-before GMT watermark for products/orders. Reconciliation scans all resources again: child notes/refunds may change without updating their parent order's modification date. An API export is not a transactional snapshot: freeze the source for the final pass and verify afterward.
4. Import nested categories/tags, simple and variable products (multiple option groups), assets, customer identities/addresses, exact order snapshots, notes and refunds. Preserve source IDs and source URLs separately from destination IDs.
5. Keep exact decimal amounts as integer minor units in legacy orders, grouped by currency for verification. Whole-taka catalog restrictions, unsupported stock/tax configurations, unsupported product types and ambiguous variations are reported rather than silently changed.
6. Review recent open orders explicitly. Only unpaid COD orders with validated addresses and exact destination quote matches can be converted. Require source checkout freeze and an explicit inventory reservation choice; do not recreate already paid orders or run gateway charges. A mapping prevents a second conversion.
7. Add permission-protected migration UI, progress/issues, downloadable CSV/HTML reports, legacy order search/detail and customer history, verification totals/samples, resume/catch-up and credential cleanup.

## Scope boundary

Phase 22 is explicitly deferred by the user. No WordPress helper plugin, pairing/upload protocol, legacy password authentication, custom permalink routing, redirect crawler, password/coupon/review migration, or cutover tooling is implemented here. The connector interface remains extensible for that later phase. Source URL mappings are retained as data so Phase 22 can build redirects without re-importing the catalog.

## Verification ownership

Per the user's request, implementation checks are limited to lint/type/build, database migration and basic startup checks. Do not run integration, browser, load or live-store tests. The manual checklist in `docs/runbooks/migration-testing.md` is the acceptance handover. Phase 21 stays in Review until the user validates them against authorized source stores; the one-hour import target is not claimed from static checks.

## Pilot decisions and limits

- Keep this an assisted migration for the first merchant. At about 20 orders/day, preserving order history, inventory and staff trust matters more than building a self-service wizard. Do a rehearsal against a store copy before scheduling a move.
- Historical gross order totals are compared by source currency and Dhaka month across all statuses. These are reconciliation totals, not a net-sales/accounting report. Refund records and their exact amounts remain available separately.
- Shared parent stock, wildcard variants and tax-exclusive taxable catalog prices require review; affected products stay disabled. Non-BDT catalog prices are refused. Hidden products are imported disabled and reported. Scheduled sales are reported; no future promotion is inferred.
- Dimensions are retained in source mapping metadata and reported because the current destination has only a shipping-weight field. No destination dimension fields are invented alongside M4's courier work.
- Address matching uses district names/aliases and unambiguous thana aliases. An uncertain match remains flagged rather than selecting a similar but wrong delivery area.
- Existing customer profiles win when merged. Imported profiles can update names/addresses; changed phone/email identity requires review. No authentication is imported.
- Deletions are not mirrored destructively. Count mismatches expose stale mappings/history for review. A completed run with warnings still requires inspecting its exclusions. Re-import before converting orders; after a live conversion, changed stock/order data is refused for review.
- REST access, supported source versions, image readiness, zero external notifications and the performance target require real-store acceptance. Phase 21 is implementation-ready for review, not approved for production cutover.

## Research sources

- [WooCommerce current REST v3 orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/): GMT timestamps, decimal totals, guest customer ID zero, modified filters. Use `/wp-json/wc/v3`, not the older `/wc-api/v3` API.
- [Products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/) and [variations](https://developer.woocommerce.com/docs/apis/rest-api/v3/product-variations/): current prices, visibility, inventory/backorders and attribute combinations have separate meanings.
- [WordPress REST pagination](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/): page size is capped; totals/offsets support bounded traversal.
- [WooCommerce HPOS recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/): direct WordPress order-table access may read stale data; use WooCommerce APIs.
- [Order refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/): fetch full refund records separately from order summaries.
- [WooCommerce Bangladesh subdivision names](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/i18n/states.php): Woo's ISO district-code ordering differs from the project's BBS codes, so names and aliases bridge them.
