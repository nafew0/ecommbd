<?php
/**
 * Creates the synthetic store, exports every stage and checks what is (and is never) exported.
 *
 * Run once per fresh disposable site: wp eval-file tests/fixture.php hpos=yes|no
 * The export is written inside the container only (/tmp/ecommbd-export.json): it holds
 * synthetic password hashes and must never be copied into the repository.
 *
 * @package EcommBD_Migrator
 */

require_once __DIR__ . '/support.php';

// "hpos=yes" or "hpos=no": the storage mode run.sh switched on. It must really be in use.
$ecommbd_expect_hpos = in_array( 'hpos=yes', isset( $args ) ? (array) $args : array(), true );
$ecommbd_uses_hpos   = class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' ) && \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
ecommbd_test_assert( $ecommbd_expect_hpos === $ecommbd_uses_hpos, 'ORDER_STORAGE_NOT_AS_EXPECTED' );

wp_set_current_user( 1 );
$GLOBALS['wp_rewrite']->set_permalink_structure( '/%postname%/' );
update_option( 'woocommerce_currency', 'BDT' );
update_option( 'woocommerce_default_country', 'BD:BD-13' );
update_option( 'woocommerce_calc_taxes', 'no' );
update_option( 'woocommerce_weight_unit', 'kg' );
update_option(
	'woocommerce_permalinks',
	array(
		'product_base'  => '/item',
		'category_base' => 'shop-category',
	)
);

// Catalog: nested Bangla category, a simple product and a variable product with Bangla options.
$category = wp_insert_term( 'পোশাক', 'product_cat', array( 'slug' => 'poshak' ) );
$child    = wp_insert_term(
	'Panjabi',
	'product_cat',
	array(
		'slug'   => 'panjabi',
		'parent' => $category['term_id'],
	)
);
$product  = new WC_Product_Simple();
$product->set_name( 'Fixture Panjabi' );
$product->set_slug( 'fixture-panjabi' );
$product->set_regular_price( '1500' );
$product->set_sku( 'FIXTURE-PANJABI' );
$product->set_manage_stock( true );
$product->set_stock_quantity( 30 );
$product->set_weight( '0.4' );
$product->set_category_ids( array( $child['term_id'] ) );
$product->set_description( '<p>নরম সুতি</p>[vc_row]<script>alert(1)</script>' );
$product->update_meta_data( 'supplier_api_key', 'synthetic-product-secret' );
$product->update_meta_data( 'fabric', 'Cotton' );
$product->save();
update_post_meta( $product->get_id(), '_yoast_wpseo_title', 'Fixture SEO' );

$variable   = new WC_Product_Variable();
$attributes = array();
$variable->set_name( 'Fixture Shirt' );
$variable->set_slug( 'fixture-shirt' );
foreach (
	array(
		'Size'   => array( 'M', 'L' ),
		'Colour' => array( 'লাল', 'Blue' ),
	) as $name => $values
) {
	$attribute = new WC_Product_Attribute();
	$attribute->set_name( $name );
	$attribute->set_options( $values );
	$attribute->set_visible( true );
	$attribute->set_variation( true );
	$attributes[] = $attribute;
}
$variable->set_attributes( $attributes );
$variable->save();
foreach ( array( 'M', 'L' ) as $size ) {
	foreach ( array( 'লাল', 'Blue' ) as $colour ) {
		$variation = new WC_Product_Variation();
		$variation->set_parent_id( $variable->get_id() );
		$variation->set_attributes(
			array(
				'size'   => $size,
				'colour' => $colour,
			)
		);
		$variation->set_regular_price( '800' );
		$variation->set_manage_stock( true );
		$variation->set_stock_quantity( 10 );
		$variation->save();
	}
}
WC_Product_Variable::sync( $variable->get_id() );

// A customer, plus the admin who also has the customer role: the admin's hash must never leave.
$customer = new WC_Customer();
$customer->set_email( 'woo-fixture@example.com' );
$customer->set_username( 'woo-fixture' );
$customer->set_password( 'Fixture-password-2026!' );
$customer->set_first_name( 'Fixture' );
$customer->set_last_name( 'Customer' );
$customer->set_billing_phone( '01712345678' );
$customer->set_billing_address_1( 'House 12 Road 5' );
$customer->set_billing_country( 'BD' );
$customer->set_billing_state( 'BD-13' );
$customer->set_billing_city( 'Dhanmondi' );
$customer->update_meta_data( 'otp_secret', 'synthetic-customer-secret' );
$customer->update_meta_data( 'preferred_courier', 'Pathao' );
$customer->save();
get_user_by( 'id', 1 )->add_role( 'customer' );

