<?php
/**
 * Plugin Name:          Ecomm BD Migrator
 * Description:          Moves a WooCommerce store to Ecomm BD. It reads your store and sends it to the Ecomm BD store you confirm. It never changes your WordPress data.
 * Version:              0.2.0
 * Requires at least:    5.8
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * WC requires at least: 4.0
 * WC tested up to:      11.2
 * Text Domain:          ecommbd-migrator
 * Domain Path:          /languages
 *
 * How it works, in short:
 * - The merchant pastes pairing details from Ecomm BD and confirms the destination store's address.
 * - The helper reads the store with WooCommerce's own APIs (classic and HPOS order storage).
 * - It PUSHES signed chunks to that one destination over HTTPS. It opens no inbound routes:
 *   nothing on this site accepts requests from Ecomm BD.
 *
 * Files:
 * - includes/class-ecommbd-migrator.php           constants, hooks, saved state, clean-up
 * - includes/class-ecommbd-migrator-admin.php     the WooCommerce → Move to Ecomm BD page
 * - includes/class-ecommbd-migrator-uploader.php  pairing, the upload loop, signing, retries
 * - includes/class-ecommbd-migrator-exporter.php  read-only exporters and what is never exported
 * - includes/class-ecommbd-migrator-budget.php    time and memory budget for one run
 * - includes/class-ecommbd-migrator-lock.php      the atomic "one upload at a time" lock
 * - includes/class-ecommbd-migrator-crypto.php    encryption of the token and the pending chunk
 * - includes/class-ecommbd-migrator-i18n.php      English and Bangla text
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

define( 'ECOMMBD_MIGRATOR_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-ecommbd-migrator.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-i18n.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-crypto.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-lock.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-budget.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-exporter.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-uploader.php';
require_once __DIR__ . '/includes/class-ecommbd-migrator-admin.php';

EcommBD_Migrator::boot();

// Deactivating the helper forgets this site's saved connection, so a forgotten plugin holds no token.
register_deactivation_hook( __FILE__, array( 'EcommBD_Migrator', 'remove_site_state' ) );
