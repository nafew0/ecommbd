<?php
/**
 * Shared helpers for the runtime tests. Loaded by the other test files through `wp eval-file`.
 *
 * Run only against the disposable WordPress that tests/run.sh creates. Nothing is sent over the
 * network: a pre_http_request filter plays the Ecomm BD destination and applies the same rules
 * as apps/core/src/plugins/woo-import/helper.service.ts (signature, sequence, record and size
 * limits, identical resend of an accepted chunk).
 *
 * @package EcommBD_Migrator
 */

if ( defined( 'ECOMMBD_TEST_ENDPOINT' ) ) {
	return;
}

/**
 * The fake destination's endpoint; its host is what the merchant confirms.
 */
const ECOMMBD_TEST_ENDPOINT = 'https://shop.ecommbd.test/woo-migrate';

/**
 * The fake destination's host.
 */
const ECOMMBD_TEST_HOST = 'shop.ecommbd.test';

// WooCommerce sends order e-mails while the fixture creates orders; the containers have no mail.
add_filter( 'pre_wp_mail', '__return_false' );

/**
 * Fails the test with a code.
 *
 * @param bool   $condition Must be true.
 * @param string $code      Failure code.
 * @return void
 * @throws RuntimeException When the condition is false.
 */
function ecommbd_test_assert( $condition, $code ) {
	if ( ! $condition ) {
		throw new RuntimeException( $code );
	}
}

/**
 * Saves a confirmed upload state for the fake destination.
 *
 * @param string $token     Upload token.
 * @param array  $overrides Fields to change.
 * @return array The saved state.
 */
function ecommbd_test_state( $token, array $overrides = array() ) {
	$state = array_merge(
		array(
			'endpoint'      => ECOMMBD_TEST_ENDPOINT,
			'host'          => ECOMMBD_TEST_HOST,
			'confirmed_by'  => 1,
			'confirmed_at'  => time(),
			'id'            => 123,
			'token'         => EcommBD_Migrator_Crypto::seal( $token ),
			'owner'         => 1,
			'stage'         => 0,
			'offset'        => 0,
			'size'          => EcommBD_Migrator_Uploader::START_SIZE,
			'sequence'      => 0,
			'counts'        => array_fill_keys( EcommBD_Migrator::STAGES, 0 ),
			'pending'       => null,
			'watermark'     => gmdate( 'c' ),
			'retries'       => 0,
			'last_activity' => time(),
		),
		$overrides
	);
	EcommBD_Migrator::remove_site_state();
	EcommBD_Migrator::save_state( $state );

	return $state;
}

/**
 * Sets up an admin-post or review request with a valid nonce.
 *
 * @param array  $fields       POST fields.
 * @param string $nonce_action Nonce action, or "" for no nonce.
 * @return void
 */
function ecommbd_test_post( array $fields, $nonce_action ) {
	$_POST = $fields;
	if ( '' !== $nonce_action ) {
		$_POST['_wpnonce'] = wp_create_nonce( $nonce_action );
	}
	$_REQUEST = $_POST;
}

/**
 * Calls the admin action handler and returns where it redirected.
 *
 * @return string Redirect URL.
 * @throws RuntimeException When it did not redirect.
 */
function ecommbd_test_action() {
	$redirect = static function ( $location ) {
		throw new RuntimeException( 'REDIRECT:' . $location );
	};
	// Priority 1: before WP-CLI's own redirect warning.
	add_filter( 'wp_redirect', $redirect, 1 );
	try {
		EcommBD_Migrator_Admin::handle_action();
	} catch ( RuntimeException $error ) {
		if ( 0 === strpos( $error->getMessage(), 'REDIRECT:' ) ) {
			return substr( $error->getMessage(), strlen( 'REDIRECT:' ) );
		}
		throw $error;
	} finally {
		remove_filter( 'wp_redirect', $redirect, 1 );
		$_POST    = array();
		$_REQUEST = array();
	}
	throw new RuntimeException( 'NO_REDIRECT' );
}

