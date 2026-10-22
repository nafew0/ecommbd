<?php
/**
 * Plugin Name: Ecomm BD Migrator
 * Description: Read-only, resumable WooCommerce export to your paired Ecomm BD store.
 * Version: 0.1.0
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Text Domain: ecommbd-migrator
 */
defined( 'ABSPATH' ) || exit;

final class EcommBD_Migrator {
    const OPTION = 'ecommbd_migration';
    const STAGES = array( 'categories', 'tags', 'products', 'customers', 'orders', 'coupons', 'reviews', 'settings' );
    public static function boot() {
        add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
        add_action( 'admin_post_ecommbd_migrate', array( __CLASS__, 'action' ) );
        add_action( 'ecommbd_migrate_tick', array( __CLASS__, 'cron_tick' ) );
        add_action( 'before_woocommerce_init', function () {
            if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
                \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
            }
        } );
    }
    public static function t( $en, $bn ) { return strpos( get_user_locale(), 'bn' ) === 0 ? $bn : $en; }
    public static function menu() {
        add_submenu_page( 'woocommerce', 'Ecomm BD', self::t( 'Move to Ecomm BD', 'Ecomm BD-তে নিন' ), 'manage_woocommerce', 'ecommbd-migrate', array( __CLASS__, 'page' ) );
    }
    public static function page() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Not allowed.' ) ); }
        $state = get_option( self::OPTION, array() );
        $stages = array(
            self::t( 'Categories', 'বিভাগ' ), self::t( 'Tags', 'ট্যাগ' ), self::t( 'Products', 'পণ্য' ),
            self::t( 'Customers', 'ক্রেতা' ), self::t( 'Orders', 'অর্ডার' ), self::t( 'Coupons', 'কুপন' ),
            self::t( 'Reviews', 'মতামত' ), self::t( 'Store settings', 'স্টোরের সেটিংস' ),
        );
        echo '<div class="wrap"><h1>' . esc_html( self::t( 'Move to Ecomm BD', 'Ecomm BD-তে নিন' ) ) . '</h1><p>' . esc_html( self::t( 'This reads your store. It never changes products, orders or passwords. Keep this plugin only for the migration.', 'এটি শুধু তথ্য পড়ে। পণ্য, অর্ডার বা পাসওয়ার্ড বদলায় না। মাইগ্রেশন শেষে প্লাগইন মুছে দিন।' ) ) . '</p>';
        if ( ! empty( $state['error'] ) ) { echo '<div class="notice notice-error"><p>' . esc_html( $state['error'] ) . '</p></div>'; }
        echo '<p>' . esc_html( self::t( 'Progress', 'অগ্রগতি' ) ) . ': ' . esc_html( $stages[ $state['stage'] ?? 0 ] ?? self::t( 'Upload complete', 'আপলোড শেষ' ) ) . ' · ' . esc_html( (string) ( $state['sequence'] ?? 0 ) ) . '</p>';
        echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="ecommbd_migrate">';
        wp_nonce_field( 'ecommbd_migrate' );
        echo '<label>' . esc_html( self::t( 'Pairing details from Ecomm BD', 'Ecomm BD থেকে পেয়ারিং তথ্য' ) ) . '<br><textarea name="pairing" rows="4" cols="70" autocomplete="off"></textarea></label><p><button class="button button-primary" name="operation" value="pair">' . esc_html( self::t( 'Pair / start a fresh upload', 'যুক্ত করে নতুন আপলোড শুরু করুন' ) ) . '</button> <button class="button" name="operation" value="resume">' . esc_html( self::t( 'Continue / retry', 'চালিয়ে যান / আবার চেষ্টা করুন' ) ) . '</button> <button class="button" name="operation" value="forget">' . esc_html( self::t( 'Remove saved connection', 'সেভ করা সংযোগ মুছুন' ) ) . '</button></p></form></div>';
    }
    public static function action() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Not allowed.' ) ); }
        check_admin_referer( 'ecommbd_migrate' );
        if ( ! class_exists( 'WooCommerce' ) || version_compare( WC_VERSION, '4.0', '<' ) ) { wp_die( esc_html( self::t( 'WooCommerce 4.0+ required.', 'WooCommerce 4.0 বা পরের সংস্করণ দরকার।' ) ) ); }
        $operation = sanitize_key( $_POST['operation'] ?? '' );
        try {
            if ( $operation === 'forget' ) { self::remove(); }
            elseif ( $operation === 'pair' ) {
                $pair = json_decode( wp_unslash( $_POST['pairing'] ?? '' ), true );
                if ( ! is_array( $pair ) || empty( $pair['endpoint'] ) || empty( $pair['code'] ) ) { throw new RuntimeException( 'INVALID_PAIRING' ); }
                $endpoint = rtrim( $pair['endpoint'], '/' );
                if ( wp_parse_url( $endpoint, PHP_URL_SCHEME ) !== 'https' || wp_parse_url( $endpoint, PHP_URL_USER ) || wp_parse_url( $endpoint, PHP_URL_QUERY ) || wp_parse_url( $endpoint, PHP_URL_FRAGMENT ) ) { throw new RuntimeException( 'HTTPS_REQUIRED' ); }
                $response = self::post( $endpoint . '/pair', array( 'code' => $pair['code'], 'sourceUrl' => untrailingslashit( home_url() ) ) );
                $state = array( 'endpoint' => $endpoint, 'id' => $response['id'], 'token' => self::seal( $response['token'] ), 'owner' => get_current_user_id(), 'stage' => 0, 'offset' => 0, 'size' => 50, 'sequence' => 0, 'counts' => array_fill_keys( self::STAGES, 0 ), 'pending' => null, 'watermark' => gmdate( 'c' ) );
                update_option( self::OPTION, $state, false );
                self::tick();
            } else { self::tick(); }
        } catch ( Throwable $error ) {
            self::pause( $error );
        }
        wp_safe_redirect( admin_url( 'admin.php?page=ecommbd-migrate' ) ); exit;
    }
    public static function cron_tick() {
        try { self::tick(); } catch ( Throwable $error ) { self::pause( $error ); }
    }
    private static function pause( $error ) {
        $state = get_option( self::OPTION, array() );
        $state['error'] = self::t( 'Export paused. Check HTTPS, connection and pairing; then retry. Code: ', 'আপলোড থেমেছে। HTTPS, সংযোগ ও পেয়ারিং দেখে আবার চেষ্টা করুন। কোড: ' ) . ( preg_match( '/^[A-Z_0-9]{3,60}$/', $error->getMessage() ) ? $error->getMessage() : 'EXPORT_FAILED' );
        update_option( self::OPTION, $state, false );
    }
    /** Encrypt transient upload credentials/pending chunks with the site's existing secret salts. */
    public static function seal( $value ) {
        $iv = random_bytes( 12 ); $tag = '';
        $cipher = openssl_encrypt( $value, 'aes-256-gcm', hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, $iv, $tag );
        if ( $cipher === false ) { throw new RuntimeException( 'ENCRYPTION_FAILED' ); }
        return base64_encode( $iv . $tag . $cipher );
    }
    public static function open( $value ) {
        $bytes = base64_decode( $value, true );
        if ( $bytes === false || strlen( $bytes ) < 28 ) { throw new RuntimeException( 'INVALID_SECRET' ); }
        $plain = openssl_decrypt( substr( $bytes, 28 ), 'aes-256-gcm', hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, substr( $bytes, 0, 12 ), substr( $bytes, 12, 16 ) );
        if ( $plain === false ) { throw new RuntimeException( 'INVALID_SECRET' ); } return $plain;
    }
    public static function post( $url, $body, $headers = array() ) {
        $response = wp_safe_remote_post( $url, array( 'timeout' => 20, 'redirection' => 0, 'sslverify' => true, 'headers' => array_merge( array( 'Content-Type' => 'application/json' ), $headers ), 'body' => wp_json_encode( $body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ), 'limit_response_size' => 65536 ) );
        if ( is_wp_error( $response ) ) { throw new RuntimeException( 'NETWORK_OR_TLS' ); }
        if ( wp_remote_retrieve_response_code( $response ) !== 201 && wp_remote_retrieve_response_code( $response ) !== 200 ) { throw new RuntimeException( 'UPLOAD_REFUSED' ); }
        $data = json_decode( wp_remote_retrieve_body( $response ), true ); if ( ! is_array( $data ) ) { throw new RuntimeException( 'INVALID_RESPONSE' ); } return $data;
    }
    /** One bounded outbound chunk per tick. A saved encrypted payload survives lost acknowledgements. */
    public static function tick() {
        if ( get_transient( 'ecommbd_export_lock' ) ) { return; }
        set_transient( 'ecommbd_export_lock', 1, 60 );
        try {
            $state = get_option( self::OPTION ); if ( ! is_array( $state ) || ! empty( $state['done'] ) ) { return; }
            wp_set_current_user( (int) $state['owner'] );
            if ( ! current_user_can( 'manage_woocommerce' ) ) { throw new RuntimeException( 'PERMISSION_CHANGED' ); }
            if ( empty( $state['pending'] ) ) {
                $started = microtime( true );
                $kind = self::STAGES[ $state['stage'] ] ?? 'finish';
                if ( $kind === 'finish' ) {
                    $data = array( 'records' => array(), 'manifest' => array_merge( self::settings(), array( 'counts' => $state['counts'], 'watermark' => $state['watermark'] ) ) );
                    $page = array( 'next' => 0, 'done' => true );
                } else {
                    $page = self::export( $kind, $state['offset'], $state['size'] );
                    $data = array( 'records' => $page['records'] );
                }
                $body = array( 'sequence' => $state['sequence'], 'kind' => $kind, 'payload' => wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
                if ( strlen( wp_json_encode( $body ) ) > 1900000 ) {
                    if ( $state['size'] <= 1 ) { throw new RuntimeException( 'RECORD_TOO_LARGE' ); }
                    $state['size'] = max( 1, (int) floor( $state['size'] / 2 ) ); update_option( self::OPTION, $state, false ); self::schedule(); return;
                }
                $state['pending'] = self::seal( wp_json_encode( array( 'body' => $body, 'next' => $page['next'], 'done' => $page['done'], 'count' => count( $data['records'] ) ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
                if ( microtime( true ) - $started > 5 || memory_get_usage( true ) > 64 * 1024 * 1024 ) { $state['size'] = max( 1, (int) floor( $state['size'] / 2 ) ); }
                update_option( self::OPTION, $state, false );
            }
            $pending = json_decode( self::open( $state['pending'] ), true ); $body = $pending['body'];
            $time = (string) time(); $nonce = bin2hex( random_bytes( 16 ) );
            $signature = hash_hmac( 'sha256', $time . "\n" . $nonce . "\n" . $body['sequence'] . "\n" . $body['kind'] . "\n" . $body['payload'], self::open( $state['token'] ) );
            $reply = self::post( $state['endpoint'] . '/upload/' . $state['id'], $body, array( 'X-Woo-Time' => $time, 'X-Woo-Nonce' => $nonce, 'X-Woo-Signature' => $signature ) );
            if ( empty( $reply['accepted'] ) || $reply['nextSequence'] !== $state['sequence'] + 1 ) { throw new RuntimeException( 'CHECKPOINT_MISMATCH' ); }
            if ( $body['kind'] === 'finish' ) { $state['done'] = true; }
            else { $state['counts'][ $body['kind'] ] += $pending['count']; $state['offset'] = $pending['next']; if ( $pending['done'] ) { $state['stage']++; $state['offset'] = 0; } }
            $state['pending'] = null; $state['sequence']++; unset( $state['error'] ); update_option( self::OPTION, $state, false );
            if ( empty( $state['done'] ) ) { self::schedule(); }
        } finally { delete_transient( 'ecommbd_export_lock' ); }
    }
    public static function schedule() { if ( ! wp_next_scheduled( 'ecommbd_migrate_tick' ) ) { wp_schedule_single_event( time() + 10, 'ecommbd_migrate_tick' ); } }
    public static function settings() {
        global $wp_version;
        return array( 'id' => 1, 'currency' => get_woocommerce_currency(), 'pricesIncludeTax' => wc_prices_include_tax(), 'taxesEnabled' => wc_tax_enabled(), 'weightUnit' => get_option( 'woocommerce_weight_unit', 'kg' ), 'wooVersion' => WC_VERSION, 'wordpressVersion' => $wp_version, 'permalinks' => get_option( 'woocommerce_permalinks', array() ), 'pixelId' => self::pixel(), 'shippingZones' => class_exists( 'WC_Shipping_Zones' ) ? WC_Shipping_Zones::get_zones() : array(), 'redirects' => self::redirects(), 'warnings' => array_values( array_filter( array( defined( 'ICL_SITEPRESS_VERSION' ) || defined( 'POLYLANG_VERSION' ) ? 'PRIMARY_LANGUAGE_ONLY_REVIEW' : null, class_exists( 'WC_Subscriptions' ) || class_exists( 'WC_Bookings' ) ? 'SUBSCRIPTIONS_BOOKINGS_NOT_SUPPORTED' : null ) ) ) );
    }
    private static function pixel() {
        $settings = get_option( 'pys_facebook', array() );
        $ids = (array) ( $settings['pixel_id'] ?? array() );
        if ( function_exists( '\PixelYourSite\Facebook' ) ) { $ids = (array) \PixelYourSite\Facebook()->getPixelIDs(); }
        // The destination has one Pixel field. Never concatenate multiple IDs or export CAPI tokens.
        foreach ( $ids as $id ) { if ( is_scalar( $id ) && preg_match( '/^[0-9]{5,30}$/', (string) $id ) ) { return (string) $id; } }
        return '';
    }
    public static function seo( $id, $term = false ) {
        $get = $term ? 'get_term_meta' : 'get_post_meta';
        $object = $term ? get_term( $id ) : get_post( $id );
        $yoast = array();
        if ( $term && $object && ! is_wp_error( $object ) ) {
            // Yoast taxonomy SEO lives in its option, not in product post-meta keys.
            $options = get_option( 'wpseo_taxonomy_meta', array() );
            $yoast = $options[ $object->taxonomy ][ $id ] ?? array();
        }
        $result = array();
        foreach ( array( 'title' => 'title', 'description' => 'metadesc' ) as $field => $key ) {
            $value = $term ? ( $yoast[ $field === 'title' ? 'wpseo_title' : 'wpseo_desc' ] ?? '' ) : $get( $id, '_yoast_wpseo_' . $key, true );
            if ( $value && function_exists( 'wpseo_replace_vars' ) ) { $value = wpseo_replace_vars( $value, $object ); }
            if ( ! $value ) {
                $value = $get( $id, 'rank_math_' . $field, true );
                if ( $value && is_callable( array( '\RankMath\Helper', 'replace_vars' ) ) ) { $value = \RankMath\Helper::replace_vars( $value, $object ); }
            }
            $result[ $field ] = (string) $value;
        }
        return $result;
    }
    private static function redirects() {
        global $wpdb; $rows = array();
        foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => 'publish', 'numberposts' => 500, 'orderby' => 'ID', 'order' => 'ASC' ) ) as $page ) { $rows[] = array( 'id' => $page->ID, 'path' => wp_parse_url( get_permalink( $page ), PHP_URL_PATH ), 'target' => '/' ); }
        $table = $wpdb->prefix . 'redirection_items';
        if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ) === $table ) {
            // This plugin-specific table is optional; order data never comes from WP post tables.
            $items = $wpdb->get_results( "SELECT url, action_data, action_type, action_code, regex FROM `" . esc_sql( $table ) . "` WHERE status='enabled' LIMIT 1000", ARRAY_A );
            foreach ( $items as $item ) { if ( empty( $item['regex'] ) && $item['action_type'] === 'url' && (int) $item['action_code'] === 301 ) { $target = $item['action_data']; if ( strpos( $target, home_url() ) === 0 ) { $target = substr( $target, strlen( home_url() ) ); } if ( strpos( $target, '/' ) === 0 && strpos( $target, '//' ) !== 0 ) { $rows[] = array( 'path' => $item['url'], 'target' => $target ); } } }
        }
        return $rows;
    }
    public static function export( $kind, $offset, $limit ) {
        $request = new WP_REST_Request( 'GET' ); $request->set_param( 'context', 'edit' ); $records = array(); $started = microtime( true ); $consumed = null;
        if ( $kind === 'settings' ) { return array( 'records' => $offset ? array() : array( self::settings() ), 'next' => 1, 'done' => true ); }
        if ( $kind === 'categories' || $kind === 'tags' ) {
            $items = get_terms( array( 'taxonomy' => $kind === 'categories' ? 'product_cat' : 'product_tag', 'hide_empty' => false, 'number' => $limit, 'offset' => $offset, 'orderby' => 'term_id', 'order' => 'ASC' ) );
            if ( is_wp_error( $items ) ) { throw new RuntimeException( 'TAXONOMY_READ_FAILED' ); }
            foreach ( $items as $term ) { $records[] = array( 'id' => $term->term_id, 'name' => $term->name, 'slug' => $term->slug, 'parent' => $term->parent, 'description' => $term->description, 'link' => get_term_link( $term ), '_seo' => self::seo( $term->term_id, true ) ); }
        } elseif ( $kind === 'customers' ) {
            $items = get_users( array( 'role' => 'customer', 'number' => $limit, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC' ) );
            $controller = new WC_REST_Customers_Controller();
            foreach ( $items as $user ) {
                if ( array_diff( $user->roles, array( 'customer' ) ) || user_can( $user, 'manage_options' ) || user_can( $user, 'manage_woocommerce' ) ) { continue; }
                $data = $controller->prepare_item_for_response( $user, $request )->get_data();
                $data['_password_hash'] = $user->user_pass; $data['_role'] = 'customer'; $records[] = $data;
            }
        } elseif ( $kind === 'orders' ) {
            $consumed = 0;
            $items = wc_get_orders( array( 'limit' => $limit, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC', 'type' => 'shop_order', 'status' => array_keys( wc_get_order_statuses() ), 'return' => 'objects' ) );
            $controller = new WC_REST_Orders_Controller();
            foreach ( $items as $order ) {
                $data = $controller->prepare_object_for_response( $order, $request )->get_data(); $data['_notes'] = array(); $data['_refunds'] = array();
                foreach ( wc_get_order_notes( array( 'order_id' => $order->get_id(), 'limit' => 10000, 'orderby' => 'id', 'order' => 'ASC' ) ) as $note ) { $data['_notes'][] = array( 'id' => $note->id, 'note' => $note->content, 'customer_note' => $note->customer_note, 'added_by' => $note->added_by ?? '', 'date_created_gmt' => wc_rest_prepare_date_response( $note->date_created ) ); }
                $request->set_param( 'order_id', $order->get_id() ); $refund_controller = new WC_REST_Order_Refunds_Controller();
                foreach ( $order->get_refunds() as $refund ) { $data['_refunds'][] = $refund_controller->prepare_object_for_response( $refund, $request )->get_data(); }
                $records[] = $data;
                $consumed++; if ( microtime( true ) - $started > 3 ) { break; }
            }
        } elseif ( $kind === 'products' ) {
            $consumed = 0;
            $items = wc_get_products( array( 'limit' => $limit, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC', 'status' => array( 'publish', 'draft', 'pending', 'private', 'future' ), 'return' => 'objects' ) );
            $controller = new WC_REST_Products_Controller(); $variation_controller = new WC_REST_Product_Variations_Controller();
            foreach ( $items as $product ) {
                $data = $controller->prepare_object_for_response( $product, $request )->get_data(); $data['_seo'] = self::seo( $product->get_id() ); $data['_attachments'] = array();
                foreach ( array_unique( array_merge( array( $product->get_image_id() ), $product->get_gallery_image_ids() ) ) as $attachment ) { if ( $attachment ) { $data['_attachments'][] = get_attachment_link( $attachment ); $data['_attachments'][] = add_query_arg( 'attachment_id', $attachment, home_url( '/' ) ); } }
                if ( $product->is_type( 'variable' ) ) { $data['_variations'] = array(); foreach ( $product->get_children() as $id ) { $variation = wc_get_product( $id ); if ( $variation ) { $data['_variations'][] = $variation_controller->prepare_object_for_response( $variation, $request )->get_data(); } } }
                $records[] = $data;
                $consumed++; if ( microtime( true ) - $started > 3 ) { break; }
            }
        } elseif ( $kind === 'coupons' ) {
            $items = get_posts( array( 'post_type' => 'shop_coupon', 'post_status' => 'publish', 'numberposts' => $limit, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC' ) ); $controller = new WC_REST_Coupons_Controller();
            foreach ( $items as $post ) { $records[] = $controller->prepare_object_for_response( new WC_Coupon( $post->ID ), $request )->get_data(); }
        } elseif ( $kind === 'reviews' ) {
            $items = get_comments( array( 'post_type' => 'product', 'status' => 'approve', 'number' => $limit, 'offset' => $offset, 'orderby' => 'comment_ID', 'order' => 'ASC' ) );
            foreach ( $items as $comment ) { $records[] = array( 'id' => (int) $comment->comment_ID, 'product_id' => (int) $comment->comment_post_ID, 'status' => 'approved', 'review' => $comment->comment_content, 'reviewer' => $comment->comment_author, 'rating' => (int) get_comment_meta( $comment->comment_ID, 'rating', true ), 'date_created_gmt' => $comment->comment_date_gmt ); }
        } else { throw new RuntimeException( 'UNKNOWN_EXPORT_STAGE' ); }
        $consumed = $consumed === null ? count( $items ) : $consumed;
        return array( 'records' => $records, 'next' => $offset + $consumed, 'done' => $consumed === count( $items ) && count( $items ) < $limit );
    }
    public static function remove() { wp_clear_scheduled_hook( 'ecommbd_migrate_tick' ); delete_option( self::OPTION ); delete_transient( 'ecommbd_export_lock' ); }
}
EcommBD_Migrator::boot();
register_deactivation_hook( __FILE__, array( 'EcommBD_Migrator', 'remove' ) );
