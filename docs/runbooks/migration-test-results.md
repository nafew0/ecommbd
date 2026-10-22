# Phases 21–22 verification

2026-10-22 · branch `solcodex` · local disposable environments, synthetic data only

Phase 22 was planned in [phase-22-implementation.md](../roadmap/phase-22-implementation.md), then implemented over Phase 21 and current `main` (through Phase 14). Both import paths have been exercised. This report distinguishes local evidence from the real-store milestone acceptance, which still needs an authorized merchant rehearsal.

## Automated checks

| Check | Result | Scope |
| --- | --- | --- |
| Core unit tests | 130 passed, 9 files | Includes independent PHP-generated WordPress password vectors, money/address rules, adaptive REST paging, signed payloads and sitemap crawler bounds |
| Core integration tests | 216 passed, 19 files | Actual Vendure/PostgreSQL; 10 migration scenarios plus existing commerce regressions |
| Shared package tests | 396 passed, 28 files | Existing shared helpers, money, identity, encryption and HTTP guard regression suite |
| Storefront unit tests | 47 passed, 6 files | Existing storefront helpers and checkout logic |
| Full Playwright suite | 129 passed, 35 intentionally skipped; 4.7 minutes | All 16 browser files on desktop/phone: admin, checkout, payment, stock, customers, images, search, pages, storefront and migration; existing device-specific cases skip their other project |
| Migration Playwright (included above) | All 4 passed | Desktop/phone, English/Bangla; real local API, worker and storefront |
| Storefront Playwright (included above) | 21 passed, 1 intentionally skipped | Routing, SEO, pages, sitemaps, private paths, security headers and phone overflow; overflow-only check skips desktop |
| Synthetic throughput | 1 passed; 96.31 seconds for the complete test | 500 products, including one product with 201 variations (700 total variants), 20,000 historical orders; signed upload, dry run, import and matching verification |
| Static/build checks | Passed | Repository lint, workspace type checks, admin/core/dashboard/storefront builds; PHP syntax checks |
| Database migrations | Passed | Generated additive six-table Phase 22 migration; applied after main and Phase 21 migrations; fresh server also starts with all pending migrations applied |

The throughput result is a local synthetic measurement with no remote images or source-host requests. It does **not** prove the real-host one-hour migration target or cheap-host execution limits. Existing `pg` concurrency deprecation warnings originate in the Vendure test runtime; the integration assertions pass.

## WordPress compatibility evidence

| WordPress | WooCommerce | PHP | Storage and result |
| --- | --- | --- | --- |
| 7.1.3 | 11.2.1 | 8.3.36 | Classic export fixture passed; HPOS order/notes/refund export passed |
| 5.8.3 | 4.9.4 | 7.4 | Classic export fixture passed |

Both environments passed runtime assertions for capability checks, missing admin nonce, exclusion of admin/customer mixed-role users, encrypted pending chunks, TLS verification, no outbound redirect following, PHP/JavaScript signature compatibility, unchanged payload after a lost acknowledgement, visible cron errors and cleanup. Metadata checks cover the actual Yoast taxonomy-option layout, RankMath term fields and PixelYourSite's separate Pixel ID option; CAPI tokens are excluded. The helper page also renders its progress labels in Bangla.

These are runtime assertions through WP CLI in real WordPress/WooCommerce containers, rather than a PHPUnit suite. They do not cover every intermediate version, WooCommerce 4.0 specifically, a real multisite network, every SEO plugin version or real security-plugin/firewall installations. Product/order data uses WooCommerce CRUD/controllers rather than raw order tables.

## Migration behavior exercised

- REST: adaptive paging/retries and safe offset changes; catalog, options, categories, customers and historical orders; exact decimal history, notes/refunds and repeat imports. Network fixtures provide source responses; no merchant REST service was contacted.
- Helper: one-use pairing; source/channel scope; timestamp/signature/nonce checks; sequence gaps, altered duplicates, lost acknowledgements, token expiry/revocation; encrypted uploaded chunks; fresh pairing required for catch-up; completion/expiry cleanup.
- Verification: exact counts, currency/month totals and canonical JSON sample fingerprints; saved cursor resume; changed child data included by a full frozen-source reconciliation. Repeated unchanged imports create no duplicate catalog or historical orders.
- Identity: matching conflicts cannot take over an existing account. Supported MD5, phpass `$P$`/`$H$`, plain bcrypt and WordPress `$wp` bcrypt hashes verify; wrong/expired/unsupported hashes fail. First login upgrades to native hashing; password reset invalidates the old route. A new source password can refresh only a still-pending, owned legacy reference.
- Extras: SEO, private approved-review archive and allowlisted source settings; supported coupons actually reduce a cart total. Unsupported eligibility/usage rules are reported; a previously imported coupon is disabled if its source gains unsupported restrictions.
- Open orders: recent simple unpaid COD conversion, reviewed stock choice, original number, idempotent retry, quote checks and refusal of complex/paid/conflicting orders. Historical imports create no native payment or placement notification.
- URLs: custom source bases, nested paths, attachment and query URLs, Unicode/case/slash normalization; no loops or external targets; bounded missing-URL counters; crawler accepts a final 200 or one same-origin 301 and reports failures/truncation.
- Browser operations: pairing, upload, dry run, acknowledged import, progress/report/history, redirect editing and actual storefront redirects, source settings, persisted checklist and private rollback-order download. No client script errors or phone overflow in the exercised migration screens.

