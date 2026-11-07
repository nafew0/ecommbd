<?php
/**
 * Read-only exporters.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads one page of one export stage. Nothing here writes to the store.
 *
 * Records use WooCommerce's own REST controllers (context "edit"), so they have the same shape
 * as the REST API that phase 21 imports, on WooCommerce 4 to 11 and with classic or HPOS order
 * storage. The core reads the fields it needs and ignores unknown ones.
 *
 * Never exported:
 * - password hashes of administrators, shop managers or any account with another role
 *   (see export_customers());
 * - plugin and gateway settings, WordPress options in general, the site's keys and salts;
 * - shipping method settings other than the allowlisted cost fields (courier plugins keep API
 *   keys there, see shipping_zones());
 * - meta values whose key looks secret, and private "_" meta on orders, customers and products
 *   (see clean_meta());
 * - PixelYourSite's Conversions API tokens (only the Pixel ID, see pixel_id());
 * - media files themselves: only their URLs, so the destination can fetch public images;
 * - the upload token: it only signs chunks and is never sent.
 */
final class EcommBD_Migrator_Exporter {

	/**
	 * A product or order page stops early after this many seconds, so one slow record (a product
	 * with hundreds of variations, an order with many notes) cannot use the whole run budget.
	 * The next chunk carries on from the first record that was not read.
	 */
	const PAGE_SECONDS = 3;

	/**
	 * Meta keys that look like they hold a secret. Matched anywhere in the key, any case.
	 * False positives only drop data the core does not read.
	 */
	const SECRET_KEY_PATTERN = '/token|secret|key|passw|pwd|auth|api|signature|nonce|credential|session|salt|hash|cookie|otp|cvv|card|private/i';

	/**
	 * Private ("_") meta keys the core reads. None today: the core takes the transaction ID from
	 * the order's own transaction_id field, not from meta. Add a key here only when the core
	 * starts reading it.
	 */
	const KEEP_PRIVATE_META = array();

	/**
	 * Shipping method instance settings that are costs or cost rules, never credentials.
	 */
	const SHIPPING_COST_FIELDS = array( 'cost', 'min_amount', 'requires', 'ignore_discounts', 'no_class_cost', 'type', 'tax_status' );

	/**
	 * Exports one page of a stage.
	 *
	 * @param string $kind   One of EcommBD_Migrator::STAGES.
	 * @param int    $offset Records already sent in this stage.
	 * @param int    $limit  Records wanted (1 to 100).
	 * @return array {
	 *     @type array $records Records to send.
	 *     @type int   $next    Offset of the next page.
	 *     @type bool  $done    Whether the stage is complete.
	 * }
	 * @throws RuntimeException For an unknown stage or a failed read.
	 */
	public static function export( $kind, $offset, $limit ) {
		$offset = max( 0, (int) $offset );
		$limit  = max( 1, min( EcommBD_Migrator_Uploader::MAX_RECORDS, (int) $limit ) );

		switch ( $kind ) {
			case 'settings':
				return array(
					'records' => 0 === $offset ? array( self::settings() ) : array(),
					'next'    => 1,
					'done'    => true,
				);
			case 'categories':
			case 'tags':
				return self::export_terms( 'categories' === $kind ? 'product_cat' : 'product_tag', $offset, $limit );
			case 'products':
				return self::export_products( $offset, $limit );
			case 'customers':
				return self::export_customers( $offset, $limit );
			case 'orders':
				return self::export_orders( $offset, $limit );
			case 'coupons':
				return self::export_coupons( $offset, $limit );
			case 'reviews':
				return self::export_reviews( $offset, $limit );
			default:
				throw new RuntimeException( 'UNKNOWN_EXPORT_STAGE' );
		}
	}

