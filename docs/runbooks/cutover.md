# WooCommerce cutover — assisted pilot

Use the Phase 21/22 testing report and migration checklist first. A green synthetic test is not permission to move a merchant's live domain. The merchant approves the cutover window after the rehearsal and exclusions have been reviewed.

## Rehearsal and preparation

1. Record source/destination versions, authorized operator, backup locations and agreed downtime. Scan a compromised source for malware. Keep exported HTML untrusted; never copy executable theme/plugin code.
2. Back up source DB/files and destination DB/assets. Restore a rehearsal copy and prove the restore works. Install the helper on the selected site only; the target is PHP 7.4+, WP 5.8+, WooCommerce 4+. Consult the test report for the versions actually exercised.
3. Configure the same `WOO_IMPORT_KEYS` on core server and worker. Use the actual HTTPS public store URL as `STOREFRONT_URL` (or explicitly set `WOO_PUBLIC_URL` for the public helper endpoint); reverse-proxy `/woo-migrate` to core alongside the API. Keep TLS certificate verification enabled. Never use an arbitrary pairing string supplied by someone else.
4. Build the helper with `python3 apps/wp-migrator/package.py`, install/activate `apps/wp-migrator/dist/ecommbd-migrator.zip` in WordPress, and create pairing details in the migration screen. Paste them under WooCommerce → Move to Ecomm BD, press "Check pairing details", and confirm the destination store address it shows is ours before pairing: the plugin sends nothing until it's confirmed. Codes expire in one hour; upload tokens last seven days. The helper exposes no inbound route. If cron is disabled, use "Continue now", which sends as much as the host's time limit allows in one go; a failed request keeps the encrypted pending chunk, retries by itself three times, and shows an error on the helper page.
5. Complete the upload, dry run, resolve exclusions and import. Compare counts, exact gross totals by currency/month, random order snapshots, image readiness and actual shopper URLs. Customer password tests must use authorized test accounts. Supported coupons are imported; restricted/previously-used coupons require review instead of broader eligibility.
6. Inspect SEO, custom product/category bases, nested categories, attachment/query URLs and imported redirects. A WordPress page goes to our page with the same address when there is one (a content page or a policy page), otherwise to the home page: map the rest by hand on the cutover screen. Rules you save there are marked as yours, and the final sync never overwrites them. Delete a wrong rule there too. The store's own pages always win: a rule for an address the new store already answers (say `/privacy-policy/`) is never used.
7. Run the sitemap checker against the rehearsal storefront. It checks at most 20 sitemap documents and 2,000 URLs per run; a truncated result is not a complete pass. Upload a smaller sitemap or split large ones. Investigate every non-200 result and redirect chain.
8. Lower DNS TTL at least 24 hours before the agreed window. Prepare destination SSL/subdomain, Search Console ownership and Meta domain verification. Record old values for rollback.

## Freeze and final reconciliation

1. Stop new source checkouts and staff edits through the host's maintenance rules. Keep authorized admin/cron access available for export. Drain in-flight gateway callbacks and courier/status updates; otherwise the source is still changing. Record the freeze timestamp and last source order number.
2. Create a fresh helper pairing for the **same source URL**, re-upload the complete frozen dataset, run a fresh dry run and then reconcile. It reuses source mappings rather than creating duplicate catalog/customers/orders. The final pass rereads child notes/refunds too.
3. Verify zero count mismatches, exact totals/samples, approved exclusions and ready images. Check destination stock against the frozen source. Convert reviewed recent unpaid COD orders only after the final sync, choosing whether Woo had already deducted their stock. Paid/complex orders stay in legacy history and need an explicit fulfillment handover.
4. Update SSLCommerz/bKash callback and IPN addresses in the merchant panels, courier webhook URLs, email/SMS configuration, and Meta domain settings. Test payment success/failure/callback verification on the correct merchant credentials. These panel changes are manual; the checklist does not perform them.
5. Confirm a rollback owner and that new destination orders can be exported/re-entered. Switch DNS only after merchant approval. Do not reopen source checkout while destination takes orders.

## After the switch

- Place a small real order with the merchant's approval. Verify payment, one SMS, stock, courier handoff and Meta deduplication; inspect the admin queue and customer confirmation.
- Crawl the old sitemap again on the live destination. Check missing-URL counters and correct mappings to final pages. Monitor 404s, payment callbacks, checkout failures and duplicate orders closely during the first day.
- Compare new orders against gateway/courier records daily during the initial period. Keep the old store read-only and backed up for **30 days**.
- Finish migration in admin: this deletes saved source consumer keys, revokes helper upload tokens and removes uploaded chunks. (Revoking or re-pairing the helper deletes its upload at once, and after each import the customers' WordPress hashes are already dropped from it.) Revoke REST keys in WooCommerce, remove the helper and securely delete temporary exports. Unused legacy password hashes expire after twelve months; a successful first login rehashes/deletes them immediately. Password reset replaces the legacy reference and cannot fall back to the old password.

## Rollback

1. Stop destination checkout first. Record its stop timestamp and export every new order since the cutover timestamp, including original number, items, address, payment status/transaction references, stock reservations and courier bookings. Treat the export as private customer data.
2. Reconcile settled payments and callbacks with gateways before re-entry. Never collect an already-paid order again. Decide which courier bookings stay live; avoid duplicate labels/shipments.
3. Restore DNS and gateway/courier callbacks to the recorded old values. Re-enter destination orders in the old store with their original references and correct reservation/payment state; compare the resulting inventory and counts.
4. Reopen exactly one checkout after reconciliation. Preserve destination DB/assets/logs for investigation. Record cause, missed orders and the next rehearsal changes.