## Defects found and repaired

The tests exposed Vendure updates being passed string IDs (which can insert partial rows), category-tree updates needing the collection move API, object-key reordering by PostgreSQL JSONB breaking sample fingerprints, and stale history after an import finished. Those are repaired. Further review tightened stock reconciliation, changed legacy-order protection after conversion, supported password formats, fresh helper catch-up, retryable image failures, exact refund exports, Yoast category SEO, Pixel ID extraction and unsupported coupon updates.

The existing storefront browser setup also needed a synthetic store name on a fresh database so SEO assertions had a valid fixture. It sets the name only when both language fields are blank.

## Reproduce

Use disposable databases and the standard local PostgreSQL/Redis services. Do not run fixture seeding against a merchant database.

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:browser
```

For just migration browsers, start built core/worker/storefront with a configured `WOO_IMPORT_KEYS` and public HTTPS `WOO_PUBLIC_URL`, then run:

```sh
BROWSER_BASE_URL=http://localhost:3096 STOREFRONT_URL=http://localhost:4396 npx playwright test -c playwright.migration.config.ts
```

The isolated configuration expects already-running services. Set `DB_NAME` (and other `DB_*` values) to the same disposable database as the running core when executing the full suite: the checkout test's OTP reader accesses it directly. The normal root Playwright configuration starts the services itself and includes the migration tests. CI uses dummy fixture keys and a synthetic public HTTPS origin; a real deployment must use its own secrets and reachable origin.

The opt-in scale test creates its own disposable database through Vendure's test initializer:

```sh
cd apps/core
npx vitest run -c vitest.migration-bench.config.mts
```

WordPress runtime checks live in `apps/wp-migrator/tests/`. `compose.yml` isolates both version fixtures under project `ecommbd-m5-wp`. Install WordPress/WooCommerce and activate the helper in those disposable containers, run `fixture.php` once, then `security.php` and `metadata.php` using `wp eval-file`. The fixture writes a private temporary export **inside the container**; do not copy raw password-bearing exports into the repository. Repository JSON fixtures use an explicit synthetic-data allowlist and contain no hashes or tokens.

Build the installable ZIP with `python3 apps/wp-migrator/package.py`; it excludes tests and exports.

## Remaining merchant acceptance

1. Rehearse on an authorized copy of the pilot store, including its real product types, custom fields, SEO/permalink plugins, order statuses, images and accounting totals. The original 3–5 real BD store sample requirement remains outstanding.
2. Confirm source-host limits and protected media access. The helper sends media URLs, not protected image bytes; blocked downloads remain visible issues and may need an approved host/IP allowlist or manual repair. The local benchmark is not this acceptance test.
3. Review unsupported coupons, plugin features and page mappings. Source pages currently fall back to home until mapped deliberately. Physical dimensions remain source metadata; they are not active destination shipping dimensions. The source must be frozen for a complete reconciliation; exports are not transactional database snapshots.
4. Phase 20 is not implemented on current main. Pixel ID is saved and shown for review; live Meta settings prefill/activation and event verification await that integration. Shipping/permalink settings are references, not silently applied store configuration.
5. Run the old sitemap against staging with zero unresolved URLs/chains. The crawler is bounded at 20 sitemap documents and 2,000 URLs per run and explicitly reports truncation; split a larger sitemap.
6. Rehearse [cutover and rollback](cutover.md), including actual backups/restore, gateway callbacks, courier webhooks, DNS/TLS, one approved real order and Meta checks when available. Rollback export is a private re-entry aid for up to 5,000 orders within 31 days; it does not restore gateway or courier state automatically.

Phases 21–22 remain in review until this real-store acceptance is completed. No merchant data, live domain, payment account or production infrastructure was changed by these tests.
