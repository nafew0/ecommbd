<?php
/**
 * Runs when the plugin is deleted in WordPress: removes everything it stored, on every site of a
 * multisite network (state, lock, cron event and the 0.1.0 transient).
 *
 * Revoking the upload token on the Ecomm BD side is a separate step in the Ecomm BD admin.
 *
 * @package EcommBD_Migrator
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Only defines the class; it has no side effects, so the plugin does not need to be active.
require_once __DIR__ . '/includes/class-ecommbd-migrator.php';

if ( is_multisite() ) {
	$ecommbd_migrator_offset = 0;
	do {
		$ecommbd_migrator_sites = get_sites(
			array(
				'fields' => 'ids',
				'number' => 100,
				'offset' => $ecommbd_migrator_offset,
			)
		);
		foreach ( $ecommbd_migrator_sites as $ecommbd_migrator_site ) {
			switch_to_blog( $ecommbd_migrator_site );
			EcommBD_Migrator::remove_site_state();
			restore_current_blog();
		}
		$ecommbd_migrator_count   = count( $ecommbd_migrator_sites );
		$ecommbd_migrator_offset += $ecommbd_migrator_count;
	} while ( 100 === $ecommbd_migrator_count );
} else {
	EcommBD_Migrator::remove_site_state();
}
