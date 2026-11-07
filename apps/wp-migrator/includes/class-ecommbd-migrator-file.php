<?php
/**
 * Export to a file the merchant downloads, for stores that cannot send to Ecomm BD directly.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Writes the whole store to one file, chunk by chunk, in the background.
 *
 * File format (read by importFile in apps/core/src/plugins/woo-import/helper.service.ts):
 * JSON Lines, gzip-compressed when the server has zlib (.jsonl.gz, otherwise .jsonl).
 * - Line 1, the header: { format: "ecommbd-woo-export", version: 1, plugin, sourceUrl, createdAt }.
 * - Then one line per chunk, exactly the body the upload sends: { sequence, kind, payload },
 *   where payload is a JSON string { records } (at most 100 records, under 1.9 MB).
 * - The last line is the "finish" chunk: payload { records: [], manifest }.
 * Because the chunks are the same as the upload's, Ecomm BD checks and imports them the same way.
 *
 * Resume rule: the state saves how many bytes of the file are complete. A run that died while
 * writing left a half line after that point; the next run cuts the file back to the saved length
 * and writes that chunk again. The same exporters as the upload read the store, so the file holds
 * exactly what an upload would send (no admin password hashes, no secret settings, see the exporter).
 *
 * The file holds customers' personal data and password hashes. It lives in a folder of the
 * uploads directory under a random name, with web access denied where the server reads .htaccess,
 * and is deleted with "Delete export file", on deactivation and on uninstall.
 */
final class EcommBD_Migrator_File {

	/**
	 * Option holding the export's progress (never autoloaded).
	 */
	const OPTION = 'ecommbd_migration_file';

	/**
	 * WP-Cron hook that continues the export in the background.
	 */
	const CRON_HOOK = 'ecommbd_migrate_file_tick';

	/**
	 * Folder inside the uploads directory.
	 */
	const FOLDER = 'ecommbd-migrator';

	/**
	 * First line's format name and version: Ecomm BD refuses a file without them.
	 */
	const FORMAT         = 'ecommbd-woo-export';
	const FORMAT_VERSION = 1;

	/**
	 * Same chunk limits as the upload, so every line is a chunk Ecomm BD accepts.
	 */
	const MAX_RECORDS    = EcommBD_Migrator_Uploader::MAX_RECORDS;
	const START_SIZE     = EcommBD_Migrator_Uploader::START_SIZE;
	const MAX_BODY_BYTES = EcommBD_Migrator_Uploader::MAX_BODY_BYTES;

	/**
	 * Lock lifetime; refreshed before every save.
	 */
	const LOCK_SECONDS = EcommBD_Migrator_Uploader::LOCK_SECONDS;

	/**
	 * Starts a new export, replacing any earlier file, then writes as much as the budget allows.
	 *
	 * @param int $user_id The user who started it; cron re-checks their capability.
	 * @return string See run().
	 * @throws RuntimeException BUSY or FILE_WRITE_FAILED.
	 */
	public static function start( $user_id ) {
		$lock = EcommBD_Migrator_Lock::acquire( self::LOCK_SECONDS );
		if ( false === $lock ) {
			throw new RuntimeException( 'BUSY' );
		}

		try {
			self::delete_files();
			$folder = self::folder();
			$name   = 'export-' . wp_generate_password( 32, false, false ) . '.jsonl';
			$header = self::encode(
				array(
					'format'    => self::FORMAT,
					'version'   => self::FORMAT_VERSION,
					'plugin'    => EcommBD_Migrator::VERSION,
					'sourceUrl' => untrailingslashit( home_url() ),
					'createdAt' => gmdate( 'c' ),
				)
			) . "\n";
			$bytes  = self::write_at( $folder . '/' . $name, 0, $header );

			wp_clear_scheduled_hook( self::CRON_HOOK );
			self::save(
				array(
					'owner'         => (int) $user_id,
					'name'          => $name,
					'bytes'         => $bytes,
					'stage'         => 0,
					'offset'        => 0,
					'size'          => self::START_SIZE,
					'sequence'      => 0,
					'counts'        => array_fill_keys( EcommBD_Migrator::STAGES, 0 ),
					'watermark'     => gmdate( 'c' ),
					'started_at'    => time(),
					'last_activity' => time(),
				),
				$lock
			);
		} finally {
			EcommBD_Migrator_Lock::release( $lock );
		}

		return self::run( null, true );
	}

	/**
	 * WP-Cron entry point.
	 *
	 * @return void
	 */
	public static function run_from_cron() {
		self::run();
	}

