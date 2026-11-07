# Phase 21 — manual acceptance checklist

Status: automated Phase 21/22 checks are recorded in [test results](migration-test-results.md); real merchant acceptance is pending. This checklist covers Phase 21; the helper, passwords, URLs and cutover are covered by the [Phase 22 plan](../roadmap/phase-22-implementation.md) and [cutover runbook](cutover.md).

## Prepare

1. Use a fresh destination staging store and an authorized HTTPS copy of WooCommerce, not the selling destination. Back up both databases. Start the server and worker after applying the new `woo-import` migration.
2. Configure `WOO_IMPORT_KEYS=v1:<base64-32-byte-key>` on both server and worker (generate the value with `openssl rand -base64 32`). Keep the key backed up securely; it decrypts saved source credentials. Existing stores receive the new owner permission through the store-default initializer.
3. In WooCommerce → Settings → Advanced → REST API, create keys with **Read** permission for an account allowed to read orders, products, customers and settings. The connector sends GET requests only.
4. Open merchant admin → Settings → WooCommerce migration as an owner. Connect the source. Check the discovered currency/settings in the source record; tax/weight inputs are fallbacks when those settings cannot be read. Add only known CDN hostnames, without schemes or paths.
5. Keep a source inventory/customer/order count and export of totals for comparison. Include classic order storage and HPOS in the eventual 3–5 authorized store rehearsals. Record exact WordPress/Woo versions; compatibility with old versions is not yet proven.

## First rehearsal

- [ ] Run a dry run. Product, customer, order, asset and stock counts in the destination do not change. Only migration records/issues are saved. Read all exclusions before acknowledging the import.
- [ ] Check a simple product and a variable product with two attributes, Bangla values and 200+ variations. Names, slugs, current/regular prices, options, tags, categories and stock match.
- [ ] Check nested and empty categories. Empty categories must not contain the entire catalog. Change a category's parent to the root, reconcile, and check again.
- [ ] Check draft/private/pending and hidden products. Check out-of-stock, negative stock, backorders, parent-managed stock and wildcard variations. Unsupported configurations stay disabled or are refused with an issue; nothing silently becomes sellable.
- [ ] Check whole-taka prices, comma strings, decimal catalog prices, tax-exclusive taxable prices, non-BDT catalog and scheduled sales. Expect an explicit report for unsupported cases, never an exchange-rate conversion.
- [ ] Check weights in kg/g/lbs/oz. Dimensions remain in migration metadata and are reported; there are no destination dimensions yet.
- [ ] Check featured/gallery/variation/description images and duplicate image bytes at different URLs. Wait for the image worker: storefront WebP sizes must become ready. Test 404, unapproved CDN, SVG, oversized file, private-network URL and redirect to a private/unapproved host. Failures appear as issues; failed description images must not hotlink externally.
- [ ] Check HTML containing scripts, event attributes, iframes and builder shortcodes. It stays safe in both admin and storefront; removed shortcodes are reported.

## Customers and history

- [ ] Check a registered customer, guest, missing phone, shipping-only phone, several phones in one field, shared phone/different email and shared email/different phone. Review identity conflicts. No user account/password is created or moved.
- [ ] Check Woo districts **BD-13 (Dhaka), BD-30 (Kushtia)** and several others against destination names. Uncertain thana matches remain flagged with the original address retained.
- [ ] Check the customer page's WooCommerce history and search by original order number and phone digits. Unrelated channels must not expose records. Staff with ReadOrder can see history; staff without RunMigration cannot connect, run, convert or download migration reports.
- [ ] Compare orders with deleted products/customers, old statuses, discounts, fees, tax, private/customer notes, refunds, payment titles and transaction references. Snapshots retain source dates and exact decimal totals, including fractional taka as integer minor units.
- [ ] Compare all source and destination gross order totals by **currency + Asia/Dhaka month**, across the same statuses. Inspect the 20 sampled-order field comparisons, mapping counts, skipped counts and image coverage. Refunds are separate from gross totals; this is not a net-sales dashboard.
- [ ] Verify zero SMS/email/Meta/courier/gateway calls from historical imports, zero native orders/payments/stock-movement rows, and no changes to source data. M3/M4 listeners must honor the integration contract below when merged.

