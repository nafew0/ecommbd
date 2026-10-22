<?php
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
function ecommbd_remove_site_state() {
    wp_clear_scheduled_hook( 'ecommbd_migrate_tick' );
    delete_option( 'ecommbd_migration' );
    delete_transient( 'ecommbd_export_lock' );
}
if ( is_multisite() ) {
    $offset = 0;
    do {
        $sites = get_sites( array( 'fields' => 'ids', 'number' => 100, 'offset' => $offset ) );
        foreach ( $sites as $site ) { switch_to_blog( $site ); ecommbd_remove_site_state(); restore_current_blog(); }
        $offset += count( $sites );
    } while ( count( $sites ) === 100 );
} else { ecommbd_remove_site_state(); }