	/**
	 * Writes chunks until the export is done or the budget is used, then schedules the next run.
	 *
	 * @param EcommBD_Migrator_Budget|null $budget Time and memory budget; defaults to php.ini.
	 * @param bool                         $manual Whether the merchant clicked "Continue now".
	 * @return string done, more, busy, paused or idle (no export started).
	 */
	public static function run( $budget = null, $manual = false ) {
		$budget = $budget instanceof EcommBD_Migrator_Budget ? $budget : EcommBD_Migrator_Budget::from_environment();
		$lock   = EcommBD_Migrator_Lock::acquire( self::LOCK_SECONDS );
		if ( false === $lock ) {
			return 'busy';
		}

		$previous_user = get_current_user_id();
		try {
			$state = self::get_state();
			if ( null === $state ) {
				return 'idle';
			}
			if ( ! empty( $state['done'] ) ) {
				return 'done';
			}
			try {
				if ( ! EcommBD_Migrator::woocommerce_ready() ) {
					throw new RuntimeException( 'WOOCOMMERCE_REQUIRED' );
				}
				// Runs as the user who started it, also from cron, and stops if they lost the capability.
				wp_set_current_user( isset( $state['owner'] ) ? (int) $state['owner'] : 0 );
				if ( ! current_user_can( EcommBD_Migrator::CAPABILITY ) ) {
					throw new RuntimeException( 'PERMISSION_CHANGED' );
				}
				unset( $state['error'], $state['error_detail'] );
				do {
					$started = microtime( true );
					$state   = self::write_next_chunk( $state, $lock );
					$seconds = microtime( true ) - $started;
				} while ( empty( $state['done'] ) && $budget->has_time_for( $seconds ) && $budget->has_memory() );
			} catch ( Throwable $error ) {
				if ( 'LOCK_LOST' === $error->getMessage() ) {
					return 'busy';
				}
				// Report on the last saved checkpoint: the failed chunk is written again next time.
				$state = self::get_state();
				if ( null === $state ) {
					return 'idle';
				}
				$code                  = EcommBD_Migrator_Uploader::error_code( $error );
				$state['error']        = $code;
				$state['error_detail'] = 'EXPORT_FAILED' === $code ? get_class( $error ) . ' ' . basename( $error->getFile() ) . ':' . $error->getLine() : '';
				try {
					self::save( $state, $lock );
				} catch ( RuntimeException $lost ) {
					return 'busy';
				}

				return 'paused';
			}

			if ( ! empty( $state['done'] ) ) {
				return 'done';
			}
			self::schedule();

			return 'more';
		} finally {
			EcommBD_Migrator_Lock::release( $lock );
			wp_set_current_user( $previous_user );
		}
	}

	/**
	 * The export's progress, read straight from the database (cron may have changed it).
	 *
	 * @return array|null Null when no export was started.
	 */
	public static function get_state() {
		wp_cache_delete( self::OPTION, 'options' );
		$notoptions = wp_cache_get( 'notoptions', 'options' );
		if ( is_array( $notoptions ) && isset( $notoptions[ self::OPTION ] ) ) {
			unset( $notoptions[ self::OPTION ] );
			wp_cache_set( 'notoptions', $notoptions, 'options' );
		}
		$state = get_option( self::OPTION );

		return is_array( $state ) ? $state : null;
	}

	/**
	 * Full path of the finished export file, or null.
	 *
	 * @return string|null
	 */
	public static function finished_path() {
		$state = self::get_state();
		if ( null === $state || empty( $state['done'] ) || empty( $state['name'] ) ) {
			return null;
		}
		$path = self::folder() . '/' . basename( (string) $state['name'] );

		return is_file( $path ) ? $path : null;
	}

	/**
	 * Name the browser saves the file as, for example ecommbd-export-shop.example.com-20261108.jsonl.gz.
	 *
	 * @return string
	 */
	public static function download_name() {
		$state = self::get_state();
		$host  = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$date  = gmdate( 'Ymd-His', isset( $state['finished_at'] ) ? (int) $state['finished_at'] : time() );
		$gzip  = null !== $state && isset( $state['name'] ) && '.gz' === substr( (string) $state['name'], -3 );

		return 'ecommbd-export-' . sanitize_file_name( $host ) . '-' . $date . ( $gzip ? '.jsonl.gz' : '.jsonl' );
	}

