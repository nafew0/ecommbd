<?php
/**
 * Pairing, the upload loop, signing and retries.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Sends the store to the paired Ecomm BD store, chunk by chunk.
 *
 * Wire protocol (must match apps/core/src/plugins/woo-import/helper.service.ts):
 * - POST {endpoint}/pair with { code, sourceUrl } returns { id, token, expiresAt }.
 * - POST {endpoint}/upload/{id} with { sequence, kind, payload } returns
 *   { accepted, nextSequence }. payload is a JSON string { records } (or { records: [],
 *   manifest } for the final "finish" chunk). Headers X-Woo-Time, X-Woo-Nonce and
 *   X-Woo-Signature carry HMAC-SHA256( token, "time\nnonce\nsequence\nkind\npayload" ).
 * - The destination accepts exactly the next sequence, at most 100 records and 2 MiB per chunk.
 *   Resending an accepted chunk unchanged is acknowledged again; a changed one is refused.
 *
 * Resume rule: a chunk is built, encrypted and SAVED as "pending" before it is sent. If the
 * request dies or the answer is lost, the next run resends the same saved bytes. A pending chunk
 * is never rebuilt, because the destination may already hold it, and a different chunk with the
 * same sequence would be refused forever.
 */
final class EcommBD_Migrator_Uploader {

	/**
	 * Most records per chunk: the destination refuses more than 100.
	 */
	const MAX_RECORDS = 100;

	/**
	 * Chunk size of a new upload. It grows after fast chunks and shrinks after slow ones.
	 */
	const START_SIZE = 25;

	/**
	 * Largest request body. The destination's limit is 2 MiB (2,097,152 bytes); this leaves room
	 * for small differences between PHP's and JavaScript's JSON encoders.
	 */
	const MAX_BODY_BYTES = 1900000;

	/**
	 * Seconds to wait for Ecomm BD to answer one request.
	 */
	const HTTP_TIMEOUT = 20;

	/**
	 * A chunk built faster than this (and uploaded faster than FAST_UPLOAD_SECONDS) doubles the
	 * next chunk, up to MAX_RECORDS. Version 0.1.0 could only shrink, so one slow moment left
	 * every later chunk at 1 record.
	 */
	const FAST_BUILD_SECONDS = 1.0;

	/**
	 * Upload time below which a chunk counts as fast.
	 */
	const FAST_UPLOAD_SECONDS = 2.0;

	/**
	 * A chunk built slower than this halves the next chunk.
	 */
	const SLOW_BUILD_SECONDS = 5.0;

	/**
	 * Upload time above which the next chunk is halved.
	 */
	const SLOW_UPLOAD_SECONDS = 10.0;

	/**
	 * Lock lifetime. Longer than one chunk can take (build + HTTP_TIMEOUT), and refreshed before
	 * every chunk, so it only expires when the request has died.
	 */
	const LOCK_SECONDS = 120;

	/**
	 * Network failures retried automatically (after 1, 2, then 3 minutes) before the upload
	 * waits for the merchant to click "Continue now".
	 */
	const NETWORK_RETRIES = 3;

	/**
	 * Base delay between automatic retries, in seconds.
	 */
	const RETRY_DELAY = 60;

	/**
	 * JSON flags for everything sent: keeps Bangla text and URLs readable and the body small.
	 */
	const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

	/**
	 * WP-Cron entry point.
	 *
	 * Cron runs without a logged-in user, so run() switches to the user who paired and checks
	 * again that they may still manage WooCommerce.
	 *
	 * @return void
	 */
	public static function run_from_cron() {
		self::run();
	}