// Orders with secret-looking meta, private meta and a nested gateway response.
$order = wc_create_order( array( 'customer_id' => $customer->get_id() ) );
$order->add_product( $product, 1 );
$order->set_address( $customer->get_billing(), 'billing' );
$order->set_address( $customer->get_billing(), 'shipping' );
$order->set_payment_method( 'cod' );
$shipping = new WC_Order_Item_Shipping();
$shipping->set_method_title( 'Standard' );
$shipping->set_total( '60' );
$shipping->add_meta_data( 'courier_auth_token', 'synthetic-item-secret' );
$order->add_item( $shipping );
$order->calculate_totals();
$order->set_status( 'processing' );
$order->set_transaction_id( 'TRX-FIXTURE-1' );
$order->update_meta_data( '_bkash_payment_id', 'synthetic-private-meta' );
$order->update_meta_data( 'bkash_token', 'synthetic-order-secret' );
$order->update_meta_data(
	'gateway_response',
	array(
		'trxID'        => 'TRX-FIXTURE-1',
		'statusCode'   => '0000',
		'access_token' => 'synthetic-nested-secret',
	)
);
$order->update_meta_data( 'delivery_slot', 'Evening' );
$order->save();
$order->add_order_note( 'Fixture private note' );
$order->add_order_note( 'Fixture customer note', true );

$history = wc_create_order( array( 'customer_id' => $customer->get_id() ) );
$history->add_product( $product, 2 );
$history->set_address( $customer->get_billing(), 'billing' );
$history->set_total( '2999.25' );
$history->set_status( 'completed' );
$history->save();
wc_create_refund(
	array(
		'order_id'       => $history->get_id(),
		'amount'         => '125.25',
		'reason'         => 'Fixture refund',
		'refund_payment' => false,
		'restock_items'  => false,
	)
);

// A coupon with plugin restriction meta (private) and a secret-looking key.
$coupon = new WC_Coupon();
$coupon->set_code( 'fixture10' );
$coupon->set_discount_type( 'percent' );
$coupon->set_amount( '10' );
$coupon->set_usage_limit( 20 );
$coupon->update_meta_data( '_wt_category_restriction', 'panjabi' );
$coupon->update_meta_data( 'partner_api_key', 'synthetic-coupon-secret' );
$coupon->save();

wp_insert_comment(
	array(
		'comment_post_ID'  => $product->get_id(),
		'comment_author'   => 'Fixture reviewer',
		'comment_content'  => '<p>Great</p><script>bad()</script>',
		'comment_type'     => 'review',
		'comment_approved' => 1,
	)
);

// A page, for the page redirect rows.
wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'About us',
		'post_name'    => 'about-us',
		'post_content' => 'Fixture page',
	)
);

// A shipping zone whose flat-rate settings also hold courier credentials.
$zone = new WC_Shipping_Zone();
$zone->set_zone_name( 'Inside Dhaka' );
$zone->add_location( 'BD:BD-13', 'state' );
$zone->save();
$instance_id = $zone->add_shipping_method( 'flat_rate' );
update_option(
	'woocommerce_flat_rate_' . $instance_id . '_settings',
	array(
		'title'           => 'Dhaka delivery',
		'tax_status'      => 'none',
		'cost'            => '60',
		'courier_api_key' => 'synthetic-courier-secret',
		'password'        => 'synthetic-courier-password',
	)
);

