# Synthetic WooCommerce fixtures

`wordpress-export.json` was derived from a disposable WordPress 7.1.3 / WooCommerce 11.2.1 fixture built by `apps/wp-migrator/tests/fixture.php`. Customer names, emails, phones, addresses, notes and transaction references were explicitly replaced with synthetic values. Passwords, tokens and arbitrary source secrets are absent. Tests generate password hashes at runtime.

`class-phpass.php` is the public-domain WordPress portable phpass reference implementation, copied from the same disposable installation. Its original attribution is retained; the upstream reference is <https://github.com/WordPress/WordPress/blob/master/wp-includes/class-phpass.php>. The password tests call it with PHP to produce independent `$P$`/`$H$` test vectors.

No merchant/customer export belongs in this directory. Real rehearsal data stays in the operator's private staging environment.