	/**
	 * Store settings, kept for reference on the destination (it never applies them silently).
	 *
	 * Sent as the "settings" record and again in the final manifest.
	 *
	 * @return array
	 */
	public static function settings() {
		$permalinks = (array) get_option( 'woocommerce_permalinks', array() );
		$warnings   = array();
		if ( defined( 'ICL_SITEPRESS_VERSION' ) || defined( 'POLYLANG_VERSION' ) ) {
			$warnings[] = 'PRIMARY_LANGUAGE_ONLY_REVIEW';
		}
		if ( class_exists( 'WC_Subscriptions' ) || class_exists( 'WC_Bookings' ) ) {
			$warnings[] = 'SUBSCRIPTIONS_BOOKINGS_NOT_SUPPORTED';
		}

		return array(
			'id'               => 1,
			'currency'         => get_woocommerce_currency(),
			'pricesIncludeTax' => wc_prices_include_tax(),
			'taxesEnabled'     => wc_tax_enabled(),
			'weightUnit'       => get_option( 'woocommerce_weight_unit', 'kg' ),
			'wooVersion'       => WC_VERSION,
			'wordpressVersion' => get_bloginfo( 'version' ),
			'permalinks'       => array(
				'product_base'   => isset( $permalinks['product_base'] ) ? (string) $permalinks['product_base'] : '',
				'category_base'  => isset( $permalinks['category_base'] ) ? (string) $permalinks['category_base'] : '',
				'tag_base'       => isset( $permalinks['tag_base'] ) ? (string) $permalinks['tag_base'] : '',
				'attribute_base' => isset( $permalinks['attribute_base'] ) ? (string) $permalinks['attribute_base'] : '',
			),
			'pixelId'          => self::pixel_id(),
			'shippingZones'    => self::shipping_zones(),
			'redirects'        => self::redirects(),
			'warnings'         => $warnings,
		);
	}

	/**
	 * Yoast or RankMath SEO title and description of a product or product category.
	 *
	 * @param int  $id   Post or term ID.
	 * @param bool $term Whether $id is a term.
	 * @return array { title: string, description: string }
	 */
	public static function seo( $id, $term = false ) {
		$object = $term ? get_term( $id ) : get_post( $id );
		$yoast  = array();
		if ( $term && $object && ! is_wp_error( $object ) ) {
			// Yoast keeps taxonomy SEO in one option, not in term meta.
			$options = get_option( 'wpseo_taxonomy_meta', array() );
			if ( isset( $options[ $object->taxonomy ][ $id ] ) && is_array( $options[ $object->taxonomy ][ $id ] ) ) {
				$yoast = $options[ $object->taxonomy ][ $id ];
			}
		}

		$result = array();
		$fields = array(
			'title'       => array( 'wpseo_title', '_yoast_wpseo_title' ),
			'description' => array( 'wpseo_desc', '_yoast_wpseo_metadesc' ),
		);
		foreach ( $fields as $field => $keys ) {
			if ( $term ) {
				$value = isset( $yoast[ $keys[0] ] ) ? $yoast[ $keys[0] ] : '';
			} else {
				$value = get_post_meta( $id, $keys[1], true );
			}
			if ( $value && function_exists( 'wpseo_replace_vars' ) ) {
				$value = wpseo_replace_vars( $value, $object );
			}
			if ( ! $value ) {
				$value = $term ? get_term_meta( $id, 'rank_math_' . $field, true ) : get_post_meta( $id, 'rank_math_' . $field, true );
				if ( $value && is_callable( array( '\RankMath\Helper', 'replace_vars' ) ) ) {
					$value = \RankMath\Helper::replace_vars( $value, $object );
				}
			}
			$result[ $field ] = is_scalar( $value ) ? (string) $value : '';
		}

		return $result;
	}

	/**
	 * Removes meta entries that may hold secrets.
	 *
	 * The rule:
	 * - A key that looks secret (token, secret, key, password, auth, api, signature, nonce…) is
	 *   always handled, at any depth inside array values too. Payment and courier plugins often
	 *   save whole API responses, including tokens, as order meta.
	 * - "drop" (orders, customers, products): such entries are removed, and so are private
	 *   "_"-prefixed keys, which are plugin internals, unless listed in KEEP_PRIVATE_META.
	 * - "redact" (coupons): every entry is kept and only secret-looking values are emptied. The
	 *   core sends any coupon that has meta to manual review, and plugin restrictions live in
	 *   private meta. Dropping them would make a restricted coupon look like a plain one.
	 *
	 * @param mixed  $meta REST meta_data: a list of WC_Meta_Data objects or arrays.
	 * @param string $mode "drop" or "redact".
	 * @return array Clean list of { id, key, value, … } arrays.
	 */
	public static function clean_meta( $meta, $mode = 'drop' ) {
		$clean = array();
		foreach ( is_array( $meta ) ? $meta : array() as $entry ) {
			$entry = self::to_array( $entry );
			if ( ! isset( $entry['key'] ) || ! is_string( $entry['key'] ) ) {
				continue;
			}
			$secret  = 1 === preg_match( self::SECRET_KEY_PATTERN, $entry['key'] );
			$private = 0 === strpos( $entry['key'], '_' ) && ! in_array( $entry['key'], self::KEEP_PRIVATE_META, true );
			if ( 'redact' === $mode ) {
				if ( $secret ) {
					$entry['value'] = '';
					unset( $entry['display_value'] );
				}
			} elseif ( $secret || $private ) {
				continue;
			}
			foreach ( array( 'value', 'display_value' ) as $field ) {
				if ( isset( $entry[ $field ] ) && ( is_array( $entry[ $field ] ) || is_object( $entry[ $field ] ) ) ) {
					$entry[ $field ] = self::scrub( self::to_array( $entry[ $field ] ) );
				}
			}
			$clean[] = $entry;
		}

		return $clean;
	}