// Export every stage in pages of 2, as small chunks would.
$all = array();
foreach ( EcommBD_Migrator::STAGES as $kind ) {
	$offset       = 0;
	$all[ $kind ] = array();
	do {
		$page         = EcommBD_Migrator_Exporter::export( $kind, $offset, 2 );
		$all[ $kind ] = array_merge( $all[ $kind ], $page['records'] );
		$offset       = $page['next'];
	} while ( ! $page['done'] );
}
$json = wp_json_encode( $all, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

// Customers: never the admin, and every row is customer-only.
foreach ( $all['customers'] as $row ) {
	ecommbd_test_assert( 1 !== $row['id'] && 'customer' === $row['_role'] && ! empty( $row['_password_hash'] ), 'PRIVILEGED_HASH_EXPORTED' );
}
ecommbd_test_assert( 1 === count( $all['customers'] ), 'CUSTOMER_COUNT_WRONG' );

// Nothing secret anywhere: meta, item meta, nested values, shipping method settings.
ecommbd_test_assert( false === strpos( $json, 'synthetic-' ), 'SECRET_EXPORTED' );

// Ordinary meta stays; private meta goes; nested secrets go but the rest of the value stays.
$exported_order = null;
foreach ( $all['orders'] as $row ) {
	if ( $row['id'] === $order->get_id() ) {
		$exported_order = $row;
	}
}
$order_meta = wp_list_pluck( $exported_order['meta_data'], 'value', 'key' );
ecommbd_test_assert( isset( $order_meta['delivery_slot'] ) && 'Evening' === $order_meta['delivery_slot'], 'ORDINARY_META_LOST' );
ecommbd_test_assert( ! isset( $order_meta['_bkash_payment_id'] ) && ! isset( $order_meta['bkash_token'] ), 'PRIVATE_OR_SECRET_META_EXPORTED' );
ecommbd_test_assert( 'TRX-FIXTURE-1' === $order_meta['gateway_response']['trxID'] && ! isset( $order_meta['gateway_response']['access_token'] ), 'NESTED_META_WRONG' );
ecommbd_test_assert( 'TRX-FIXTURE-1' === $exported_order['transaction_id'], 'TRANSACTION_ID_LOST' );
ecommbd_test_assert( 2 === count( $all['orders'] ) && 1 === count( $all['orders'][1]['_refunds'] ), 'ORDERS_OR_REFUNDS_LOST' );
$product_meta = wp_list_pluck( $all['products'][0]['meta_data'], 'value', 'key' );
ecommbd_test_assert( isset( $product_meta['fabric'] ) && ! isset( $product_meta['supplier_api_key'] ), 'PRODUCT_META_WRONG' );
$customer_meta = wp_list_pluck( $all['customers'][0]['meta_data'], 'value', 'key' );
ecommbd_test_assert( isset( $customer_meta['preferred_courier'] ) && ! isset( $customer_meta['otp_secret'] ), 'CUSTOMER_META_WRONG' );
ecommbd_test_assert( 4 === count( $all['products'][1]['_variations'] ), 'VARIATIONS_LOST' );

// Coupons keep every key (the core sends coupons with meta to review) but no secret value.
$coupon_meta = wp_list_pluck( $all['coupons'][0]['meta_data'], 'value', 'key' );
ecommbd_test_assert( 'panjabi' === $coupon_meta['_wt_category_restriction'] && '' === $coupon_meta['partner_api_key'], 'COUPON_META_WRONG' );

// Shipping zones: allowlisted fields only, costs kept.
$settings = $all['settings'][0];
$zone_row = $settings['shippingZones'][0];
ecommbd_test_assert( 'Inside Dhaka' === $zone_row['zone_name'] && 'BD:BD-13' === $zone_row['zone_locations'][0]['code'], 'SHIPPING_ZONE_LOST' );
ecommbd_test_assert( 'flat_rate' === $zone_row['shipping_methods'][0]['method_id'] && '60' === $zone_row['shipping_methods'][0]['costs']['cost'], 'SHIPPING_COST_LOST' );
ecommbd_test_assert( array( 'method_id', 'instance_id', 'title', 'enabled', 'costs' ) === array_keys( $zone_row['shipping_methods'][0] ), 'SHIPPING_FIELDS_NOT_ALLOWLISTED' );
$cost_fields = array_keys( $zone_row['shipping_methods'][0]['costs'] );
ecommbd_test_assert( array() === array_diff( $cost_fields, EcommBD_Migrator_Exporter::SHIPPING_COST_FIELDS ), 'SHIPPING_COSTS_NOT_ALLOWLISTED' );

// Page rows carry the slug (new) next to id, path and target (unchanged).
$page_rows = array_values(
	array_filter(
		$settings['redirects'],
		static function ( $row ) {
			return isset( $row['slug'] ) && 'about-us' === $row['slug'];
		}
	)
);
ecommbd_test_assert( 1 === count( $page_rows ) && '/about-us/' === $page_rows[0]['path'] && '/' === $page_rows[0]['target'] && is_int( $page_rows[0]['id'] ), 'PAGE_ROW_WRONG' );
ecommbd_test_assert( '/item' === $settings['permalinks']['product_base'] && 'BDT' === $settings['currency'], 'SETTINGS_WRONG' );

file_put_contents( '/tmp/ecommbd-export.json', $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions -- Disposable container only.
echo 'FIXTURE_EXPORT_OK WooCommerce ' . WC_VERSION . ' WordPress ' . get_bloginfo( 'version' ) . ' PHP ' . PHP_VERSION . ' HPOS=' . ( $ecommbd_uses_hpos ? 'yes' : 'no' ) . PHP_EOL;
