<?php
/**
 * Export to a file: the admin buttons, the file's format (header, chunks in order, finish with
 * the right counts), gzip, resuming after a half-written line, the download name, and deletion.
 *
 * Run after fixture.php: wp eval-file tests/file.php
 *
 * @package EcommBD_Migrator
 */

require_once __DIR__ . '/support.php';

wp_set_current_user( 1 );
EcommBD_Migrator_File::remove();

/**
 * The lines of an export file (gzip or not).
 *
 * @param string $path File.
 * @return array Lines, without empty ones.
 */
function ecommbd_file_lines( $path ) {
	$text = '.gz' === substr( $path, -3 ) ? implode( '', gzfile( $path ) ) : file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	return array_values( array_filter( explode( "\n", $text ), 'strlen' ) );
}

/**
 * Checks a finished export file the way Ecomm BD reads it, and returns its record counts.
 *
 * @param string $path File.
 * @return array Records per stage.
 */
function ecommbd_check_file( $path ) {
	$lines  = ecommbd_file_lines( $path );
	$header = json_decode( $lines[0], true );
	ecommbd_test_assert( is_array( $header ) && EcommBD_Migrator_File::FORMAT === $header['format'] && 1 === $header['version'], 'FILE_HEADER' );
	ecommbd_test_assert( untrailingslashit( home_url() ) === $header['sourceUrl'], 'FILE_SOURCE_URL' );
	$counts = array_fill_keys( EcommBD_Migrator::STAGES, 0 );
	$last   = null;
	foreach ( array_slice( $lines, 1 ) as $index => $line ) {
		ecommbd_test_assert( strlen( $line ) <= EcommBD_Migrator_Uploader::MAX_BODY_BYTES, 'FILE_LINE_TOO_LONG' );
		$chunk = json_decode( $line, true );
		ecommbd_test_assert( is_array( $chunk ) && $index === $chunk['sequence'] && is_string( $chunk['payload'] ), 'FILE_CHUNK_ORDER' );
		$payload = json_decode( $chunk['payload'], true );
		ecommbd_test_assert( is_array( $payload ) && count( $payload['records'] ) <= EcommBD_Migrator_Uploader::MAX_RECORDS, 'FILE_CHUNK_PAYLOAD' );
		if ( 'finish' !== $chunk['kind'] ) {
			$counts[ $chunk['kind'] ] += count( $payload['records'] );
		}
		$last = array( $chunk, $payload );
	}
	ecommbd_test_assert( null !== $last && 'finish' === $last[0]['kind'], 'FILE_NO_FINISH' );
	ecommbd_test_assert( $counts === $last[1]['manifest']['counts'], 'FILE_COUNTS_DIFFER' );

	return $counts;
}

// 1. "Create export file" on the page writes the whole store and offers the download.
ecommbd_test_post(
	array(
		'action'    => EcommBD_Migrator_Admin::ACTION,
		'operation' => 'export_start',
	),
	EcommBD_Migrator_Admin::ACTION
);
$location = ecommbd_test_action();
ecommbd_test_assert( false !== strpos( $location, 'ecommbd-result=export-' ), 'EXPORT_START_RESULT' );
for ( $i = 0; $i < 20 && null === EcommBD_Migrator_File::finished_path(); $i++ ) {
	EcommBD_Migrator_File::run( new EcommBD_Migrator_Budget( 30, '-1' ), true );
}
$path = EcommBD_Migrator_File::finished_path();
ecommbd_test_assert( null !== $path, 'EXPORT_NOT_FINISHED' );
ecommbd_test_assert( ! function_exists( 'gzopen' ) || '.gz' === substr( $path, -3 ), 'EXPORT_NOT_GZIPPED' );
ecommbd_test_assert( 1 === preg_match( '/^export-[A-Za-z0-9]{32}\.jsonl(\.gz)?$/', basename( $path ) ), 'EXPORT_NAME_GUESSABLE' );
$counts = ecommbd_check_file( $path );
ecommbd_test_assert( $counts['products'] > 0 && $counts['customers'] > 0 && $counts['orders'] > 0, 'EXPORT_EMPTY' );