	/**
	 * Sends the finished file to the browser and stops.
	 *
	 * The caller has already checked the capability and the nonce.
	 *
	 * @return void
	 * @throws RuntimeException NO_EXPORT when there is no finished file.
	 */
	public static function stream_download() {
		$path = self::finished_path();
		if ( null === $path ) {
			throw new RuntimeException( 'NO_EXPORT' );
		}
		$gzip = '.gz' === substr( $path, -3 );

		nocache_headers();
		header( 'Content-Type: ' . ( $gzip ? 'application/gzip' : 'application/x-ndjson' ) );
		header( 'Content-Disposition: attachment; filename="' . self::download_name() . '"' );
		header( 'Content-Length: ' . (string) filesize( $path ) );
		header( 'X-Content-Type-Options: nosniff' );
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}
		$handle = fopen( $path, 'rb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- Streams a large file without loading it.
		if ( false === $handle ) {
			throw new RuntimeException( 'NO_EXPORT' );
		}
		while ( ! feof( $handle ) ) {
			echo fread( $handle, 1048576 ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.AlternativeFunctions.file_system_operations_fread -- A file download, not HTML.
			flush();
		}
		fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}

	/**
	 * Deletes the export file, its progress and its scheduled run.
	 *
	 * Used by "Delete export file", deactivation and uninstall.
	 *
	 * @return void
	 */
	public static function remove() {
		wp_clear_scheduled_hook( self::CRON_HOOK );
		delete_option( self::OPTION );
		self::delete_files();
	}

	/**
	 * Builds the next chunk and appends it to the file, then saves the new checkpoint.
	 *
	 * @param array  $state State.
	 * @param string $lock  Lock token.
	 * @return array New state.
	 * @throws RuntimeException RECORD_TOO_LARGE, FILE_WRITE_FAILED or LOCK_LOST.
	 */
	private static function write_next_chunk( array $state, $lock ) {
		$stages = EcommBD_Migrator::STAGES;

		while ( true ) {
			$started = microtime( true );
			$size    = max( 1, min( self::MAX_RECORDS, (int) $state['size'] ) );
			$stage   = (int) $state['stage'];
			$kind    = isset( $stages[ $stage ] ) ? $stages[ $stage ] : 'finish';

			if ( 'finish' === $kind ) {
				$page = array(
					'records' => array(),
					'next'    => 0,
					'done'    => true,
				);
				$data = array(
					'records'  => array(),
					'manifest' => array_merge(
						EcommBD_Migrator_Exporter::settings(),
						array(
							'counts'    => $state['counts'],
							'watermark' => $state['watermark'],
						)
					),
				);
			} else {
				$page = EcommBD_Migrator_Exporter::export( $kind, (int) $state['offset'], $size );
				$data = array( 'records' => $page['records'] );
			}

			$line = self::encode(
				array(
					'sequence' => (int) $state['sequence'],
					'kind'     => $kind,
					'payload'  => self::encode( $data ),
				)
			);
			if ( strlen( $line ) > self::MAX_BODY_BYTES ) {
				if ( $size <= 1 ) {
					throw new RuntimeException( 'RECORD_TOO_LARGE' );
				}
				// Too big for one chunk: halve and build again.
				$state['size'] = max( 1, intdiv( $size, 2 ) );
				continue;
			}

			$state['bytes'] = self::write_at( self::folder() . '/' . basename( (string) $state['name'] ), (int) $state['bytes'], $line . "\n" );
			$seconds        = microtime( true ) - $started;

			if ( 'finish' === $kind ) {
				$state['done']        = true;
				$state['finished_at'] = time();
				$state['name']        = self::compress( (string) $state['name'] );
			} else {
				$state['counts'][ $kind ] = ( isset( $state['counts'][ $kind ] ) ? (int) $state['counts'][ $kind ] : 0 ) + count( $data['records'] );
				$state['offset']          = (int) $page['next'];
				if ( ! empty( $page['done'] ) ) {
					$state['stage']  = $stage + 1;
					$state['offset'] = 0;
				}
				// Grow after fast, small chunks; shrink after slow ones (like the upload).
				if ( $seconds > EcommBD_Migrator_Uploader::SLOW_BUILD_SECONDS ) {
					$state['size'] = max( 1, intdiv( $size, 2 ) );
				} elseif ( $seconds < EcommBD_Migrator_Uploader::FAST_BUILD_SECONDS && strlen( $line ) < self::MAX_BODY_BYTES / 2 ) {
					$state['size'] = min( self::MAX_RECORDS, $size * 2 );
				}
			}
			$state['sequence']      = (int) $state['sequence'] + 1;
			$state['last_activity'] = time();
			self::save( $state, $lock );

			return $state;
		}
	}

	/**
	 * Writes text at a byte position, cutting off anything after it first.
	 *
	 * @param string $path  File.
	 * @param int    $bytes Bytes of the file that are complete.
	 * @param string $text  Text to write there.
	 * @return int New length of the file.
	 * @throws RuntimeException FILE_WRITE_FAILED.
	 */
	private static function write_at( $path, $bytes, $text ) {
		// phpcs:disable WordPress.WP.AlternativeFunctions -- Appends to a large file in place; WP_Filesystem can only rewrite whole files.
		$handle = fopen( $path, 'c+b' );
		if ( false === $handle ) {
			throw new RuntimeException( 'FILE_WRITE_FAILED' );
		}
		try {
			if ( ! ftruncate( $handle, $bytes ) || 0 !== fseek( $handle, $bytes ) || strlen( $text ) !== fwrite( $handle, $text ) || ! fflush( $handle ) ) {
				throw new RuntimeException( 'FILE_WRITE_FAILED' );
			}

			return $bytes + strlen( $text );
		} finally {
			fclose( $handle );
		}
		// phpcs:enable WordPress.WP.AlternativeFunctions
	}

	/**
	 * Gzips the finished file when zlib is available (about ten times smaller), else keeps it.
	 *
	 * @param string $name File name in the folder.
	 * @return string Name of the file to download.
	 * @throws RuntimeException FILE_WRITE_FAILED.
	 */
	private static function compress( $name ) {
		if ( ! function_exists( 'gzopen' ) ) {
			return $name;
		}
		$path = self::folder() . '/' . basename( $name );
		// phpcs:disable WordPress.WP.AlternativeFunctions -- Streams a large file through gzip.
		$in  = fopen( $path, 'rb' );
		$out = gzopen( $path . '.gz', 'wb6' );
		if ( false === $in || false === $out ) {
			throw new RuntimeException( 'FILE_WRITE_FAILED' );
		}
		while ( ! feof( $in ) ) {
			$block = fread( $in, 1048576 );
			if ( false === $block || ( '' !== $block && 0 === gzwrite( $out, $block ) ) ) {
				throw new RuntimeException( 'FILE_WRITE_FAILED' );
			}
		}
		fclose( $in );
		gzclose( $out );
		wp_delete_file( $path );
		// phpcs:enable WordPress.WP.AlternativeFunctions

		return basename( $name ) . '.gz';
	}

	/**
	 * The export folder, created on first use with web access denied.
	 *
	 * Apache reads the .htaccess file. Nginx does not, so the file also has a random,
	 * unguessable name, and index.php stops folder listings.
	 *
	 * @return string Path without a trailing slash.
	 * @throws RuntimeException FILE_WRITE_FAILED.
	 */
	private static function folder() {
		$uploads = wp_upload_dir( null, false );
		$folder  = trailingslashit( $uploads['basedir'] ) . self::FOLDER;
		if ( ! is_dir( $folder ) && ! wp_mkdir_p( $folder ) ) {
			throw new RuntimeException( 'FILE_WRITE_FAILED' );
		}
		// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Two tiny guard files.
		if ( ! file_exists( $folder . '/index.php' ) ) {
			file_put_contents( $folder . '/index.php', "<?php\n// Silence is golden.\n" );
		}
		if ( ! file_exists( $folder . '/.htaccess' ) ) {
			file_put_contents( $folder . '/.htaccess', "Require all denied\nDeny from all\n" );
		}
		// phpcs:enable WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

		return $folder;
	}

	/**
	 * Deletes every export file in the folder (the guard files stay).
	 *
	 * @return void
	 */
	private static function delete_files() {
		$uploads = wp_upload_dir( null, false );
		$folder  = trailingslashit( $uploads['basedir'] ) . self::FOLDER;
		foreach ( (array) glob( $folder . '/export-*' ) as $file ) {
			if ( is_string( $file ) && is_file( $file ) ) {
				wp_delete_file( $file );
			}
		}
	}

	/**
	 * Schedules the next background run, unless one is already due.
	 *
	 * @return void
	 */
	private static function schedule() {
		if ( false === wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time(), self::CRON_HOOK );
		}
	}

	/**
	 * Saves the progress while holding the lock (see EcommBD_Migrator_Uploader::save()).
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
		update_option( self::OPTION, $state, false );
	}

	/**
	 * Encodes JSON the same way as the upload.
	 *
	 * @param mixed $value Value.
	 * @return string
	 * @throws RuntimeException ENCODING_FAILED.
	 */
	private static function encode( $value ) {
		$json = wp_json_encode( $value, EcommBD_Migrator_Uploader::JSON_FLAGS );
		if ( false === $json ) {
			throw new RuntimeException( 'ENCODING_FAILED' );
		}

		return $json;
	}
}