	/**
	 * Sends chunks until the work is done or the budget is used, then schedules the next run.
	 *
	 * The same loop serves cron and the "Continue now" button.
	 *
	 * @param EcommBD_Migrator_Budget|null $budget Time and memory budget; defaults to php.ini.
	 * @param bool                         $manual Whether the merchant clicked; resets the automatic retry count.
	 * @return string done, more (work remains and the next run is scheduled), busy (another
	 *                request holds the lock), paused (an error is shown) or idle (nothing paired).
	 */
	public static function run( $budget = null, $manual = false ) {
		$budget = $budget instanceof EcommBD_Migrator_Budget ? $budget : EcommBD_Migrator_Budget::from_environment();
		$lock   = EcommBD_Migrator_Lock::acquire( self::LOCK_SECONDS );
		if ( false === $lock ) {
			return 'busy';
		}

		$previous_user = get_current_user_id();
		try {
			return self::run_locked( $lock, $budget, $manual );
		} finally {
			EcommBD_Migrator_Lock::release( $lock );
			wp_set_current_user( $previous_user );
		}
	}

	/**
	 * Exchanges a one-time pairing code for an upload token and starts a fresh upload.
	 *
	 * Called only after the merchant confirmed the destination host (see the admin page).
	 *
	 * @param array $pairing Result of parse_pairing().
	 * @param int   $user_id The user who confirmed; cron re-checks their capability.
	 * @return void
	 * @throws RuntimeException When an upload is running, or Ecomm BD refuses the code.
	 */
	public static function pair( array $pairing, $user_id ) {
		$lock = EcommBD_Migrator_Lock::acquire( self::LOCK_SECONDS );
		if ( false === $lock ) {
			throw new RuntimeException( 'BUSY' );
		}

		try {
			$response = self::post(
				$pairing['endpoint'] . '/pair',
				array(
					'code'      => $pairing['code'],
					'sourceUrl' => untrailingslashit( home_url() ),
				)
			);
			$id       = isset( $response['id'] ) && is_scalar( $response['id'] ) && preg_match( '/^[1-9][0-9]{0,15}$/', (string) $response['id'] ) ? (int) $response['id'] : 0;
			if ( 0 === $id || empty( $response['token'] ) || ! is_string( $response['token'] ) ) {
				throw new RuntimeException( 'INVALID_RESPONSE' );
			}

			wp_clear_scheduled_hook( EcommBD_Migrator::CRON_HOOK );
			$state = array(
				'endpoint'      => $pairing['endpoint'],
				'host'          => $pairing['host'],
				'confirmed_by'  => (int) $user_id,
				'confirmed_at'  => time(),
				'id'            => $id,
				'token'         => EcommBD_Migrator_Crypto::seal( $response['token'] ),
				'owner'         => (int) $user_id,
				'stage'         => 0,
				'offset'        => 0,
				'size'          => self::START_SIZE,
				'sequence'      => 0,
				'counts'        => array_fill_keys( EcommBD_Migrator::STAGES, 0 ),
				'pending'       => null,
				'watermark'     => gmdate( 'c' ),
				'retries'       => 0,
				'last_activity' => time(),
			);
			self::save( $state, $lock );
		} finally {
			EcommBD_Migrator_Lock::release( $lock );
		}
	}

	/**
	 * Records the merchant's confirmation for a connection saved without one.
	 *
	 * Uploads paired by version 0.1.0 have no confirmed destination; they wait here once.
	 *
	 * @param string $host    Host the merchant confirmed.
	 * @param int    $user_id The user who confirmed.
	 * @return void
	 * @throws RuntimeException When nothing is paired, the host differs or an upload is running.
	 */
	public static function confirm_destination( $host, $user_id ) {
		$lock = EcommBD_Migrator_Lock::acquire( self::LOCK_SECONDS );
		if ( false === $lock ) {
			throw new RuntimeException( 'BUSY' );
		}

		try {
			$state = EcommBD_Migrator::get_state();
			if ( null === $state || empty( $state['endpoint'] ) ) {
				throw new RuntimeException( 'NOT_PAIRED' );
			}
			if ( ! hash_equals( self::endpoint_host( $state['endpoint'] ), (string) $host ) ) {
				throw new RuntimeException( 'DESTINATION_CHANGED' );
			}
			$state['host']         = (string) $host;
			$state['confirmed_by'] = (int) $user_id;
			$state['confirmed_at'] = time();
			self::save( $state, $lock );
		} finally {
			EcommBD_Migrator_Lock::release( $lock );
		}
	}