	/**
	 * Shipping zones as a reference list, from an allowlist of fields.
	 *
	 * Version 0.1.0 sent whole WC_Shipping_Method objects. Their settings can hold courier API
	 * keys and passwords, so only these fields are sent now: zone ID, name, order and regions;
	 * for each method its ID, instance ID, title, enabled flag and cost fields.
	 *
	 * @return array List of zones.
	 */
	public static function shipping_zones() {
		if ( ! class_exists( 'WC_Shipping_Zones' ) ) {
			return array();
		}

		$zones = array();
		foreach ( WC_Shipping_Zones::get_zones() as $zone ) {
			$locations = array();
			foreach ( isset( $zone['zone_locations'] ) ? (array) $zone['zone_locations'] : array() as $location ) {
				$location    = (array) $location;
				$locations[] = array(
					'code' => isset( $location['code'] ) ? (string) $location['code'] : '',
					'type' => isset( $location['type'] ) ? (string) $location['type'] : '',
				);
			}

			$methods = array();
			foreach ( isset( $zone['shipping_methods'] ) ? (array) $zone['shipping_methods'] : array() as $method ) {
				if ( ! $method instanceof WC_Shipping_Method ) {
					continue;
				}
				if ( empty( $method->instance_settings ) && method_exists( $method, 'init_instance_settings' ) ) {
					$method->init_instance_settings();
				}
				$costs = array();
				foreach ( (array) $method->instance_settings as $field => $value ) {
					if ( is_scalar( $value ) && ( in_array( $field, self::SHIPPING_COST_FIELDS, true ) || preg_match( '/^class_cost_\d+$/', (string) $field ) ) ) {
						$costs[ $field ] = substr( (string) $value, 0, 200 );
					}
				}
				$methods[] = array(
					'method_id'   => (string) $method->id,
					'instance_id' => (int) $method->get_instance_id(),
					'title'       => (string) $method->get_title(),
					'enabled'     => 'yes' === $method->enabled,
					'costs'       => $costs,
				);
			}

			$zones[] = array(
				'zone_id'          => isset( $zone['zone_id'] ) ? (int) $zone['zone_id'] : 0,
				'zone_name'        => isset( $zone['zone_name'] ) ? (string) $zone['zone_name'] : '',
				'zone_order'       => isset( $zone['zone_order'] ) ? (int) $zone['zone_order'] : 0,
				'zone_locations'   => $locations,
				'shipping_methods' => $methods,
			);
		}

		return $zones;
	}

	/**
	 * Old addresses the destination should redirect: published pages and Redirection rules.
	 *
	 * Page rows carry the page's slug (post_name) so the core can map an old page to the store
	 * page with the same address; its target stays "/" until then.
	 *
	 * @return array List of { path, target } rows; page rows also have id and slug.
	 */
	public static function redirects() {
		global $wpdb;

		$rows = array();

		// One read per export; at most 500 pages are mapped.
		$pages = get_posts(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
				'numberposts' => 500, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_numberposts
				'orderby'     => 'ID',
				'order'       => 'ASC',
			)
		);
		foreach ( $pages as $page ) {
			$rows[] = array(
				'id'     => (int) $page->ID,
				'slug'   => (string) $page->post_name,
				'path'   => wp_parse_url( get_permalink( $page ), PHP_URL_PATH ),
				'target' => '/',
			);
		}

