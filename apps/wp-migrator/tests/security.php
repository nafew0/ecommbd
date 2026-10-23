<?php
/**
 * Guards, destination confirmation, the lock, signing, retries and clean-up.
 *
 * Run after fixture.php: wp eval-file tests/security.php
 * No credential or hash is printed.
 *
 * @package EcommBD_Migrator
 */

require_once __DIR__ . '/support.php';

$denials = array();
add_filter(
	'wp_die_handler',
	static function () use ( &$denials ) {
		return static function ( $message ) use ( &$denials ) {
			$denials[] = is_string( $message ) ? $message : '';
			throw new RuntimeException( 'EXPECTED_DENIAL' );
		};
	}
);

/**
 * Runs a callback that must stop with wp_die().
 *
 * @param callable $callback Callback.
 * @param string   $code     Failure code if it did not stop.
 * @return void
 */
function ecommbd_expect_denial( $callback, $code ) {
	try {
		call_user_func( $callback );
	} catch ( RuntimeException $error ) {
		ecommbd_test_assert( 'EXPECTED_DENIAL' === $error->getMessage(), $code );
		return;
	}
	throw new RuntimeException( $code );
}

// 1. Capability and nonce on every entry point, with a bilingual refusal.
wp_set_current_user( 0 );
ecommbd_expect_denial( array( 'EcommBD_Migrator_Admin', 'render_page' ), 'PAGE_CAPABILITY_GUARD_FAILED' );
ecommbd_expect_denial( array( 'EcommBD_Migrator_Admin', 'handle_action' ), 'ACTION_CAPABILITY_GUARD_FAILED' );
ecommbd_test_assert( false !== strpos( end( $denials ), 'not allowed to move this store' ), 'ENGLISH_DENIAL_MISSING' );
ecommbd_test_assert( switch_to_locale( 'bn_BD' ), 'BANGLA_LANGUAGE_PACK_MISSING' );
ecommbd_expect_denial( array( 'EcommBD_Migrator_Admin', 'handle_action' ), 'ACTION_CAPABILITY_GUARD_FAILED' );
restore_previous_locale();
ecommbd_test_assert( false !== strpos( end( $denials ), 'অনুমতি আপনার নেই' ), 'BANGLA_DENIAL_MISSING' );

wp_set_current_user( 1 );
ecommbd_test_post( array( 'operation' => 'resume' ), '' );
ecommbd_expect_denial( array( 'EcommBD_Migrator_Admin', 'handle_action' ), 'ACTION_NONCE_GUARD_FAILED' );
ecommbd_test_post(
	array(
		'ecommbd_review' => '1',
		'pairing'        => ecommbd_test_pairing(),
	),
	''
);
ecommbd_expect_denial( array( 'EcommBD_Migrator_Admin', 'render_page' ), 'REVIEW_NONCE_GUARD_FAILED' );
$_POST    = array();
$_REQUEST = array();

// 2. Local encryption of the token and pending chunk.
$plain  = 'Synthetic secret বাংলা';
$sealed = EcommBD_Migrator_Crypto::seal( $plain );
ecommbd_test_assert( false === strpos( $sealed, $plain ) && EcommBD_Migrator_Crypto::open( $sealed ) === $plain, 'LOCAL_ENCRYPTION_FAILED' );

// 3. Destination confirmation: nothing is contacted before the merchant confirms the host.
$token       = bin2hex( random_bytes( 32 ) );
$destination = new EcommBD_Test_Destination( $token );
EcommBD_Migrator::remove_site_state();

ecommbd_test_post(
	array(
		'ecommbd_review' => '1',
		'pairing'        => ecommbd_test_pairing(),
	),
	EcommBD_Migrator_Admin::REVIEW_NONCE
);
ob_start();
EcommBD_Migrator_Admin::render_page();
$html = ob_get_clean();
ecommbd_test_assert( false !== strpos( $html, '<code dir="ltr">' . ECOMMBD_TEST_HOST . '</code>' ) && false !== strpos( $html, 'Check where your store data will go' ), 'DESTINATION_NOT_SHOWN' );
ecommbd_test_assert( false !== strpos( $html, 'name="confirm_destination" value="1" required' ), 'CONFIRM_BOX_MISSING' );
ecommbd_test_assert( 0 === $destination->pairs && null === EcommBD_Migrator::get_state(), 'REVIEW_CONTACTED_DESTINATION' );

ecommbd_test_post(
	array(
		'operation'    => 'pair',
		'pairing'      => ecommbd_test_pairing(),
		'confirm_host' => ECOMMBD_TEST_HOST,
	),
	EcommBD_Migrator_Admin::ACTION
);
$location = ecommbd_test_action();
ecommbd_test_assert( false !== strpos( $location, 'ecommbd-error=CONFIRM_DESTINATION' ) && 0 === $destination->pairs, 'UNCONFIRMED_PAIRING_ALLOWED' );