// The same rules as the upload: no administrator's password hash leaves the site.
$contents = implode( "\n", ecommbd_file_lines( $path ) );
foreach ( get_users( array( 'role__in' => array( 'administrator', 'shop_manager' ) ) ) as $user ) {
	ecommbd_test_assert( false === strpos( $contents, $user->user_pass ), 'EXPORT_HAS_ADMIN_HASH' );
}
// The folder refuses web access where .htaccess is read, and lists nothing.
$folder = dirname( $path );
ecommbd_test_assert( file_exists( $folder . '/.htaccess' ) && file_exists( $folder . '/index.php' ), 'EXPORT_FOLDER_UNGUARDED' );
ecommbd_test_assert( 1 === preg_match( '/^ecommbd-export-[a-z0-9.-]+-\d{8}-\d{6}\.jsonl(\.gz)?$/', EcommBD_Migrator_File::download_name() ), 'DOWNLOAD_NAME' );

// The page shows the download button once the file is ready.
ob_start();
EcommBD_Migrator_Admin::render_page();
$page = ob_get_clean();
ecommbd_test_assert( false !== strpos( $page, 'action=' . EcommBD_Migrator_Admin::DOWNLOAD_ACTION ), 'NO_DOWNLOAD_BUTTON' );

// 2. Resume: a run that died while writing left half a line; the next run cuts it off and goes on.
EcommBD_Migrator_File::remove();
$header = wp_json_encode(
	array(
		'format'    => EcommBD_Migrator_File::FORMAT,
		'version'   => 1,
		'plugin'    => EcommBD_Migrator::VERSION,
		'sourceUrl' => untrailingslashit( home_url() ),
		'createdAt' => gmdate( 'c' ),
	),
	EcommBD_Migrator_Uploader::JSON_FLAGS
) . "\n";
$name   = 'export-' . str_repeat( 'r', 32 ) . '.jsonl';
file_put_contents( $folder . '/' . $name, $header . '{"sequence":0,"kind":"categ' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
update_option(
	EcommBD_Migrator_File::OPTION,
	array(
		'owner'         => 1,
		'name'          => $name,
		'bytes'         => strlen( $header ),
		'stage'         => 0,
		'offset'        => 0,
		'size'          => 2,
		'sequence'      => 0,
		'counts'        => array_fill_keys( EcommBD_Migrator::STAGES, 0 ),
		'watermark'     => gmdate( 'c' ),
		'started_at'    => time(),
		'last_activity' => time(),
	),
	false
);
for ( $i = 0; $i < 20 && null === EcommBD_Migrator_File::finished_path(); $i++ ) {
	ecommbd_test_assert( 'busy' !== EcommBD_Migrator_File::run( new EcommBD_Migrator_Budget( 30, '-1' ), true ), 'EXPORT_LOCK_HELD' );
}
$resumed = EcommBD_Migrator_File::finished_path();
ecommbd_test_assert( null !== $resumed && $counts === ecommbd_check_file( $resumed ), 'RESUME_DIFFERS' );

// 3. "Delete export file" removes the file and the progress; deactivation does the same.
ecommbd_test_post(
	array(
		'action'    => EcommBD_Migrator_Admin::ACTION,
		'operation' => 'export_delete',
	),
	EcommBD_Migrator_Admin::ACTION
);
ecommbd_test_assert( false !== strpos( ecommbd_test_action(), 'ecommbd-result=export-deleted' ), 'EXPORT_DELETE_RESULT' );
ecommbd_test_assert( null === EcommBD_Migrator_File::get_state() && array() === glob( $folder . '/export-*' ), 'EXPORT_NOT_DELETED' );
EcommBD_Migrator_File::start( 1 );
EcommBD_Migrator::deactivate();
ecommbd_test_assert( null === EcommBD_Migrator_File::get_state() && array() === glob( $folder . '/export-*' ), 'DEACTIVATE_KEPT_EXPORT' );
ecommbd_test_assert( false === wp_next_scheduled( EcommBD_Migrator_File::CRON_HOOK ), 'DEACTIVATE_KEPT_CRON' );

echo 'HELPER_EXPORT_FILE_OK ' . wp_json_encode( $counts ) . PHP_EOL;
