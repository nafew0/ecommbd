# Ecomm BD WordPress helper

Run `python3 apps/wp-migrator/package.py` from the repository root, then install `apps/wp-migrator/dist/ecommbd-migrator.zip` through WordPress Plugins. The package includes only the plugin, uninstall script and this README; tests and fixture exports are excluded. The installed plugin needs no Composer packages. PHP needs OpenSSL; WooCommerce must be active.

Only users with `manage_woocommerce` may pair/start/retry/remove exports. Every admin POST checks a WordPress nonce. The plugin reads products and orders using WooCommerce CRUD/controllers (classic or HPOS); it does not modify source data or install an inbound REST route. Customer exports exclude administrators, shop managers and any account with another role or privileged capability.

Pairing comes from the destination migration screen. Use the exact HTTPS source URL, including the selected multisite site's path. TLS verification is always enabled. Tokens and pending chunks are encrypted using the site's WordPress auth salt. Changing salts requires reconnecting. Do not share pairing details or export data.

One cron tick exports/sends a bounded chunk. Continue/retry works when cron is disabled. Failed acknowledgements reuse the saved encrypted body at the same sequence. Export size shrinks when a chunk exceeds the request budget or generation is slow; an oversized single record stops visibly. Re-pair for a complete frozen-source reconciliation; IDs/mappings are reused. The export is not a database snapshot.

Deactivation removes this site's saved state and cron hook; multisite uninstall removes saved state across all sites. Also revoke the token in Ecomm BD. See the repository's [cutover runbook](../../docs/runbooks/cutover.md) and [test report](../../docs/runbooks/migration-test-results.md) for the exact tested versions and remaining acceptance work.
