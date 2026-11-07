#!/usr/bin/env bash
# Tests the WordPress helper in disposable Docker sites. Run from anywhere:
#
#   apps/wp-migrator/tests/run.sh
#
# What it does:
#   1. builds the plugin ZIP (package.py) and installs that ZIP, so the package itself is tested;
#   2. checks every PHP file with `php -l` on PHP 7.4 (and on the latest PHP), and checks that
#      every text has a Bangla translation;
#   3. runs fixture.php, security.php, upload.php and metadata.php on:
#        oldest: PHP 7.4, WordPress 5.8, WooCommerce 4.9 (classic order storage)
#        latest: current PHP, WordPress, WooCommerce, once with classic storage, once with HPOS
#   4. fails if WordPress logged any PHP notice, warning or deprecation from the helper.
# Versions are pinned in compose.yml. Needs Docker, and internet the first time (WordPress,
# WooCommerce and the Bangla language pack are downloaded from wordpress.org). Everything is
# deleted at the end. Exits non-zero on the first failure. Not run in CI, on purpose.
set -euo pipefail

tests="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$tests")"
compose=(docker compose -f "$tests/compose.yml")

remove_sites() {
	"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
# Always delete the sites, and keep the exit status of the step that failed.
finish() {
	local status=$?
	remove_sites
	exit "$status"
}
trap finish EXIT

step() {
	printf '\n== %s\n' "$*"
}

step "Build the plugin ZIP"
python3 "$plugin/package.py" | head -1

step "Start the database and the two sites"
remove_sites
"${compose[@]}" up -d --wait db oldest latest

lint='
	php -v | head -1
	find /plugin -name "*.php" -not -path "/plugin/dist/*" | sort | while read -r file; do
		php -l "$file" > /dev/null || { php -l "$file"; exit 1; }
	done
	echo "PHP_SYNTAX_OK"
'
step "Syntax check on PHP 7.4, and the Bangla strings"
"${compose[@]}" exec -T oldest sh -c "$lint php /plugin/tests/strings.php"
step "Syntax check on the latest PHP"
"${compose[@]}" exec -T latest sh -c "$lint"

# One fresh site: install WordPress, WooCommerce, the Bangla language pack and the helper ZIP,
# switch the order storage, then run the tests. Arguments: service, database name, HPOS yes/no.
site() {
	step "$1: database $2, HPOS $3"
	"${compose[@]}" exec -T -e DB="$2" -e HPOS="$3" "$1" sh -eu -c '
		cd /var/www/html
		echo "WordPress $WP_VERSION, WooCommerce $WC_VERSION, $(php -r "echo \"PHP \" . PHP_VERSION;")"
		# Unpacking recent WordPress needs more than the default 128 MB of PHP memory.
		[ -f wp-load.php ] || php -d memory_limit=512M "$(command -v wp)" core download --version="$WP_VERSION" --locale=en_US --quiet
		rm -f wp-config.php
		wp config create --dbname="$DB" --dbuser=root --dbpass=fixture-only --dbhost=db --skip-check --quiet --extra-php <<PHP
define( "WP_DEBUG", true );
define( "WP_DEBUG_LOG", "/tmp/wp-debug.log" );
define( "WP_DEBUG_DISPLAY", false );
PHP
		# The database server has no TLS (it is local and disposable); newer clients ask for it.
		mariadb --host=db --user=root --password=fixture-only --skip-ssl -e "CREATE DATABASE \`$DB\`"
		wp core install --url=https://source.test --title="Ecomm BD fixture" --admin_user=fixture-admin \
			--admin_email=fixture-admin@example.com --admin_password="$(head -c 24 /dev/urandom | base64)" --skip-email --quiet
		wp plugin is-installed woocommerce || wp plugin install woocommerce --version="$WC_VERSION" --quiet
		wp plugin activate woocommerce --quiet
		wp language core install bn_BD --quiet
		wp plugin install /dist/ecommbd-migrator.zip --force --activate --quiet

		# Order storage: HPOS exists from WooCommerce 8; turn it on or off before any order exists.
		wp eval "
			if ( class_exists( \"\\Automattic\\WooCommerce\\Utilities\\OrderUtil\" ) ) {
				update_option( \"woocommerce_custom_orders_table_data_sync_enabled\", \"no\" );
				update_option( \"woocommerce_custom_orders_table_enabled\", \"$HPOS\" );
			}
		"

		# From here on nothing may reach the internet; the tests fake the Ecomm BD destination.
		wp config set WP_HTTP_BLOCK_EXTERNAL true --raw --quiet
		: > /tmp/wp-debug.log

		wp eval-file /tests/fixture.php "hpos=$HPOS"
		wp eval-file /tests/security.php
		wp eval-file /tests/upload.php
		wp eval-file /tests/metadata.php

		if grep -E "ecommbd-migrator|/tests/" /tmp/wp-debug.log; then
			echo "FAIL: PHP notices, warnings or deprecations from the helper (above)"
			exit 1
		fi
		echo "NO_PHP_NOTICES_FROM_HELPER"
	'
}

site oldest wp_oldest no
site latest wp_latest_classic no
site latest wp_latest_hpos yes

step "All WordPress helper tests passed"