/**
 * Valid pairing details for the fake destination.
 *
 * @return string JSON as Ecomm BD shows it.
 */
function ecommbd_test_pairing() {
	return wp_json_encode(
		array(
			'endpoint' => ECOMMBD_TEST_ENDPOINT,
			'code'     => '7.' . str_repeat( 'ab', 32 ),
		),
		JSON_UNESCAPED_SLASHES
	);
}

/**
 * Fake Ecomm BD destination.
 */
final class EcommBD_Test_Destination {

	/**
	 * Upload token it expects.
	 *
	 * @var string
	 */
	public $token;

	/**
	 * Every upload request: sequence, kind, count, bytes, body.
	 *
	 * @var array
	 */
	public $requests = array();

	/**
	 * Number of /pair requests.
	 *
	 * @var int
	 */
	public $pairs = 0;

	/**
	 * Next sequence it accepts.
	 *
	 * @var int
	 */
	public $next = 0;

	/**
	 * Failures to inject, in order: "timeout" (refuse before storing) or "lost_ack" (store, then
	 * lose the answer).
	 *
	 * @var array
	 */
	public $fail = array();

	/**
	 * Called before each upload is answered, with the request.
	 *
	 * @var callable|null
	 */
	public $before_reply = null;

	/**
	 * Records accepted per kind.
	 *
	 * @var array
	 */
	public $counts = array();

	/**
	 * Body digest per accepted sequence.
	 *
	 * @var array
	 */
	private $digests = array();

	/**
	 * Nonces seen.
	 *
	 * @var array
	 */
	private $nonces = array();

	/**
	 * Starts answering requests.
	 *
	 * @param string $token Upload token.
	 * @param int    $next  First sequence it accepts.
	 */
	public function __construct( $token, $next = 0 ) {
		$this->token = $token;
		$this->next  = $next;
		add_filter( 'pre_http_request', array( $this, 'handle' ), 10, 3 );
	}

	/**
	 * Stops answering requests.
	 *
	 * @return void
	 */
	public function stop() {
		remove_filter( 'pre_http_request', array( $this, 'handle' ), 10 );
	}

	/**
	 * Record counts of each upload, in order, for one kind.
	 *
	 * @param string $kind Kind.
	 * @return array
	 */
	public function sizes( $kind ) {
		$sizes = array();
		foreach ( $this->requests as $request ) {
			if ( $kind === $request['kind'] ) {
				$sizes[] = $request['count'];
			}
		}

		return $sizes;
	}

