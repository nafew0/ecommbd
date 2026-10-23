<?php
/**
 * SEO and Pixel storage layouts of real plugins, and the page in Bangla and English.
 *
 * Run after fixture.php: wp eval-file tests/metadata.php
 * Every option or term it changes is restored.
 *
 * @package EcommBD_Migrator
 */

require_once __DIR__ . '/support.php';

// 1. Yoast taxonomy option, RankMath term meta and PixelYourSite's separate Pixel ID option.
$saved_yoast = get_option( 'wpseo_taxonomy_meta', null );
$saved_pixel = get_option( 'pys_facebook', null );
$term        = wp_insert_term( 'Synthetic metadata test ' . uniqid(), 'product_cat' );
ecommbd_test_assert( ! is_wp_error( $term ), 'TERM_FIXTURE_FAILED' );
$term_id = $term['term_id'];
try {
	update_term_meta( $term_id, 'rank_math_title', 'Synthetic RankMath category' );
	update_term_meta( $term_id, 'rank_math_description', 'Synthetic RankMath description' );
	ecommbd_test_assert(
		array(
			'title'       => 'Synthetic RankMath category',
			'description' => 'Synthetic RankMath description',
		) === EcommBD_Migrator_Exporter::seo( $term_id, true ),
		'RANKMATH_TERM_META_FAILED'
	);

	$yoast                             = is_array( $saved_yoast ) ? $saved_yoast : array();
	$yoast['product_cat'][ $term_id ] = array(
		'wpseo_title' => 'Synthetic Yoast category',
		'wpseo_desc'  => 'Synthetic Yoast description',
	);
	update_option( 'wpseo_taxonomy_meta', $yoast, false );
	ecommbd_test_assert(
		array(
			'title'       => 'Synthetic Yoast category',
			'description' => 'Synthetic Yoast description',
		) === EcommBD_Migrator_Exporter::seo( $term_id, true ),
		'YOAST_TERM_OPTION_FAILED'
	);

	update_option(
		'pys_facebook',
		array(
			'pixel_id'                => array( '1234567890', '9876543210' ),
			'server_access_api_token' => array( 'synthetic-private-token' ),
		),
		false
	);
	$settings = EcommBD_Migrator_Exporter::settings();
	ecommbd_test_assert( '1234567890' === $settings['pixelId'], 'PIXEL_ID_NOT_EXACT' );
	ecommbd_test_assert( false === strpos( wp_json_encode( $settings ), 'synthetic-private-token' ), 'PIXEL_SECRET_EXPORTED' );
} finally {
	wp_delete_term( $term_id, 'product_cat' );
	if ( null === $saved_yoast ) {
		delete_option( 'wpseo_taxonomy_meta' );
	} else {
		update_option( 'wpseo_taxonomy_meta', $saved_yoast, false );
	}
	if ( null === $saved_pixel ) {
		delete_option( 'pys_facebook' );
	} else {
		update_option( 'pys_facebook', $saved_pixel, false );
	}
}
echo 'HELPER_METADATA_OK' . PHP_EOL;

// 2. The page in Bangla (admin language bn_BD) and English, including the destination check.
wp_set_current_user( 1 );
ecommbd_test_state( bin2hex( random_bytes( 32 ) ), array( 'stage' => 2 ) );

/**
 * Renders the page, optionally as "Check pairing details".
 *
 * @param bool $review Whether to render the destination check.
 * @return string HTML.
 */
function ecommbd_render( $review ) {
	if ( $review ) {
		ecommbd_test_post(
			array(
				'ecommbd_review' => '1',
				'pairing'        => ecommbd_test_pairing(),
			),
			EcommBD_Migrator_Admin::REVIEW_NONCE
		);
	}
	ob_start();
	EcommBD_Migrator_Admin::render_page();
	$_POST    = array();
	$_REQUEST = array();

	return ob_get_clean();
}

ecommbd_test_assert( switch_to_locale( 'bn_BD' ), 'BANGLA_LANGUAGE_PACK_MISSING' );
$status = ecommbd_render( false );
$check  = ecommbd_render( true );
$native = is_textdomain_loaded( 'ecommbd-migrator' );
restore_previous_locale();
// WordPress 6.5+ reads languages/ecommbd-migrator-bn_BD.l10n.php itself; older ones use the fallback.
ecommbd_test_assert( version_compare( get_bloginfo( 'version' ), '6.5', '>=' ) === $native, 'TRANSLATION_LOADING_UNEXPECTED' );
// number_format_i18n() keeps Latin digits in WordPress's Bangla locale; the words are Bangla.
foreach ( array( 'Ecomm BD-তে নিন', 'আপলোডের অগ্রগতি', 'ক্যাটাগরি', 'কাস্টমার', 'ধাপ 3/9: পণ্য', 'গন্তব্য স্টোর' ) as $bangla ) {
	ecommbd_test_assert( false !== strpos( $status, $bangla ), 'BANGLA_PAGE_MISSING ' . $bangla );
}
ecommbd_test_assert( false !== strpos( $check, 'আপনার স্টোরের তথ্য কোথায় যাবে' ) && false !== strpos( $check, 'হ্যাঁ, <strong dir="ltr">' . ECOMMBD_TEST_HOST . '</strong> আমার Ecomm BD স্টোর।' ), 'BANGLA_DESTINATION_CHECK_MISSING' );

$english = ecommbd_render( true );
ecommbd_test_assert( false !== strpos( $english, 'Check where your store data will go' ) && false !== strpos( $english, 'Yes, <strong dir="ltr">' . ECOMMBD_TEST_HOST . '</strong> is my Ecomm BD store.' ), 'ENGLISH_DESTINATION_CHECK_MISSING' );
ecommbd_test_assert( false === strpos( $english, 'আপনার' ), 'BANGLA_LEAKED_INTO_ENGLISH' );
EcommBD_Migrator::remove_site_state();

echo 'HELPER_BANGLA_PAGE_OK (' . ( $native ? 'loaded by WordPress' : 'built-in fallback' ) . ')' . PHP_EOL;
