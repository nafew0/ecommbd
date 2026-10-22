<?php
// Runtime regression for actual Yoast/RankMath/PixelYourSite storage layouts.
// Run only in the disposable WordPress fixture; restore every changed option/term.
function ecommbd_metadata_assert( $condition, $code ) { if ( ! $condition ) { throw new RuntimeException( $code ); } }
$saved_yoast = get_option( 'wpseo_taxonomy_meta', null );
$saved_pixel = get_option( 'pys_facebook', null );
$term = wp_insert_term( 'Synthetic metadata test ' . uniqid(), 'product_cat' );
if ( is_wp_error( $term ) ) { throw new RuntimeException( 'TERM_FIXTURE_FAILED' ); }
$id = $term['term_id'];
try {
    update_term_meta( $id, 'rank_math_title', 'Synthetic RankMath category' );
    update_term_meta( $id, 'rank_math_description', 'Synthetic RankMath description' );
    ecommbd_metadata_assert( EcommBD_Migrator::seo( $id, true ) === array( 'title' => 'Synthetic RankMath category', 'description' => 'Synthetic RankMath description' ), 'RANKMATH_TERM_META_FAILED' );
    $yoast = is_array( $saved_yoast ) ? $saved_yoast : array();
    $yoast['product_cat'][ $id ] = array( 'wpseo_title' => 'Synthetic Yoast category', 'wpseo_desc' => 'Synthetic Yoast description' );
    update_option( 'wpseo_taxonomy_meta', $yoast, false );
    ecommbd_metadata_assert( EcommBD_Migrator::seo( $id, true ) === array( 'title' => 'Synthetic Yoast category', 'description' => 'Synthetic Yoast description' ), 'YOAST_TERM_OPTION_FAILED' );
    update_option( 'pys_facebook', array( 'pixel_id' => array( '1234567890', '9876543210' ), 'server_access_api_token' => array( 'synthetic-private-token' ) ), false );
    $settings = EcommBD_Migrator::settings();
    ecommbd_metadata_assert( $settings['pixelId'] === '1234567890', 'PIXEL_ID_NOT_EXACT' );
    ecommbd_metadata_assert( strpos( wp_json_encode( $settings ), 'synthetic-private-token' ) === false, 'PIXEL_SECRET_EXPORTED' );
} finally {
    wp_delete_term( $id, 'product_cat' );
    if ( $saved_yoast === null ) { delete_option( 'wpseo_taxonomy_meta' ); } else { update_option( 'wpseo_taxonomy_meta', $saved_yoast, false ); }
    if ( $saved_pixel === null ) { delete_option( 'pys_facebook' ); } else { update_option( 'pys_facebook', $saved_pixel, false ); }
}
echo 'HELPER_METADATA_OK' . PHP_EOL;
wp_set_current_user( 1 );
$user = wp_get_current_user(); $saved_locale = $user->locale; $user->locale = 'bn_BD';
ob_start(); EcommBD_Migrator::page(); $html = ob_get_clean();
$user->locale = $saved_locale;
ecommbd_metadata_assert( strpos( $html, 'অগ্রগতি' ) !== false && strpos( $html, 'বিভাগ' ) !== false, 'BANGLA_HELPER_PAGE_FAILED' );
echo 'HELPER_BANGLA_PAGE_OK' . PHP_EOL;