ecommbd_test_post(
	array(
		'operation'           => 'pair',
		'pairing'             => ecommbd_test_pairing(),
		'confirm_destination' => '1',
		'confirm_host'        => 'other-store.test',
	),
	EcommBD_Migrator_Admin::ACTION
);
$location = ecommbd_test_action();
ecommbd_test_assert( false !== strpos( $location, 'ecommbd-error=DESTINATION_CHANGED' ) && 0 === $destination->pairs, 'WRONG_HOST_PAIRING_ALLOWED' );

foreach ( array( 'http://shop.ecommbd.test/woo-migrate', 'https://user:pass@shop.ecommbd.test/woo-migrate', 'https://xn--shp-qla.test/woo-migrate?x=1', 'https://shöp.test/woo-migrate' ) as $bad_endpoint ) {
	try {
		EcommBD_Migrator_Uploader::parse_pairing(
			wp_json_encode(
				array(
					'endpoint' => $bad_endpoint,
					'code'     => '7.' . str_repeat( 'ab', 32 ),
				)
			)
		);
		throw new RuntimeException( 'UNSAFE_ENDPOINT_ACCEPTED' );
	} catch ( RuntimeException $error ) {
		ecommbd_test_assert( in_array( $error->getMessage(), array( 'HTTPS_REQUIRED', 'INVALID_PAIRING' ), true ), 'UNSAFE_ENDPOINT_ACCEPTED' );
	}
}

// A state saved without confirmation (as 0.1.0 saved it) sends nothing until confirmed.
$unconfirmed = ecommbd_test_state( $token, array( 'stage' => 3 ) );
unset( $unconfirmed['host'], $unconfirmed['confirmed_at'], $unconfirmed['confirmed_by'] );
EcommBD_Migrator::save_state( $unconfirmed );
ecommbd_test_assert( 'paused' === EcommBD_Migrator_Uploader::run() && 0 === count( $destination->requests ), 'UNCONFIRMED_STATE_UPLOADED' );
ecommbd_test_assert( 'DESTINATION_NOT_CONFIRMED' === EcommBD_Migrator::get_state()['error'], 'UNCONFIRMED_ERROR_NOT_SHOWN' );
ob_start();
EcommBD_Migrator_Admin::render_page();
$html = ob_get_clean();
ecommbd_test_assert( false !== strpos( $html, 'name="operation" value="confirm"' ) && false !== strpos( $html, ECOMMBD_TEST_HOST ), 'SAVED_STATE_CONFIRMATION_MISSING' );
ecommbd_test_post(
	array(
		'operation'           => 'confirm',
		'confirm_destination' => '1',
		'confirm_host'        => ECOMMBD_TEST_HOST,
	),
	EcommBD_Migrator_Admin::ACTION
);
$location  = ecommbd_test_action();
$confirmed = EcommBD_Migrator::get_state();
ecommbd_test_assert( ECOMMBD_TEST_HOST === $confirmed['host'] && 1 === $confirmed['confirmed_by'] && count( $destination->requests ) > 0, 'SAVED_STATE_CONFIRMATION_FAILED' );
$destination->stop();

// Confirmed pairing: one /pair request, then the upload runs in the same click, to the end.
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_post(
	array(
		'operation'           => 'pair',
		'pairing'             => ecommbd_test_pairing(),
		'confirm_destination' => '1',
		'confirm_host'        => ECOMMBD_TEST_HOST,
	),
	EcommBD_Migrator_Admin::ACTION
);
$location = ecommbd_test_action();
$state    = EcommBD_Migrator::get_state();
ecommbd_test_assert( 1 === $destination->pairs && ECOMMBD_TEST_HOST === $state['host'] && 1 === $state['confirmed_by'] && 1 === $state['owner'], 'CONFIRMED_PAIRING_FAILED' );
ecommbd_test_assert( false !== strpos( $location, 'ecommbd-result=done' ) && ! empty( $state['done'] ) && ! isset( $state['token'] ), 'FIRST_UPLOAD_NOT_COMPLETE' );
$last = end( $destination->requests );
ecommbd_test_assert( 'finish' === $last['kind'], 'FINISH_NOT_SENT' );
$manifest = json_decode( json_decode( $last['body'], true )['payload'], true )['manifest'];
foreach ( EcommBD_Migrator::STAGES as $kind ) {
	$sent = isset( $destination->counts[ $kind ] ) ? $destination->counts[ $kind ] : 0;
	ecommbd_test_assert( $manifest['counts'][ $kind ] === $sent, 'MANIFEST_COUNT_MISMATCH' );
}
$destination->stop();

// 4. TLS checks stay on and redirects off, even if another plugin switches them off for all.
$hostile_args = static function ( $request_args ) {
	$request_args['sslverify']   = false;
	$request_args['redirection'] = 5;
	return $request_args;
};
add_filter( 'http_request_args', $hostile_args );
add_filter( 'https_ssl_verify', '__return_false' );

