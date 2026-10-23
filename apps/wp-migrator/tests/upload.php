<?php
/**
 * Throughput: the time and memory budget, the chunk loop, chunk growth and shrinking, the
 * next run being scheduled straight away, and "Continue now" running the same loop.
 *
 * Run after fixture.php: wp eval-file tests/upload.php
 *
 * @package EcommBD_Migrator
 */

require_once __DIR__ . '/support.php';

wp_set_current_user( 1 );
$token = bin2hex( random_bytes( 32 ) );

// 1. Budgets from php.ini values.
ecommbd_test_assert( 15.0 === EcommBD_Migrator_Budget::seconds_for( '30' ), 'TIME_BUDGET_30' );
ecommbd_test_assert( 5.0 === EcommBD_Migrator_Budget::seconds_for( 10 ), 'TIME_BUDGET_10' );
ecommbd_test_assert( 20.0 === EcommBD_Migrator_Budget::seconds_for( 0 ) && 20.0 === EcommBD_Migrator_Budget::seconds_for( '-1' ), 'TIME_BUDGET_UNLIMITED' );
ecommbd_test_assert( 20.0 === EcommBD_Migrator_Budget::seconds_for( 300 ), 'TIME_BUDGET_CAP' );
ecommbd_test_assert( 1.0 === EcommBD_Migrator_Budget::seconds_for( 1 ), 'TIME_BUDGET_MINIMUM' );
ecommbd_test_assert( (int) floor( 128 * 1024 * 1024 * 0.6 ) === EcommBD_Migrator_Budget::memory_for( '128M' ), 'MEMORY_BUDGET_128M' );
ecommbd_test_assert( (int) floor( 1024 * 1024 * 1024 * 0.6 ) === EcommBD_Migrator_Budget::memory_for( '1G' ), 'MEMORY_BUDGET_1G' );
ecommbd_test_assert( 0 === EcommBD_Migrator_Budget::memory_for( '-1' ), 'MEMORY_BUDGET_UNLIMITED' );
ecommbd_test_assert( (int) floor( 268435456 * 0.6 ) === EcommBD_Migrator_Budget::memory_for( '268435456' ), 'MEMORY_BUDGET_BYTES' );

// 300 tags give enough records to watch the chunk size grow.
$tag_count = (int) wp_count_terms(
	array(
		'taxonomy'   => 'product_tag',
		'hide_empty' => false,
	)
);
for ( $i = $tag_count; $i < 300; $i++ ) {
	wp_insert_term( 'Synthetic tag ' . $i, 'product_tag' );
}
$tag_count = (int) wp_count_terms(
	array(
		'taxonomy'   => 'product_tag',
		'hide_empty' => false,
	)
);
$tags      = array_search( 'tags', EcommBD_Migrator::STAGES, true );

// 2. One run keeps sending while within budget; chunks double from 2 up to the cap of 100.
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state(
	$token,
	array(
		'stage' => $tags,
		'size'  => 2,
	)
);
$started = microtime( true );
$result  = EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 30, '-1' ) );
$sizes   = $destination->sizes( 'tags' );
$growth  = $sizes;
ecommbd_test_assert( 'done' === $result && microtime( true ) - $started < 15.5, 'ONE_RUN_DID_NOT_FINISH' );
ecommbd_test_assert( array( 2, 4, 8, 16, 32, 64, 100 ) === array_slice( $sizes, 0, 7 ), 'CHUNKS_DID_NOT_GROW' );
ecommbd_test_assert( $tag_count === array_sum( $sizes ) && max( $sizes ) <= EcommBD_Migrator_Uploader::MAX_RECORDS, 'TAG_COUNT_OR_CAP_WRONG' );
ecommbd_test_assert( ! wp_next_scheduled( EcommBD_Migrator::CRON_HOOK ), 'FINISHED_RUN_SCHEDULED_MORE' );
$destination->stop();

// 3. Over the memory ceiling: one chunk, a smaller next chunk, and the next run scheduled now.
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state(
	$token,
	array(
		'stage' => $tags,
		'size'  => 8,
	)
);
$result = EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 30, (string) memory_get_usage( true ) ) );
$state  = EcommBD_Migrator::get_state();
$next   = wp_next_scheduled( EcommBD_Migrator::CRON_HOOK );
ecommbd_test_assert( 'more' === $result && 1 === count( $destination->requests ) && 4 === $state['size'], 'MEMORY_BUDGET_IGNORED' );
ecommbd_test_assert( false !== $next && $next <= time() + 1, 'NEXT_RUN_NOT_SCHEDULED_NOW' );
$destination->stop();

