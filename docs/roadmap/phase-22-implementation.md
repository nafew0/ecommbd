# Phase 22 implementation plan

2026-10-22 · SolCodex · follows the Phase 21 implementation

## Decisions before implementation

1. Keep Phase 21's mapper, exact historical-order archive and verification. Add a push connector that feeds the same import stages. Full final reconciliation remains necessary: changing child notes/refunds does not reliably change an order's modification date.
2. Pair using a high-entropy one-use code (one hour). Issue a source/channel-scoped upload token (seven days), encrypt it at rest, and authenticate bounded chunks with HMAC-SHA256 over timestamp, nonce, sequence, stage and the exact JSON payload string. This envelope stays identical across PHP/JavaScript JSON encoders. Persist accepted sequence/digest so a lost response can be retried without applying twice. Reject stale timestamps, altered chunks, sequence gaps and revoked tokens.
3. The WordPress helper opens no inbound API. A capability/nonce-protected admin page starts/resumes outbound export using WooCommerce CRUD/REST controllers for both HPOS and classic orders. It reads only the selected multisite site. Chunk budgets adapt; source data is never changed.
4. Export customer-role accounts only. Store hashes encrypted with a twelve-month expiry. Refuse login ownership transfer on identity conflicts, existing users, placeholders or ambiguous mappings. Verify phpass, WordPress `$wp` bcrypt, plain bcrypt and MD5; after successful login replace with Vendure's native hash and delete the legacy secret. Password reset must invalidate the legacy route too.
5. Import SEO into Phase 12 fields, supported coupons into promotions, approved reviews into a private archive, and Pixel/settings into a reviewable source record. Unsupported coupon constraints and plugin features produce issues; never broaden a coupon's eligibility silently.
6. Resolve old product/category/page/attachment/query URLs to current canonical routes. Use normalized local paths only, collapse redirect chains, reject loops/open redirects and record bounded unresolved-404 counters. Operations staff can correct mappings and see the most-hit misses. *(Changed in the review, 2026-10-23: the storefront asks for a rule only after its own 404, except WordPress's `/?p=` links, so a store page always wins; see docs/decisions.md.)*
7. Add a bounded sitemap crawler and an explicit cutover checklist. Crawling is read-only and SSRF guarded, follows at most one redirect and verifies the destination. No DNS, gateway-panel or domain changes happen automatically. Write the freeze, verification, rollback and thirty-day retention playbook.

## Build order

- Merge current main while retaining Phase 21, then add protocol/entities and generated additive migration.
- Implement the helper exporter and push connector, then secrets/authentication and extra-data mapping.
- Implement URL resolution, crawler, storefront integration and bilingual operations screens.
- Test both phases, repair defects exposed by tests, and record actual results and remaining external acceptance work.

## Test plan

- Unit: exact money/address mapping; adaptive REST pagination; HMAC tamper/replay/order; WordPress-generated password fixtures and wrong passwords; Unicode/query URL normalization, loops and crawler bounds.
- Integration: real Vendure/PostgreSQL import through both connectors; repeat/resume; exact totals/refunds/notes; options/images/customer conflicts; no historical notifications or payments; read permissions; token expiry/revocation; safe open COD conversion; first-login rehash/reset/expiry; coupons, SEO, reviews and redirect persistence.
- PHP: syntax, exporter fixtures, nonce/capability paths and signed requests; use WordPress/WooCommerce containers where available to exercise classic and HPOS data.
- Playwright: English/Bangla desktop and phone admin flows, pairing/import progress/reports/history, URL management and checklist; storefront redirects and authentication API through the real local server.
- Run relevant existing commerce/storefront regression tests, type/lint checks and builds. Report real-store/performance/version-matrix acceptance separately; do not label a synthetic fixture as a real merchant rehearsal.

## Research

- [WordPress password checks](https://developer.wordpress.org/reference/functions/wp_check_password/) and [hash generation](https://developer.wordpress.org/reference/functions/wp_hash_password/): use the current code, including HMAC-SHA384 preprocessing for `$wp` hashes; custom hashers are not assumed compatible.
- [WordPress phpass implementation](https://github.com/WordPress/WordPress/blob/master/wp-includes/class-phpass.php): portable encoding and iteration rules.
- [WooCommerce HPOS recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/): read orders through WooCommerce APIs, never directly from post tables.
- [WordPress outbound HTTP](https://developer.wordpress.org/reference/functions/wp_remote_post/) and [nonce security](https://developer.wordpress.org/apis/security/nonces/): safe remote requests with TLS verification, plus capability checks; a WP nonce is not authorization or a one-use upload nonce.
- [Yoast taxonomy metadata](https://github.com/Yoast/wordpress-seo/blob/trunk/inc/options/class-wpseo-taxonomy-meta.php) and [variable replacement](https://github.com/Yoast/wordpress-seo/blob/trunk/inc/wpseo-functions.php): taxonomy fields use `wpseo_taxonomy_meta`, rather than product post-meta keys. [PixelYourSite Facebook source](https://plugins.svn.wordpress.org/pixelyoursite/trunk/modules/facebook/facebook.php) exposes Pixel IDs independently of CAPI credentials; only the first ID is retained for the destination's single field.

The compatibility target is PHP 7.4+, WordPress 5.8+ and WooCommerce 4+. Exact tested versions will be listed in the test report; the target is not a claim that the entire matrix passed.

## Implementation handover

Implemented on `solcodex`; see the [test report](../runbooks/migration-test-results.md). Fresh helper uploads are required for catch-up; re-running the same uploaded snapshot cannot masquerade as a fresh sync. Pending legacy passwords can refresh from that frozen source, but native passwords after login/reset are never replaced. Uploaded chunks are deleted when the pairing is revoked or replaced, or when the migration is completed; after each import, the customers' password hashes are removed from them.

## Review fixes (2026-10-23)

A review found that Bangla slugs lost their address, that stores without trailing slashes failed to import, that old WordPress pages could take over the new store's pages, that one bad record stopped every resume, that the first real order number repeated the last WooCommerce one, that the "importing" mark was lost on Vendure's context copies, and that uploads with password hashes outlived a revoked pairing. All are fixed and tested (`apps/core/test/e2e/woo-migration-urls.e2e-spec.ts`, `test/unit/woo-fixes.spec.ts`); see the CHANGELOG and docs/decisions.md for what changed.

Pilot limits remain explicit: unsupported coupon constraints are reported; source dimensions stay in mapping metadata; image URLs still require guarded access (protected hosts may need an operator allowlist); the bounded crawler reports truncation. Pixel ID/shipping/permalink references are visible for review. Writing the Pixel ID into live Meta settings awaits the Phase 20 plugin, which is not on main. Live DNS/gateway/courier changes require the runbook and merchant approval.
