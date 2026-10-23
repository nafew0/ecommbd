# Phases 21–22: what was tested

First run 2026-10-22; updated 2026-10-23 after the review fixes · branch `solcodex` · local test machines, made-up data only

This page says what the WooCommerce migration (phases 21 and 22) was tested with, and what still has to be tested on a real merchant's store. Passing here is not permission to move a merchant's domain: that needs the rehearsal at the end of this page.

## Automated checks

Run on 2026-10-23, after the review fixes.

| Check | Result | What it covers |
| --- | --- | --- |
| Lint, type checks, formatting | Pass | The whole repository |
| Unit tests | All pass (shared 402, core 149, storefront 67, admin 53, sections 79, bd-geo 51) | Money and address rules, slugs, page sizes, reserved addresses, hash limits, the import-time estimate, the "importing" mark, notes paging, signed uploads, WordPress password formats, the migration screens' formatting and that every importer code has a message |
| Core end-to-end tests | All pass: 269 tests in 23 files (102 s, four files at a time) | A real Vendure and PostgreSQL. The two migration files: `woo-migration.e2e-spec.ts` (11 tests: both import methods, repeat imports, pairing, passwords, coupons, cleanup) and `woo-migration-urls.e2e-spec.ts` (8 tests: the review fixes below) |
| Browser tests (Playwright) | All pass: 161 passed, 63 skipped by design (device-specific cases run on one of the two projects), 5.8 minutes | Desktop and phone, English and Bangla. The migration screens, real storefront redirects and the rest of the store |
| WordPress plugin (`apps/wp-migrator/tests/run.sh`) | Pass on all three sites | See the next section |
| Speed suite (`npm run test:speed`) | Pass | Phase 17's cache, including the purge-all and warm-up after an import |

### What the review-fix tests prove

`apps/core/test/e2e/woo-migration-urls.e2e-spec.ts`, against a small store with a Bangla product and category:

- A Bangla product keeps its address: `/product/লাল-শার্ট/`, not `/product/e0a6b2…/`. Its old `?p=` and `?product=` links and its category's old address point at the new ones.
- A product link without a trailing slash (WordPress `/%postname%`) imports, and needs no rule.
- The old host "goes down" during the products: the run stops at that product, skipping nothing, and a resume finishes the import with no duplicates.
- One product whose variations can't be read is skipped with an issue while the rest imports; a variation with no price is left out with a warning; a category whose parent is missing goes to the top level with an issue.
- On a fresh store whose highest WooCommerce order number is 5000, our next order number is 5001.
- WordPress pages go to our page with the same address (or need no rule when the address is the same); a rule can't claim the home page or the sitemap.
- A rule saved by staff survives a re-import and can be deleted; a rule saved for one of our live pages doesn't re-point other old links.
- The missing-pages list ignores `/wp-login.php`, records `/t-shirts/`, and makes room when it holds 5,000 paths.

`woo-migration.e2e-spec.ts` also checks that revoking the helper deletes its upload at once, that the customers' password hashes are gone from the uploaded data after an import, and that a used coupon comes over with the uses it has left.

### Not covered by automated tests

- **Image downloads.** The test stores have no images: the download checks (approved hosts, no private addresses, size and type) are tested in `packages/shared` and phase 09, not through a whole import.
- **A real WooCommerce REST API.** The REST tests answer from fixtures. The WordPress plugin, below, runs against real WordPress and WooCommerce.
- **The one-hour target** for 500 products and 20,000 orders on a real host. The local benchmark (`apps/core/vitest.migration-bench.config.mts`) took 96 seconds through the helper path with no images and no network: it says the importer itself isn't the slow part, nothing more.

## WordPress plugin

`apps/wp-migrator/tests/run.sh` starts WordPress and WooCommerce in Docker, installs the plugin and runs its checks. It passed on:

| PHP | WordPress | WooCommerce | Order storage |
| --- | --- | --- | --- |
| 7.4.32 | 5.8.3 | 4.9.5 | Classic |
| 8.5.12 | 7.1.3 | 11.2.1 | Classic |
| 8.5.12 | 7.1.3 | 11.2.1 | HPOS |

On each: every plugin file passes `php -l` on PHP 7.4; all 62 texts have Bangla; capability and nonce checks; no administrator's hash, courier key or secret-looking order data is exported; nothing is sent before the merchant confirms the destination; a resend after a timeout is byte-for-byte the same; the lock holds; time and memory budgets stop a run; one run sends many chunks and the size grows back (300 tags went in chunks of 2, 4, 8, 16, 32, 64, 100 and 74). These are scripts run with WP-CLI, not a PHPUnit suite, and they are not in CI. Other versions between the oldest and the latest, multisite networks and real security plugins were not tried.

## Fixed after the first run

- 2026-10-22, found by the first tests: Vendure updates given string IDs, moving categories in the tree, JSON key order breaking sample comparisons, and stale history after an import.
- 2026-10-23, found by the review: Bangla slugs, trailing slashes, old pages taking over store pages, one bad record stopping resumes, the order-number hand-over, the "importing" mark, password hashes outliving a revoked pairing, used coupons, and the WordPress plugin's speed, secrets and readability. See the CHANGELOG.

## Reproduce

Use a throwaway database and the usual local PostgreSQL and Redis. Never run the fixture scripts against a merchant's database.

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:browser
apps/wp-migrator/tests/run.sh
```

For the browser tests, set `DB_NAME` to the same throwaway database as the running core (the checkout test reads its SMS codes from it), and use spare ports (see README). Build the installable plugin with `python3 apps/wp-migrator/package.py`; it leaves out the tests.

## Still to do with a real store

1. **Rehearse on an authorized copy of the pilot store**: its real product types, custom fields, SEO and permalink plugins, order statuses, images and totals. The roadmap's 3–5 real BD stores are still needed.
2. **Check the old host's limits and protected images.** The helper sends image addresses, not the images: images behind a login or a firewall show as issues and may need an allowed host.
3. **Review what didn't come over**: unsupported coupons, plugin features, pages that went to the home page. Freeze the old store for the final sync: an export is not a database snapshot.
4. **Phase 20 isn't built yet**, so the Pixel ID is kept for review, not put into Meta settings.
5. **Crawl the old sitemap against staging** until it finds no missing pages and no chains. The crawler checks up to 20 sitemap files and 2,000 addresses per run and says when it stopped early.
6. **Rehearse the [cutover and rollback](cutover.md)**: backups and a restore, payment callbacks, courier webhooks, DNS and TLS, one approved real order.

Phases 21–22 stay in Review until this is done. No merchant data, live domain, payment account or server was touched by these tests.