// 5. A timeout keeps the encrypted pending chunk; the retry resends the same bytes. A lost
// acknowledgement is resent unchanged and accepted again.
$destination       = new EcommBD_Test_Destination( $token );
$destination->fail = array( 'timeout' );
ecommbd_test_state( $token, array( 'stage' => 3 ) );
do_action( EcommBD_Migrator::CRON_HOOK );
$paused = EcommBD_Migrator::get_state();
ecommbd_test_assert( ! empty( $paused['pending'] ) && 0 === $paused['sequence'] && 'NETWORK_OR_TLS' === $paused['error'], 'CHECKPOINT_OR_VISIBLE_CRON_ERROR_LOST' );
ecommbd_test_assert( false === strpos( $paused['pending'], 'customers' ) && false === strpos( $paused['pending'], '$P$' ), 'PENDING_CHUNK_NOT_ENCRYPTED' );
$retry_at = wp_next_scheduled( EcommBD_Migrator::CRON_HOOK );
ecommbd_test_assert( false !== $retry_at && $retry_at > time() + 30 && 1 === $paused['retries'], 'NETWORK_RETRY_NOT_SCHEDULED' );
$destination->fail = array( 'lost_ack' );
ecommbd_test_assert( 'paused' === EcommBD_Migrator_Uploader::run(), 'LOST_ACK_NOT_PAUSED' );
ecommbd_test_assert( 'more' === EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 1, '-1', microtime( true ) - 10 ) ), 'RESUME_FAILED' );
$after = EcommBD_Migrator::get_state();
ecommbd_test_assert( 1 === $after['sequence'] && null === $after['pending'] && ! isset( $after['error'] ), 'RESUME_CHECKPOINT_WRONG' );
ecommbd_test_assert( $destination->requests[0]['body'] === $destination->requests[1]['body'] && $destination->requests[1]['body'] === $destination->requests[2]['body'], 'RETRY_CHANGED_PAYLOAD' );
$destination->stop();
remove_filter( 'http_request_args', $hostile_args );
remove_filter( 'https_ssl_verify', '__return_false' );

// 6. The lock: atomic, ignores a stale cache, only the holder releases it, an expired one is
// taken over, and a run that lost it never writes the state back.
global $wpdb;
EcommBD_Migrator::remove_site_state();
$lock = EcommBD_Migrator_Lock::acquire( 60 );
ecommbd_test_assert( is_string( $lock ) && false === EcommBD_Migrator_Lock::acquire( 60 ), 'LOCK_NOT_EXCLUSIVE' );
wp_cache_set( 'notoptions', array( EcommBD_Migrator::LOCK_OPTION => true ), 'options' );
ecommbd_test_assert( false === EcommBD_Migrator_Lock::acquire( 60 ), 'LOCK_TRUSTED_THE_CACHE' );
EcommBD_Migrator_Lock::release( 'not-the-holder' );
ecommbd_test_assert( false === EcommBD_Migrator_Lock::acquire( 60 ), 'LOCK_RELEASED_BY_OTHER' );
ecommbd_test_assert( EcommBD_Migrator_Lock::refresh( $lock, 60 ) && ! EcommBD_Migrator_Lock::refresh( 'not-the-holder', 60 ), 'LOCK_REFRESH_WRONG' );

$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state( $token, array( 'stage' => 3 ) );
$lock = EcommBD_Migrator_Lock::acquire( 60 );
ecommbd_test_assert( 'busy' === EcommBD_Migrator_Uploader::run() && 0 === count( $destination->requests ), 'RAN_WHILE_LOCKED' );
EcommBD_Migrator_Lock::release( $lock );

$wpdb->query( $wpdb->prepare( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", EcommBD_Migrator::LOCK_OPTION, 'dead-request:' . ( time() - 5 ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
ecommbd_test_assert( 'busy' !== EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 1, '-1', microtime( true ) - 10 ) ) && 1 === count( $destination->requests ), 'EXPIRED_LOCK_NOT_TAKEN_OVER' );

// "Remove saved connection" while a chunk is in flight: the run must not bring the state back.
$destination->before_reply = static function () {
	EcommBD_Migrator::remove_site_state();
};
ecommbd_test_assert( 'busy' === EcommBD_Migrator_Uploader::run() && null === EcommBD_Migrator::get_state(), 'REMOVED_STATE_CAME_BACK' );
$destination->stop();

// 7. Clean-up removes the state, the lock, the cron event and the 0.1.0 transient.
ecommbd_test_state( $token );
EcommBD_Migrator_Uploader::schedule( 0 );
set_transient( EcommBD_Migrator::LEGACY_LOCK_TRANSIENT, 1, 60 );
EcommBD_Migrator_Lock::acquire( 60 );
EcommBD_Migrator::remove_site_state();
$lock_row = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", EcommBD_Migrator::LOCK_OPTION ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
ecommbd_test_assert( null === EcommBD_Migrator::get_state() && null === $lock_row && ! wp_next_scheduled( EcommBD_Migrator::CRON_HOOK ) && ! get_transient( EcommBD_Migrator::LEGACY_LOCK_TRANSIENT ), 'CLEANUP_FAILED' );

echo 'HELPER_SECURITY_AND_RETRY_OK' . PHP_EOL;