## Repeat and resume

- [ ] Import twice. No duplicate products, customers, assets or legacy orders. Unchanged records are skipped; source-to-target mappings remain stable.
- [ ] Break an image, import, repair the source image/host approval and run again. The failed media must retry even when the source product text is unchanged.
- [ ] Change product price/stock, an imported customer's name/address and an order note/refund. Reconcile: updates appear without duplicates. A changed customer identity requires review; a merged native profile is preserved and reported.
- [ ] Interrupt the worker mid-orders. After its 5-minute lease expires, resume. Counts and totals equal an uninterrupted run. Try two resumes and a second import at once: only one run may write for that source.
- [ ] Break one product's variations (or one order's notes) on the source. The record is skipped with `SOURCE_RECORD_UNREADABLE` and the import finishes. Then stop the source host mid-import: the run stops at the record it was on (nothing skipped), and a resume finishes it.
- [ ] Simulate source 429/5xx/timeouts and large pages. Confirm the page size falls 100 → 50 → 20 → 10 using the same absolute offset, and a continuing outage leaves a resumable failure.
- [ ] Freeze all source writes for the final rehearsal pass. Reconciliation rereads the full source, including notes/refunds. Confirm source-count and monthly-total matches. A deletion produces a mismatch for review; records are not automatically deleted from the destination.

## Reviewed open COD orders

Reconcile before converting. The old store must not also fulfill these orders.

- [ ] Select a pending/processing/on-hold unpaid COD order from the last 14 days. Confirm the source checkout is frozen and explicitly choose whether Woo already deducted its quantity from the imported stock.
- [ ] Convert. One native New order appears with the original number and exact line/delivery/total amounts. No placement SMS/email or gateway charge is sent. Available stock remains correct for the chosen reservation scenario.
- [ ] Repeat the conversion, including simultaneous requests. It returns the same live order and reserves no additional stock. If the client disconnected after placement, retry completes activation safely.
- [ ] Confirm/pack/cancel the live order normally. Future configured notifications work, and stock is allocated/released once.
- [ ] Test old, paid, non-COD, refunded, taxed, discounted, missing-address, duplicate-variant-line and changed-price orders. Conversion is refused and creates no partial native order/payment/stock change. Original-number conflicts also refuse conversion.

## Finish and record results

- [ ] Download CSV/HTML reports in both languages. Source keys and personal payloads are absent from aggregate reports; HTML is escaped and CSV formulas cannot execute. Keep local downloads private.
- [ ] Finish migration. Saved consumer credentials are removed; a new import requires reconnecting. Revoke those keys in WooCommerce too. Existing history/reports stay available.
- [ ] Rehearse **500 products + 20,000 orders** on representative hosting, including image processing. Record source latency, total elapsed time, failures, final ready-image count and peak memory. The under-one-hour criterion remains unverified until this passes.

For each store, record versions/storage mode, counts before/after, expected/actual monthly totals, unresolved issue codes, elapsed time, notification counts and reviewer/date. Keep Phase 21 in Review until agreed acceptance passes.

## Integration contract for M3/M4

Historical imports never call the native order/payment flow. Catalog event listeners performing external work should skip `isWooImportContext(event.ctx)` and use `WooImportCompletedEvent` for one final invalidation; image jobs and slug history still run. The mark travels with the request context, including the copies Vendure gives event subscribers and transactions (it used to be lost there). `WooImportCompletedEvent` is published after the search index has been rebuilt, so a listener that refreshes listings sees the imported catalog. Reviewed live conversion emits placement events with `order.customFields.imported=true`; external placement listeners must check that event snapshot before rereading the order. Activation clears that flag afterward so future fulfillment works normally.

Helper plugin, passwords, SEO redirects and production cutover are Phase 22 and are not part of this checklist.