	/**
	 * Checks pasted pairing details. Makes no request.
	 *
	 * The details are JSON { endpoint, code } made by Ecomm BD. The endpoint must be plain https
	 * on a plain ASCII host name: Ecomm BD always sends punycode, and a look-alike Unicode name
	 * could pass for a real store on the confirmation screen.
	 *
	 * @param string $raw Pasted text.
	 * @return array { endpoint, code, host } where host is what the merchant must confirm.
	 * @throws RuntimeException INVALID_PAIRING or HTTPS_REQUIRED.
	 */
	public static function parse_pairing( $raw ) {
		$pairing = json_decode( trim( (string) $raw ), true );
		if ( ! is_array( $pairing ) || ! isset( $pairing['endpoint'], $pairing['code'] ) || ! is_string( $pairing['endpoint'] ) || ! is_string( $pairing['code'] ) ) {
			throw new RuntimeException( 'INVALID_PAIRING' );
		}
		if ( ! preg_match( '/^[0-9]+\.[a-f0-9]{64}$/', $pairing['code'] ) ) {
			throw new RuntimeException( 'INVALID_PAIRING' );
		}

		$endpoint = untrailingslashit( trim( $pairing['endpoint'] ) );

		return array(
			'endpoint' => $endpoint,
			'code'     => $pairing['code'],
			'host'     => self::endpoint_host( $endpoint ),
		);
	}

	/**
	 * The host (and port, if any) of an https endpoint, lower case.
	 *
	 * @param string $endpoint Endpoint URL.
	 * @return string For example "shop.example.com".
	 * @throws RuntimeException HTTPS_REQUIRED or INVALID_PAIRING.
	 */
	public static function endpoint_host( $endpoint ) {
		$parts = wp_parse_url( (string) $endpoint );
		$https = is_array( $parts ) && isset( $parts['scheme'], $parts['host'] ) && 'https' === strtolower( $parts['scheme'] );
		// No user:password@ (it can hide the real host), no ?query and no #fragment.
		$plain = is_array( $parts ) && array() === array_intersect_key( $parts, array_flip( array( 'user', 'pass', 'query', 'fragment' ) ) );
		if ( ! $https || ! $plain ) {
			throw new RuntimeException( 'HTTPS_REQUIRED' );
		}
		$host = strtolower( $parts['host'] );
		if ( ! preg_match( '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/', $host ) ) {
			throw new RuntimeException( 'INVALID_PAIRING' );
		}

		return isset( $parts['port'] ) ? $host . ':' . (int) $parts['port'] : $host;
	}

	/**
	 * The HMAC-SHA256 signature the destination checks.
	 *
	 * @param string $token Upload token.
	 * @param string $time  Unix time as a string.
	 * @param string $nonce 32 hex characters, new for every request.
	 * @param array  $body  { sequence, kind, payload }.
	 * @return string Hex signature.
	 */
	public static function sign( $token, $time, $nonce, array $body ) {
		return hash_hmac( 'sha256', $time . "\n" . $nonce . "\n" . $body['sequence'] . "\n" . $body['kind'] . "\n" . $body['payload'], $token );
	}

	/**
	 * A safe error code for the admin page: our own codes pass, anything else is EXPORT_FAILED.
	 *
	 * Messages of other exceptions are never shown or stored: they can contain customer data.
	 *
	 * @param Throwable $error Error.
	 * @return string
	 */
	public static function error_code( $error ) {
		$message = $error instanceof Throwable ? $error->getMessage() : '';

		return preg_match( '/^[A-Z][A-Z_0-9]{2,60}$/', $message ) ? $message : 'EXPORT_FAILED';
	}

