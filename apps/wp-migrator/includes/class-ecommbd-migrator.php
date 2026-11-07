<?php
/**
 * Constants, hooks, the saved state and clean-up.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Wires the helper into WordPress and owns the saved migration state.
 *
 * The state is one option (`ecommbd_migration`, never autoloaded) holding:
 * - endpoint, host, confirmed_by, confirmed_at: where the data goes and who confirmed it;
 * - id, token: the upload pairing (the token is encrypted, see EcommBD_Migrator_Crypto);
 * - owner: the user whose `manage_woocommerce` capability is re-checked on every run;
 * - stage, offset, size, sequence, counts: the checkpoint the destination acknowledged;
 * - pending: the encrypted chunk that was built but not yet acknowledged;
 * - error, retries, last_activity, done: what the admin page shows.
 */
final class EcommBD_Migrator {

	/**
	 * Plugin version.
	 */
	const VERSION = '0.3.0';

	/**
	 * Option that holds the saved migration state.
	 */
	const OPTION = 'ecommbd_migration';

	/**
	 * Option row used as the atomic lock (see EcommBD_Migrator_Lock).
	 */
	const LOCK_OPTION = 'ecommbd_migration_lock';

	/**
	 * Transient lock used by version 0.1.0. Only removed now, never used.
	 */
	const LEGACY_LOCK_TRANSIENT = 'ecommbd_export_lock';

	/**
	 * WP-Cron hook that runs the upload loop in the background.
	 */
	const CRON_HOOK = 'ecommbd_migrate_tick';

	/**
	 * Capability needed to see the page, start, continue or remove an upload.
	 */
	const CAPABILITY = 'manage_woocommerce';

	/**
	 * Export stages in the order the destination expects them. A final `finish` chunk follows.
	 * Must match HELPER_STAGES in apps/core/src/plugins/woo-import/helper.service.ts.
	 */
	const STAGES = array( 'categories', 'tags', 'products', 'customers', 'orders', 'coupons', 'reviews', 'settings' );

	/**
	 * Registers every hook the helper uses.
	 *
	 * @return void
	 */
	public static function boot() {
		EcommBD_Migrator_I18n::boot();
		EcommBD_Migrator_Admin::boot();
		add_action( self::CRON_HOOK, array( 'EcommBD_Migrator_Uploader', 'run_from_cron' ) );
		add_action( EcommBD_Migrator_File::CRON_HOOK, array( 'EcommBD_Migrator_File', 'run_from_cron' ) );
		add_action( 'before_woocommerce_init', array( __CLASS__, 'declare_hpos_compatibility' ) );
	}

	/**
	 * Tells WooCommerce the helper works with HPOS (custom order tables).
	 *
	 * Orders are only read through wc_get_orders() and WooCommerce's REST controllers, never from
	 * the posts table, so both storage modes give the same export.
	 *
	 * @return void
	 */
	public static function declare_hpos_compatibility() {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', ECOMMBD_MIGRATOR_FILE, true );
		}
	}

	/**
	 * Whether a supported WooCommerce (4.0 or later) is active.
	 *
	 * @return bool
	 */
	public static function woocommerce_ready() {
		return class_exists( 'WooCommerce' ) && defined( 'WC_VERSION' ) && version_compare( WC_VERSION, '4.0', '>=' );
	}

	/**
	 * Reads the saved state straight from the database.
	 *
	 * Another request (cron or an admin click) may have changed it since this request first read
	 * it, so the in-memory option cache is dropped first.
	 *
	 * @return array|null The state, or null when nothing is paired.
	 */
	public static function get_state() {
		$notoptions = wp_cache_get( 'notoptions', 'options' );
		if ( is_array( $notoptions ) && isset( $notoptions[ self::OPTION ] ) ) {
			unset( $notoptions[ self::OPTION ] );
			wp_cache_set( 'notoptions', $notoptions, 'options' );
		}
		wp_cache_delete( self::OPTION, 'options' );

		$state = get_option( self::OPTION );

		return is_array( $state ) ? $state : null;
	}

	/**
	 * Saves the state. It is never autoloaded: it can hold a large encrypted chunk.
	 *
	 * @param array $state The state to save.
	 * @return void
	 */
	public static function save_state( array $state ) {
		update_option( self::OPTION, $state, false );
	}

	/**
	 * Deactivation: forgets the connection and deletes the export file.
	 *
	 * @return void
	 */
	public static function deactivate() {
		self::remove_site_state();
		EcommBD_Migrator_File::remove();
	}

	/**
	 * Removes everything this site stored: state, lock, cron event and the 0.1.0 transient.
	 *
	 * Used by "Remove saved connection", deactivation and uninstall. An export file is separate
	 * (EcommBD_Migrator_File::remove()): removing the connection keeps a file being downloaded.
	 *
	 * @return void
	 */
	public static function remove_site_state() {
		wp_clear_scheduled_hook( self::CRON_HOOK );
		delete_option( self::OPTION );
		delete_option( self::LOCK_OPTION );
		delete_transient( self::LEGACY_LOCK_TRANSIENT );
	}
}
