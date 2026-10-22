<?php
// Run with wp eval-file against a disposable WordPress/WooCommerce installation only.
wp_set_current_user( 1 );
update_option( 'woocommerce_currency', 'BDT' );
update_option( 'woocommerce_default_country', 'BD:BD-13' );
update_option( 'woocommerce_calc_taxes', 'no' );
update_option( 'woocommerce_weight_unit', 'kg' );
update_option( 'woocommerce_permalinks', array( 'product_base' => '/item', 'category_base' => 'shop-category' ) );
$category = wp_insert_term( 'পোশাক', 'product_cat', array( 'slug' => 'poshak' ) );
$child = wp_insert_term( 'Panjabi', 'product_cat', array( 'slug' => 'panjabi', 'parent' => $category['term_id'] ) );
$product = new WC_Product_Simple(); $product->set_name( 'Fixture Panjabi' ); $product->set_slug( 'fixture-panjabi' ); $product->set_regular_price( '1500' ); $product->set_sku( 'FIXTURE-PANJABI' ); $product->set_manage_stock( true ); $product->set_stock_quantity( 30 ); $product->set_weight( '0.4' ); $product->set_category_ids( array( $child['term_id'] ) ); $product->set_description( '<p>নরম সুতি</p>[vc_row]<script>alert(1)</script>' ); $product->save();
update_post_meta( $product->get_id(), '_yoast_wpseo_title', 'Fixture SEO' );
$variable = new WC_Product_Variable(); $variable->set_name( 'Fixture Shirt' ); $variable->set_slug( 'fixture-shirt' );
$attributes = array();
foreach ( array( 'Size' => array( 'M', 'L' ), 'Colour' => array( 'লাল', 'Blue' ) ) as $name => $values ) { $attribute = new WC_Product_Attribute(); $attribute->set_name( $name ); $attribute->set_options( $values ); $attribute->set_visible( true ); $attribute->set_variation( true ); $attributes[] = $attribute; }
$variable->set_attributes( $attributes ); $variable->save();
foreach ( array( 'M', 'L' ) as $size ) { foreach ( array( 'লাল', 'Blue' ) as $colour ) { $variation = new WC_Product_Variation(); $variation->set_parent_id( $variable->get_id() ); $variation->set_attributes( array( 'size' => $size, 'colour' => $colour ) ); $variation->set_regular_price( '800' ); $variation->set_manage_stock( true ); $variation->set_stock_quantity( 10 ); $variation->save(); } }
WC_Product_Variable::sync( $variable->get_id() );
$customer = new WC_Customer(); $customer->set_email( 'woo-fixture@example.com' ); $customer->set_username( 'woo-fixture' ); $customer->set_password( 'Fixture-password-2026!' ); $customer->set_first_name( 'Fixture' ); $customer->set_last_name( 'Customer' ); $customer->set_billing_phone( '01712345678' ); $customer->set_billing_address_1( 'House 12 Road 5' ); $customer->set_billing_country( 'BD' ); $customer->set_billing_state( 'BD-13' ); $customer->set_billing_city( 'Dhanmondi' ); $customer->save();
$admin = get_user_by( 'id', 1 ); $admin->add_role( 'customer' ); // Must NEVER export this hash.
$order = wc_create_order( array( 'customer_id' => $customer->get_id() ) ); $order->add_product( $product, 1 ); $order->set_address( $customer->get_billing(), 'billing' ); $order->set_address( $customer->get_billing(), 'shipping' ); $order->set_payment_method( 'cod' ); $shipping = new WC_Order_Item_Shipping(); $shipping->set_method_title( 'Standard' ); $shipping->set_total( '60' ); $order->add_item( $shipping ); $order->calculate_totals(); $order->set_status( 'processing' ); $order->save(); $order->add_order_note( 'Fixture private note' ); $order->add_order_note( 'Fixture customer note', true );
$history = wc_create_order( array( 'customer_id' => $customer->get_id() ) ); $history->add_product( $product, 2 ); $history->set_address( $customer->get_billing(), 'billing' ); $history->set_total( '2999.25' ); $history->set_status( 'completed' ); $history->save(); wc_create_refund( array( 'order_id' => $history->get_id(), 'amount' => '125.25', 'reason' => 'Fixture refund', 'refund_payment' => false, 'restock_items' => false ) );
$coupon = new WC_Coupon(); $coupon->set_code( 'fixture10' ); $coupon->set_discount_type( 'percent' ); $coupon->set_amount( '10' ); $coupon->set_usage_limit( 20 ); $coupon->save();
wp_insert_comment( array( 'comment_post_ID' => $product->get_id(), 'comment_author' => 'Fixture reviewer', 'comment_content' => '<p>Great</p><script>bad()</script>', 'comment_type' => 'review', 'comment_approved' => 1 ) );
$all = array();
foreach ( EcommBD_Migrator::STAGES as $kind ) { $offset = 0; $all[ $kind ] = array(); do { $page = EcommBD_Migrator::export( $kind, $offset, 2 ); $all[ $kind ] = array_merge( $all[ $kind ], $page['records'] ); $offset = $page['next']; } while ( ! $page['done'] ); }
foreach ( $all['customers'] as $row ) { if ( $row['id'] === 1 || $row['_role'] !== 'customer' ) { throw new RuntimeException( 'PRIVILEGED_HASH_EXPORTED' ); } }
file_put_contents( '/tmp/ecommbd-export.json', wp_json_encode( $all, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
echo 'FIXTURE_EXPORT_OK ' . WC_VERSION . ' WordPress ' . get_bloginfo( 'version' ) . ' HPOS=' . get_option( 'woocommerce_custom_orders_table_enabled', 'no' ) . PHP_EOL;