	/**
	 * Sends a JSON POST to Ecomm BD.
	 *
	 * Always https with certificate checks and no redirects: a redirect could send customers'
	 * password hashes to a host the merchant never confirmed. Some sites carry snippets that
	 * switch certificate checks off for every request, so this request switches them back on
	 * for itself only, at the latest filter priority.
	 *
	 * @param string $url     Full URL.
	 * @param array  $body    Body, sent as JSON.
	 * @param array  $headers Extra headers.
	 * @return array Decoded JSON answer.
	 * @throws RuntimeException NETWORK_OR_TLS, UPLOAD_REFUSED or INVALID_RESPONSE.
	 */
	public static function post( $url, array $body, array $headers = array() ) {
		$force_args   = static function ( $args, $request_url ) use ( $url ) {
			if ( $request_url === $url ) {
				$args['sslverify']          = true;
				$args['redirection']        = 0;
				$args['reject_unsafe_urls'] = true;
			}
			return $args;
		};
		$force_verify = static function ( $verify, $request_url = '' ) use ( $url ) {
			return $request_url === $url ? true : $verify;
		};
		add_filter( 'http_request_args', $force_args, PHP_INT_MAX, 2 );
		add_filter( 'https_ssl_verify', $force_verify, PHP_INT_MAX, 2 );

		try {
			$response = wp_safe_remote_post(
				$url,
				array(
					'timeout'             => self::HTTP_TIMEOUT,
					'redirection'         => 0,
					'sslverify'           => true,
					'headers'             => array_merge( array( 'Content-Type' => 'application/json' ), $headers ),
					'body'                => self::encode( $body ),
					'limit_response_size' => 65536,
				)
			);
		} finally {
			remove_filter( 'http_request_args', $force_args, PHP_INT_MAX );
			remove_filter( 'https_ssl_verify', $force_verify, PHP_INT_MAX );
		}

		if ( is_wp_error( $response ) ) {
			throw new RuntimeException( 'NETWORK_OR_TLS' );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status && 201 !== $status ) {
			throw new RuntimeException( 'UPLOAD_REFUSED' );
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) ) {
			throw new RuntimeException( 'INVALID_RESPONSE' );
		}