		// The Redirection plugin's table is optional. Only plain (non-regex) 301 rules to a local
		// path are sent; anything else could point shoppers at another site.
		$table = $wpdb->prefix . 'redirection_items';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Another plugin's table; read once per export.
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ) !== $table ) {
			return $rows;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- The table name is the site prefix plus a constant; WordPress 5.8 has no %i placeholder.
		$items = $wpdb->get_results( "SELECT url, action_data, action_type, action_code, regex FROM `{$table}` WHERE status = 'enabled' LIMIT 1000", ARRAY_A );
		$home  = home_url();
		foreach ( (array) $items as $item ) {
			if ( ! empty( $item['regex'] ) || 'url' !== $item['action_type'] || 301 !== (int) $item['action_code'] ) {
				continue;
			}
			$target = (string) $item['action_data'];
			if ( 0 === strpos( $target, $home ) ) {
				$target = substr( $target, strlen( $home ) );
			}
			if ( 0 === strpos( $target, '/' ) && 0 !== strpos( $target, '//' ) ) {
				$rows[] = array(
					'path'   => (string) $item['url'],
					'target' => $target,
				);
			}
		}

		return $rows;
	}

	/**
	 * Product categories or tags.
	 *
	 * @param string $taxonomy product_cat or product_tag.
	 * @param int    $offset   Offset.
	 * @param int    $limit    Limit.
	 * @return array Page.
	 * @throws RuntimeException When the terms cannot be read.
	 */
	private static function export_terms( $taxonomy, $offset, $limit ) {
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
				'number'     => $limit,
				'offset'     => $offset,
				'orderby'    => 'term_id',
				'order'      => 'ASC',
			)
		);
		if ( is_wp_error( $terms ) ) {
			throw new RuntimeException( 'TAXONOMY_READ_FAILED' );
		}

		$records = array();
		foreach ( $terms as $term ) {
			$link      = get_term_link( $term );
			$records[] = array(
				'id'          => (int) $term->term_id,
				'name'        => $term->name,
				'slug'        => $term->slug,
				'parent'      => (int) $term->parent,
				'description' => $term->description,
				'link'        => is_wp_error( $link ) ? '' : $link,
				'_seo'        => self::seo( $term->term_id, true ),
			);
		}

		return self::page( $records, $offset, count( $terms ), count( $terms ), $limit );
	}

	/**
	 * Products with their variations, SEO fields and image URLs.
	 *
	 * @param int $offset Offset.
	 * @param int $limit  Limit.
	 * @return array Page.
	 */
	private static function export_products( $offset, $limit ) {
		$started              = microtime( true );
		$products             = wc_get_products(
			array(
				'limit'   => $limit,
				'offset'  => $offset,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'status'  => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'return'  => 'objects',
			)
		);
		$request              = self::request();
		$controller           = new WC_REST_Products_Controller();
		$variation_controller = new WC_REST_Product_Variations_Controller();
		$records              = array();
		foreach ( $products as $product ) {
			$data                 = $controller->prepare_object_for_response( $product, $request )->get_data();
			$data['meta_data']    = self::clean_meta( isset( $data['meta_data'] ) ? $data['meta_data'] : array() );
			$data['_seo']         = self::seo( $product->get_id() );
			$data['_attachments'] = array();
			$images               = array_unique( array_merge( array( $product->get_image_id() ), $product->get_gallery_image_ids() ) );
			foreach ( $images as $attachment ) {
				if ( $attachment ) {
					$data['_attachments'][] = get_attachment_link( $attachment );
					$data['_attachments'][] = add_query_arg( 'attachment_id', $attachment, home_url( '/' ) );
				}
			}
			if ( $product->is_type( 'variable' ) ) {
				$data['_variations'] = array();
				foreach ( $product->get_children() as $child_id ) {
					$variation = wc_get_product( $child_id );
					if ( $variation ) {
						$row                   = $variation_controller->prepare_object_for_response( $variation, $request )->get_data();
						$row['meta_data']      = self::clean_meta( isset( $row['meta_data'] ) ? $row['meta_data'] : array() );
						$data['_variations'][] = $row;
					}
				}
			}
			$records[] = $data;
			if ( microtime( true ) - $started > self::PAGE_SECONDS ) {
				break;
			}
		}

		return self::page( $records, $offset, count( $records ), count( $products ), $limit );
	}

	/**
	 * Customers with their password hashes.
	 *
	 * Only accounts whose ONLY role is "customer" and who have no admin capability are sent.
	 * Why: the destination needs shoppers' hashes so they keep their passwords. An administrator's
	 * or shop manager's hash unlocks this WordPress site and everything on it; if it leaked or
	 * were cracked, the old site could be taken over. A "customer + editor" account is skipped
	 * entirely, because the same hash unlocks the editor account. Staff get new Ecomm BD logins.
	 *
	 * @param int $offset Offset.
	 * @param int $limit  Limit.
	 * @return array Page.
	 */
	private static function export_customers( $offset, $limit ) {
		$users      = get_users(
			array(
				'role'    => 'customer',
				'number'  => $limit,
				'offset'  => $offset,
				'orderby' => 'ID',
				'order'   => 'ASC',
			)
		);
		$request    = self::request();
		$controller = new WC_REST_Customers_Controller();
		$records    = array();
		foreach ( $users as $user ) {
			// phpcs:ignore WordPress.WP.Capabilities.Unknown -- manage_woocommerce is WooCommerce's shop manager capability.
			if ( array_diff( (array) $user->roles, array( 'customer' ) ) || user_can( $user, 'manage_options' ) || user_can( $user, 'manage_woocommerce' ) ) {
				continue;
			}
			$data                   = $controller->prepare_item_for_response( $user, $request )->get_data();
			$data['meta_data']      = self::clean_meta( isset( $data['meta_data'] ) ? $data['meta_data'] : array() );
			$data['_password_hash'] = $user->user_pass;
			$data['_role']          = 'customer';
			$records[]              = $data;
		}

		// Skipped accounts still count as read, so paging moves past them.
		return self::page( $records, $offset, count( $users ), count( $users ), $limit );
	}

	/**
	 * Orders with notes and full refunds, through WooCommerce's API (classic or HPOS).
	 *
	 * @param int $offset Offset.
	 * @param int $limit  Limit.
	 * @return array Page.
	 */
	private static function export_orders( $offset, $limit ) {
		$started           = microtime( true );
		$orders            = wc_get_orders(
			array(
				'limit'   => $limit,
				'offset'  => $offset,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'type'    => 'shop_order',
				'status'  => array_keys( wc_get_order_statuses() ),
				'return'  => 'objects',
			)
		);
		$request           = self::request();
		$controller        = new WC_REST_Orders_Controller();
		$refund_controller = new WC_REST_Order_Refunds_Controller();
		$records           = array();
		foreach ( $orders as $order ) {
			$data             = self::clean_order( $controller->prepare_object_for_response( $order, $request )->get_data() );
			$data['_notes']   = array();
			$data['_refunds'] = array();
			$notes            = wc_get_order_notes(
				array(
					'order_id' => $order->get_id(),
					'limit'    => 10000,
					'orderby'  => 'id',
					'order'    => 'ASC',
				)
			);
			foreach ( $notes as $note ) {
				$data['_notes'][] = array(
					'id'               => $note->id,
					'note'             => $note->content,
					'customer_note'    => $note->customer_note,
					'added_by'         => isset( $note->added_by ) ? $note->added_by : '',
					'date_created_gmt' => wc_rest_prepare_date_response( $note->date_created ),
				);
			}
			$request->set_param( 'order_id', $order->get_id() );
			foreach ( $order->get_refunds() as $refund ) {
				$data['_refunds'][] = self::clean_order( $refund_controller->prepare_object_for_response( $refund, $request )->get_data() );
			}
			$records[] = $data;
			if ( microtime( true ) - $started > self::PAGE_SECONDS ) {
				break;
			}
		}

		return self::page( $records, $offset, count( $records ), count( $orders ), $limit );
	}

	/**
	 * Coupons. Meta is redacted, not dropped (see clean_meta()).
	 *
	 * @param int $offset Offset.
	 * @param int $limit  Limit.
	 * @return array Page.
	 */
	private static function export_coupons( $offset, $limit ) {
		$posts      = get_posts(
			array(
				'post_type'   => 'shop_coupon',
				'post_status' => 'publish',
				'numberposts' => $limit,
				'offset'      => $offset,
				'orderby'     => 'ID',
				'order'       => 'ASC',
			)
		);
		$request    = self::request();
		$controller = new WC_REST_Coupons_Controller();
		$records    = array();
		foreach ( $posts as $post ) {
			$data              = $controller->prepare_object_for_response( new WC_Coupon( $post->ID ), $request )->get_data();
			$data['meta_data'] = self::clean_meta( isset( $data['meta_data'] ) ? $data['meta_data'] : array(), 'redact' );
			$records[]         = $data;
		}

		return self::page( $records, $offset, count( $posts ), count( $posts ), $limit );
	}

	/**
	 * Approved product reviews.
	 *
	 * @param int $offset Offset.
	 * @param int $limit  Limit.
	 * @return array Page.
	 */
	private static function export_reviews( $offset, $limit ) {
		$comments = get_comments(
			array(
				'post_type' => 'product',
				'status'    => 'approve',
				'number'    => $limit,
				'offset'    => $offset,
				'orderby'   => 'comment_ID',
				'order'     => 'ASC',
			)
		);
		$records  = array();
		foreach ( $comments as $comment ) {
			$records[] = array(
				'id'               => (int) $comment->comment_ID,
				'product_id'       => (int) $comment->comment_post_ID,
				'status'           => 'approved',
				'review'           => $comment->comment_content,
				'reviewer'         => $comment->comment_author,
				'rating'           => (int) get_comment_meta( $comment->comment_ID, 'rating', true ),
				'date_created_gmt' => $comment->comment_date_gmt,
			);
		}

		return self::page( $records, $offset, count( $comments ), count( $comments ), $limit );
	}

	/**
	 * Cleans meta on an order or refund and on each of its items.
	 *
	 * @param array $data REST order or refund.
	 * @return array
	 */
	private static function clean_order( array $data ) {
		$data['meta_data'] = self::clean_meta( isset( $data['meta_data'] ) ? $data['meta_data'] : array() );
		foreach ( array( 'line_items', 'tax_lines', 'shipping_lines', 'fee_lines', 'coupon_lines' ) as $list ) {
			if ( empty( $data[ $list ] ) || ! is_array( $data[ $list ] ) ) {
				continue;
			}
			foreach ( $data[ $list ] as $index => $item ) {
				if ( is_array( $item ) && isset( $item['meta_data'] ) ) {
					$data[ $list ][ $index ]['meta_data'] = self::clean_meta( $item['meta_data'] );
				}
			}
		}

		return $data;
	}

	/**
	 * Removes secret-looking keys at any depth of an array value.
	 *
	 * @param array $value Value.
	 * @return array
	 */
	private static function scrub( array $value ) {
		foreach ( $value as $key => $item ) {
			if ( is_string( $key ) && preg_match( self::SECRET_KEY_PATTERN, $key ) ) {
				unset( $value[ $key ] );
			} elseif ( is_array( $item ) || is_object( $item ) ) {
				$value[ $key ] = self::scrub( self::to_array( $item ) );
			}
		}

		return $value;
	}

	/**
	 * Turns a meta entry or value into an array.
	 *
	 * @param mixed $value WC_Meta_Data, object or array.
	 * @return array
	 */
	private static function to_array( $value ) {
		if ( $value instanceof WC_Meta_Data ) {
			return $value->get_data();
		}
		if ( is_object( $value ) ) {
			$decoded = json_decode( (string) wp_json_encode( $value ), true );

			return is_array( $decoded ) ? $decoded : array();
		}

		return is_array( $value ) ? $value : array();
	}

	/**
	 * The PixelYourSite Facebook Pixel ID, if one is set.
	 *
	 * The destination has one Pixel field: send the first valid ID, never several joined
	 * together, and never the Conversions API tokens stored next to it.
	 *
	 * @return string Digits only, or "".
	 */
	private static function pixel_id() {
		$settings = get_option( 'pys_facebook', array() );
		$ids      = isset( $settings['pixel_id'] ) ? (array) $settings['pixel_id'] : array();
		if ( function_exists( '\PixelYourSite\Facebook' ) ) {
			$ids = (array) \PixelYourSite\Facebook()->getPixelIDs();
		}
		foreach ( $ids as $id ) {
			if ( is_scalar( $id ) && preg_match( '/^[0-9]{5,30}$/', (string) $id ) ) {
				return (string) $id;
			}
		}

		return '';
	}

	/**
	 * A REST request in "edit" context, so controllers return every field.
	 *
	 * No permission check runs: controllers only check permissions in their route callbacks,
	 * and this code is only reached by a user with manage_woocommerce (re-checked on each run).
	 *
	 * @return WP_REST_Request
	 */
	private static function request() {
		$request = new WP_REST_Request( 'GET' );
		$request->set_param( 'context', 'edit' );

		return $request;
	}

	/**
	 * Builds a page result.
	 *
	 * @param array $records  Records to send.
	 * @param int   $offset   Offset of this page.
	 * @param int   $consumed Source rows read (includes skipped ones).
	 * @param int   $fetched  Source rows returned by the query.
	 * @param int   $limit    Rows asked for.
	 * @return array
	 */
	private static function page( array $records, $offset, $consumed, $fetched, $limit ) {
		return array(
			'records' => $records,
			'next'    => $offset + $consumed,
			'done'    => $consumed === $fetched && $fetched < $limit,
		);
	}
}