	/**
	 * Answers one request like the core does.
	 *
	 * @param mixed  $pre  Earlier answer.
	 * @param array  $args Request arguments.
	 * @param string $url  URL.
	 * @return mixed
	 */
	public function handle( $pre, $args, $url ) {
		if ( 0 !== strpos( $url, ECOMMBD_TEST_ENDPOINT ) ) {
			return $pre;
		}
		ecommbd_test_assert( true === $args['sslverify'] && 0 === $args['redirection'], 'TLS_OR_REDIRECT_GUARD_FAILED' );
		$path = substr( $url, strlen( ECOMMBD_TEST_ENDPOINT ) );
		if ( '/pair' === $path ) {
			++$this->pairs;
			$body = json_decode( $args['body'], true );
			ecommbd_test_assert( untrailingslashit( home_url() ) === $body['sourceUrl'], 'PAIR_SOURCE_URL_WRONG' );

			return $this->reply(
				array(
					'id'        => 123,
					'token'     => $this->token,
					'expiresAt' => gmdate( 'c', time() + 7 * DAY_IN_SECONDS ),
				)
			);
		}
		ecommbd_test_assert( '/upload/123' === $path, 'UNEXPECTED_PATH' );

		$headers = $args['headers'];
		$body    = json_decode( $args['body'], true );
		ecommbd_test_assert( is_array( $body ) && array( 'sequence', 'kind', 'payload' ) === array_keys( $body ), 'BODY_SHAPE_CHANGED' );
		ecommbd_test_assert( is_int( $body['sequence'] ) && is_string( $body['payload'] ), 'BODY_TYPES_CHANGED' );
		ecommbd_test_assert( preg_match( '/^\d{10}$/', $headers['X-Woo-Time'] ) && abs( time() - (int) $headers['X-Woo-Time'] ) <= 300, 'BAD_TIME' );
		ecommbd_test_assert( preg_match( '/^[a-f0-9]{32}$/', $headers['X-Woo-Nonce'] ) && ! isset( $this->nonces[ $headers['X-Woo-Nonce'] ] ), 'BAD_OR_REUSED_NONCE' );
		$this->nonces[ $headers['X-Woo-Nonce'] ] = true;
		$expected                                = hash_hmac( 'sha256', $headers['X-Woo-Time'] . "\n" . $headers['X-Woo-Nonce'] . "\n" . $body['sequence'] . "\n" . $body['kind'] . "\n" . $body['payload'], $this->token );
		ecommbd_test_assert( hash_equals( $expected, $headers['X-Woo-Signature'] ), 'SIGNATURE_MISMATCH' );
		ecommbd_test_assert( strlen( $args['body'] ) <= 2 * 1024 * 1024, 'BODY_OVER_2_MIB' );

		$data = json_decode( $body['payload'], true );
		ecommbd_test_assert( is_array( $data ) && isset( $data['records'] ) && is_array( $data['records'] ) && count( $data['records'] ) <= 100, 'TOO_MANY_RECORDS' );
		foreach ( $data['records'] as $record ) {
			ecommbd_test_assert( isset( $record['id'] ) && is_int( $record['id'] ) && $record['id'] >= 1, 'INVALID_SOURCE_ID' );
			if ( 'customers' === $body['kind'] ) {
				ecommbd_test_assert( 1 !== $record['id'] && 'customer' === $record['_role'], 'PRIVILEGED_HASH_EXPORTED' );
			}
		}

		$this->requests[] = array(
			'sequence' => $body['sequence'],
			'kind'     => $body['kind'],
			'count'    => count( $data['records'] ),
			'bytes'    => strlen( $args['body'] ),
			'body'     => $args['body'],
		);
		if ( is_callable( $this->before_reply ) ) {
			call_user_func( $this->before_reply, $body );
		}

		// A resend of an accepted chunk must be byte-for-byte the same.
		$digest = hash( 'sha256', $args['body'] );
		if ( isset( $this->digests[ $body['sequence'] ] ) ) {
			ecommbd_test_assert( $this->digests[ $body['sequence'] ] === $digest, 'ALTERED_DUPLICATE' );

			return $this->reply(
				array(
					'accepted'     => true,
					'nextSequence' => $this->next,
				)
			);
		}
		ecommbd_test_assert( $this->next === $body['sequence'], 'SEQUENCE_GAP' );

		$failure = array_shift( $this->fail );
		if ( 'timeout' === $failure ) {
			return new WP_Error( 'fixture_timeout', 'Synthetic timeout' );
		}
		if ( 'finish' === $body['kind'] ) {
			ecommbd_test_assert( 0 === count( $data['records'] ) && preg_match( '/^[A-Z]{3}$/', $data['manifest']['currency'] ), 'BAD_FINISH' );
		} else {
			$this->counts[ $body['kind'] ] = ( isset( $this->counts[ $body['kind'] ] ) ? $this->counts[ $body['kind'] ] : 0 ) + count( $data['records'] );
		}
		$this->digests[ $body['sequence'] ] = $digest;
		++$this->next;
		if ( 'lost_ack' === $failure ) {
			return new WP_Error( 'fixture_lost_ack', 'Synthetic lost acknowledgement' );
		}

		return $this->reply(
			array(
				'accepted'     => true,
				'nextSequence' => $this->next,
			)
		);
	}

	/**
	 * A 201 JSON answer.
	 *
	 * @param array $data Body.
	 * @return array
	 */
	private function reply( array $data ) {
		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $data ),
			'response' => array(
				'code'    => 201,
				'message' => 'Created',
			),
			'cookies'  => array(),
		);
	}
}