		return $data;
	}

	/**
	 * Schedules the next background run, unless one is already due sooner.
	 *
	 * WP-Cron runs on the next page view of the site, or from the server's cron when the host
	 * set one up. "Now" means as soon as anyone (or the open helper page) loads the site.
	 *
	 * @param int $delay Seconds from now.
	 * @return void
	 */
	public static function schedule( $delay ) {
		$when = time() + max( 0, (int) $delay );
		$next = wp_next_scheduled( EcommBD_Migrator::CRON_HOOK );
		if ( false !== $next && $next <= $when ) {
			return;
		}
		if ( false !== $next ) {
			wp_unschedule_event( $next, EcommBD_Migrator::CRON_HOOK );
		}
		wp_schedule_single_event( $when, EcommBD_Migrator::CRON_HOOK );
	}

	/**
	 * The loop, while holding the lock.
	 *
	 * @param string                  $lock   Lock token.
	 * @param EcommBD_Migrator_Budget $budget Budget.
	 * @param bool                    $manual Whether the merchant clicked.
	 * @return string See run().
	 */
	private static function run_locked( $lock, EcommBD_Migrator_Budget $budget, $manual ) {
		$state = EcommBD_Migrator::get_state();
		if ( null === $state ) {
			return 'idle';
		}
		if ( ! empty( $state['done'] ) ) {
			return 'done';
		}
		try {
			self::check_can_upload( $state );
			do {
				$started = microtime( true );
				$state   = self::send_next_chunk( $state, $lock, $budget );
				$seconds = microtime( true ) - $started;
				self::forget_cached_objects();
			} while ( empty( $state['done'] ) && $budget->has_time_for( $seconds ) && $budget->has_memory() );
		} catch ( Throwable $error ) {
			if ( 'LOCK_LOST' === $error->getMessage() ) {
				// Someone removed the connection or took over: leave the state to them.
				return 'busy';
			}
			self::pause( $error, $lock, $manual );

			return 'paused';
		}

		if ( ! empty( $state['done'] ) ) {
			return 'done';
		}
		self::schedule( 0 );

		return 'more';
	}

	/**
	 * Checks, before anything is read or sent, that this upload may run.
	 *
	 * @param array $state State.
	 * @return void
	 * @throws RuntimeException WOOCOMMERCE_REQUIRED, PERMISSION_CHANGED or DESTINATION_NOT_CONFIRMED.
	 */
	private static function check_can_upload( array $state ) {
		if ( ! EcommBD_Migrator::woocommerce_ready() ) {
			throw new RuntimeException( 'WOOCOMMERCE_REQUIRED' );
		}

		// Runs as the user who paired, also from cron, and stops if they lost the capability.
		wp_set_current_user( isset( $state['owner'] ) ? (int) $state['owner'] : 0 );
		if ( ! current_user_can( EcommBD_Migrator::CAPABILITY ) ) {
			throw new RuntimeException( 'PERMISSION_CHANGED' );
		}

		// Nothing is sent until the merchant has seen and confirmed this exact host.
		$endpoint = isset( $state['endpoint'] ) ? (string) $state['endpoint'] : '';
		if ( empty( $state['confirmed_at'] ) || empty( $state['host'] ) || ! hash_equals( (string) $state['host'], self::endpoint_host( $endpoint ) ) ) {
			throw new RuntimeException( 'DESTINATION_NOT_CONFIRMED' );
		}
	}

	/**
	 * Builds (if needed), sends and checkpoints one chunk.
	 *
	 * @param array                   $state  State.
	 * @param string                  $lock   Lock token.
	 * @param EcommBD_Migrator_Budget $budget Budget.
	 * @return array New state.
	 * @throws RuntimeException On any failure; the saved state is then unchanged.
	 */
	private static function send_next_chunk( array $state, $lock, EcommBD_Migrator_Budget $budget ) {
		if ( empty( $state['pending'] ) ) {
			$state = self::build_pending( $state, $lock, $budget );
		}

		$pending = json_decode( EcommBD_Migrator_Crypto::open( $state['pending'] ), true );
		if ( ! is_array( $pending ) || ! isset( $pending['body']['sequence'], $pending['body']['kind'], $pending['body']['payload'] ) ) {
			throw new RuntimeException( 'INVALID_SECRET' );
		}
		$body = $pending['body'];
		if ( (int) $state['sequence'] !== (int) $body['sequence'] ) {
			throw new RuntimeException( 'CHECKPOINT_MISMATCH' );
		}

		$started        = microtime( true );
		$time           = (string) time();
		$nonce          = bin2hex( random_bytes( 16 ) );
		$reply          = self::post(
			$state['endpoint'] . '/upload/' . (int) $state['id'],
			$body,
			array(
				'X-Woo-Time'      => $time,
				'X-Woo-Nonce'     => $nonce,
				'X-Woo-Signature' => self::sign( EcommBD_Migrator_Crypto::open( $state['token'] ), $time, $nonce, $body ),
			)
		);
		$upload_seconds = microtime( true ) - $started;

		if ( empty( $reply['accepted'] ) || ! isset( $reply['nextSequence'] ) || (int) $state['sequence'] + 1 !== $reply['nextSequence'] ) {
			throw new RuntimeException( 'CHECKPOINT_MISMATCH' );
		}

		if ( 'finish' === $body['kind'] ) {
			// Nothing more to sign: drop the token so a finished site holds no secret.
			$state['done'] = true;
			unset( $state['token'] );
		} else {
			$state['counts'][ $body['kind'] ] = ( isset( $state['counts'][ $body['kind'] ] ) ? (int) $state['counts'][ $body['kind'] ] : 0 ) + (int) $pending['count'];
			$state['offset']                  = (int) $pending['next'];
			if ( ! empty( $pending['done'] ) ) {
				$state['stage']  = (int) $state['stage'] + 1;
				$state['offset'] = 0;
			}
			$state['size'] = self::next_size( (int) $state['size'], $pending, $upload_seconds, $budget );
		}
		$state['pending']       = null;
		$state['sequence']      = (int) $state['sequence'] + 1;
		$state['retries']       = 0;
		$state['last_activity'] = time();
		unset( $state['error'], $state['error_detail'] );
		self::save( $state, $lock );

		return $state;
	}

	/**
	 * Exports the next chunk, encrypts it and saves it as pending before anything is sent.
	 *
	 * @param array                   $state  State.
	 * @param string                  $lock   Lock token.
	 * @param EcommBD_Migrator_Budget $budget Budget.
	 * @return array New state with "pending" set.
	 * @throws RuntimeException RECORD_TOO_LARGE when one record alone is over the size limit.
	 */
	private static function build_pending( array $state, $lock, EcommBD_Migrator_Budget $budget ) {
		$stages = EcommBD_Migrator::STAGES;

		while ( true ) {
			$started = microtime( true );
			$size    = max( 1, min( self::MAX_RECORDS, (int) $state['size'] ) );
			$stage   = (int) $state['stage'];
			$kind    = isset( $stages[ $stage ] ) ? $stages[ $stage ] : 'finish';

			if ( 'finish' === $kind ) {
				$manifest = array_merge(
					EcommBD_Migrator_Exporter::settings(),
					array(
						'counts'    => $state['counts'],
						'watermark' => $state['watermark'],
					)
				);
				$page     = array(
					'records' => array(),
					'next'    => 0,
					'done'    => true,
				);
				$data     = array(
					'records'  => array(),
					'manifest' => $manifest,
				);
			} else {
				$page = EcommBD_Migrator_Exporter::export( $kind, (int) $state['offset'], $size );
				$data = array( 'records' => $page['records'] );
			}

			$body  = array(
				'sequence' => (int) $state['sequence'],
				'kind'     => $kind,
				'payload'  => self::encode( $data ),
			);
			$bytes = strlen( self::encode( $body ) );
			if ( $bytes > self::MAX_BODY_BYTES ) {
				if ( $size <= 1 ) {
					throw new RuntimeException( 'RECORD_TOO_LARGE' );
				}
				// Too big for one request: halve and build again now, not on the next run.
				$state['size'] = max( 1, intdiv( $size, 2 ) );
				self::save( $state, $lock );
				continue;
			}

			$seconds  = microtime( true ) - $started;
			$consumed = (int) $page['next'] - (int) $state['offset'];
			if ( 'finish' !== $kind && empty( $page['done'] ) && $consumed < $size ) {
				// The exporter stopped early because records were slow: ask for that many next.
				$state['size'] = max( 1, $consumed );
			}
			if ( ! $budget->has_memory() ) {
				// Close to the memory ceiling: the run stops after this chunk and the next is smaller.
				$state['size'] = max( 1, intdiv( (int) $state['size'], 2 ) );
			}

			$state['pending'] = EcommBD_Migrator_Crypto::seal(
				self::encode(
					array(
						'body'    => $body,
						'next'    => (int) $page['next'],
						'done'    => (bool) $page['done'],
						'count'   => count( $data['records'] ),
						'seconds' => round( $seconds, 3 ),
						'bytes'   => $bytes,
					)
				)
			);
			self::save( $state, $lock );

			return $state;
		}
	}

	/**
	 * Chunk size for the next chunk, from how the last one went.
	 *
	 * @param int                     $size           Current size.
	 * @param array                   $pending        The acknowledged pending chunk.
	 * @param float                   $upload_seconds How long the upload took.
	 * @param EcommBD_Migrator_Budget $budget         Budget.
	 * @return int
	 */
	private static function next_size( $size, array $pending, $upload_seconds, EcommBD_Migrator_Budget $budget ) {
		$size = max( 1, min( self::MAX_RECORDS, $size ) );
		if ( ! isset( $pending['seconds'], $pending['bytes'] ) ) {
			// Built by an older run or version: no timing to learn from.
			return $size;
		}

		$build = (float) $pending['seconds'];
		if ( $build > self::SLOW_BUILD_SECONDS || $upload_seconds > self::SLOW_UPLOAD_SECONDS ) {
			return max( 1, intdiv( $size, 2 ) );
		}
		if ( $build < self::FAST_BUILD_SECONDS && $upload_seconds < self::FAST_UPLOAD_SECONDS && (int) $pending['bytes'] < self::MAX_BODY_BYTES / 2 && $budget->has_memory() ) {
			return min( self::MAX_RECORDS, $size * 2 );
		}

		return $size;
	}

	/**
	 * Saves the state while holding the lock.
	 *
	 * The lock is refreshed first. If it is gone ("Remove saved connection" deletes it) or was
	 * taken over, nothing is saved, so a stopped run cannot bring back old progress.
	 *
	 * @param array  $state State.
	 * @param string $lock  Lock token.
	 * @return void
	 * @throws RuntimeException LOCK_LOST.
	 */
	private static function save( array $state, $lock ) {
		if ( ! EcommBD_Migrator_Lock::refresh( $lock, self::LOCK_SECONDS ) ) {
			throw new RuntimeException( 'LOCK_LOST' );
		}
		EcommBD_Migrator::save_state( $state );
	}

	/**
	 * Saves an error for the admin page and, for network errors, schedules a retry.
	 *
	 * The pending chunk and checkpoint are kept, so a retry resends the same bytes.
	 *
	 * @param Throwable $error  Error.
	 * @param string    $lock   Lock token.
	 * @param bool      $manual Whether the merchant clicked: a click starts the retry count again.
	 * @return void
	 */
	private static function pause( $error, $lock, $manual ) {
		$state = EcommBD_Migrator::get_state();
		if ( null === $state ) {
			return;
		}

		$code                  = self::error_code( $error );
		$state['error']        = $code;
		$state['error_at']     = time();
		$state['error_detail'] = 'EXPORT_FAILED' === $code ? get_class( $error ) . ' ' . basename( $error->getFile() ) . ':' . $error->getLine() : '';
		$retries               = ! $manual && isset( $state['retries'] ) ? (int) $state['retries'] : 0;
		if ( 'NETWORK_OR_TLS' === $code && $retries < self::NETWORK_RETRIES ) {
			$state['retries'] = $retries + 1;
			self::schedule( self::RETRY_DELAY * ( $retries + 1 ) );
		}

		try {
			self::save( $state, $lock );
		} catch ( RuntimeException $lost ) {
			// The lock is gone: the connection was removed, so there is nothing to report on.
			return;
		}
	}

	/**
	 * Frees memory between chunks.
	 *
	 * WordPress and WooCommerce keep every loaded post, order and term in the in-memory object
	 * cache for the whole request, so memory grows with each chunk. Only the in-memory copy is
	 * cleared: a shared cache such as Redis is never flushed.
	 *
	 * @return void
	 */
	private static function forget_cached_objects() {
		global $wpdb;

		if ( function_exists( 'wp_cache_supports' ) && wp_cache_supports( 'flush_runtime' ) ) {
			wp_cache_flush_runtime();
		} elseif ( ! wp_using_ext_object_cache() ) {
			wp_cache_flush();
		}
		if ( defined( 'SAVEQUERIES' ) && SAVEQUERIES ) {
			$wpdb->queries = array();
		}
	}

	/**
	 * Encodes JSON exactly as it is sent.
	 *
	 * @param mixed $value Value.
	 * @return string
	 * @throws RuntimeException ENCODING_FAILED.
	 */
	private static function encode( $value ) {
		$json = wp_json_encode( $value, self::JSON_FLAGS );
		if ( false === $json ) {
			throw new RuntimeException( 'ENCODING_FAILED' );
		}

		return $json;
	}
}
