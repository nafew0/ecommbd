<?php
// Runtime assertions against disposable WordPress. No source credentials/hashes are printed.
function ecommbd_assert( $condition, $code ) { if ( ! $condition ) { throw new RuntimeException( $code ); } }
add_filter( 'wp_die_handler', function () { return function () { throw new RuntimeException( 'EXPECTED_DENIAL' ); }; } );
wp_set_current_user( 0 );
foreach ( array( 'page', 'action' ) as $method ) {
    try { EcommBD_Migrator::$method(); throw new RuntimeException( 'UNAUTHORIZED_ALLOWED' ); }
    catch ( RuntimeException $error ) { ecommbd_assert( $error->getMessage() === 'EXPECTED_DENIAL', 'CAPABILITY_GUARD_FAILED' ); }
}
wp_set_current_user( 1 );
try { EcommBD_Migrator::action(); throw new RuntimeException( 'MISSING_NONCE_ALLOWED' ); }
catch ( RuntimeException $error ) { ecommbd_assert( $error->getMessage() === 'EXPECTED_DENIAL', 'NONCE_GUARD_FAILED' ); }
$plain = 'Synthetic secret বাংলা'; $sealed = EcommBD_Migrator::seal( $plain );
ecommbd_assert( strpos( $sealed, $plain ) === false && EcommBD_Migrator::open( $sealed ) === $plain, 'LOCAL_ENCRYPTION_FAILED' );
$bodies = array(); $attempt = 0; $token = 'synthetic-upload-token';
add_filter( 'pre_http_request', function ( $pre, $args, $url ) use ( &$bodies, &$attempt, $token ) {
    ecommbd_assert( $args['sslverify'] === true && $args['redirection'] === 0, 'TLS_OR_REDIRECT_GUARD_FAILED' );
    $body = json_decode( $args['body'], true ); $bodies[] = $args['body']; $headers = $args['headers'];
    $expected = hash_hmac( 'sha256', $headers['X-Woo-Time'] . "\n" . $headers['X-Woo-Nonce'] . "\n" . $body['sequence'] . "\n" . $body['kind'] . "\n" . $body['payload'], $token );
    ecommbd_assert( hash_equals( $expected, $headers['X-Woo-Signature'] ), 'SIGNATURE_MISMATCH' );
    $data = json_decode( $body['payload'], true );
    foreach ( $data['records'] as $customer ) { ecommbd_assert( $customer['id'] !== 1 && $customer['_role'] === 'customer', 'PRIVILEGED_HASH_EXPORTED' ); }
    if ( $attempt++ === 0 ) { return new WP_Error( 'fixture_timeout', 'Synthetic timeout' ); }
    return array( 'headers' => array(), 'body' => wp_json_encode( array( 'accepted' => true, 'nextSequence' => $body['sequence'] + 1 ) ), 'response' => array( 'code' => 201, 'message' => 'Created' ), 'cookies' => array() );
}, 10, 3 );
update_option( EcommBD_Migrator::OPTION, array( 'endpoint' => 'https://example.com/woo-migrate', 'id' => 123, 'token' => EcommBD_Migrator::seal( $token ), 'owner' => 1, 'stage' => 3, 'offset' => 0, 'size' => 50, 'sequence' => 0, 'counts' => array_fill_keys( EcommBD_Migrator::STAGES, 0 ), 'pending' => null ), false );
do_action( 'ecommbd_migrate_tick' );
$paused = get_option( EcommBD_Migrator::OPTION );
ecommbd_assert( ! empty( $paused['pending'] ) && $paused['sequence'] === 0 && strpos( $paused['error'], 'NETWORK_OR_TLS' ) !== false, 'CHECKPOINT_OR_VISIBLE_CRON_ERROR_LOST' );
EcommBD_Migrator::tick();
$done = get_option( EcommBD_Migrator::OPTION );
ecommbd_assert( $done['sequence'] === 1 && $done['pending'] === null && $bodies[0] === $bodies[1], 'RETRY_CHANGED_PAYLOAD' );
EcommBD_Migrator::remove();
ecommbd_assert( ! get_option( EcommBD_Migrator::OPTION ) && ! wp_next_scheduled( 'ecommbd_migrate_tick' ), 'CLEANUP_FAILED' );
echo 'HELPER_SECURITY_AND_RETRY_OK' . PHP_EOL;