// 4. Out of time already (a slow WordPress start): still exactly one chunk, then the next run.
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state( $token, array( 'stage' => $tags ) );
$result = EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 30, '-1', microtime( true ) - 60 ) );
ecommbd_test_assert( 'more' === $result && 1 === count( $destination->requests ) && wp_next_scheduled( EcommBD_Migrator::CRON_HOOK ) <= time() + 1, 'OVER_TIME_RUN_WRONG' );
$destination->stop();

// 5. "Continue now" runs the same loop: one click sends many chunks.
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state(
	$token,
	array(
		'stage' => $tags,
		'size'  => 2,
	)
);
$_SERVER['REQUEST_TIME_FLOAT'] = microtime( true );
ecommbd_test_post( array( 'operation' => 'resume' ), EcommBD_Migrator_Admin::ACTION );
$location = ecommbd_test_action();
ecommbd_test_assert( false !== strpos( $location, 'ecommbd-result=done' ) && count( $destination->requests ) > 7, 'CONTINUE_SENT_ONE_CHUNK' );
$destination->stop();

// 6. A chunk over the body limit is halved and rebuilt in the same run; a single record over
// the limit stops with RECORD_TOO_LARGE. Each big product is about 1.05 MB of Bangla text.
$big = array();
foreach ( array( 1, 2 ) as $number ) {
	$product = new WC_Product_Simple();
	$product->set_name( 'Synthetic large product ' . $number );
	$product->set_regular_price( '100' );
	$product->set_description( str_repeat( 'ক', 350000 ) );
	$big[] = $product->save();
}
$products    = array_search( 'products', EcommBD_Migrator::STAGES, true );
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state(
	$token,
	array(
		'stage' => $products,
		'size'  => 4,
	)
);
$result = EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 0, '-1' ) );
$sizes  = $destination->sizes( 'products' );
$bytes  = wp_list_pluck( $destination->requests, 'bytes' );
ecommbd_test_assert( 'done' === $result && 4 === array_sum( $sizes ) && in_array( 1, $sizes, true ), 'LARGE_CHUNK_NOT_SPLIT' );
ecommbd_test_assert( max( $bytes ) <= EcommBD_Migrator_Uploader::MAX_BODY_BYTES, 'BODY_OVER_LIMIT_SENT' );
$destination->stop();

$huge = new WC_Product_Simple();
$huge->set_name( 'Synthetic huge product' );
$huge->set_regular_price( '100' );
$huge->set_description( str_repeat( 'ক', 700000 ) );
$big[]       = $huge->save();
$destination = new EcommBD_Test_Destination( $token );
ecommbd_test_state(
	$token,
	array(
		'stage'  => $products,
		'offset' => 4,
		'size'   => 1,
	)
);
$result = EcommBD_Migrator_Uploader::run( new EcommBD_Migrator_Budget( 0, '-1' ) );
ecommbd_test_assert( 'paused' === $result && 'RECORD_TOO_LARGE' === EcommBD_Migrator::get_state()['error'] && 0 === count( $destination->requests ), 'HUGE_RECORD_NOT_STOPPED' );
$destination->stop();
foreach ( $big as $id ) {
	wp_delete_post( $id, true );
}

// 7. While uploading, the open page reloads itself so WP-Cron keeps getting a chance to run.
ecommbd_test_state( $token );
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
EcommBD_Migrator_Admin::print_head();
$head = ob_get_clean();
ecommbd_test_assert( false !== strpos( $head, 'window.location.replace(' ), 'PAGE_DOES_NOT_REFRESH' );
ecommbd_test_state( $token, array( 'done' => true ) );
ob_start();
EcommBD_Migrator_Admin::print_head();
$head = ob_get_clean();
ecommbd_test_assert( false === strpos( $head, 'window.location.replace(' ), 'FINISHED_PAGE_REFRESHES' );
EcommBD_Migrator::remove_site_state();

echo 'HELPER_UPLOAD_LOOP_OK one run sent ' . $tag_count . ' tags in chunks of ' . implode( ',', $growth ) . PHP_EOL;
