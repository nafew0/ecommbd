<?php
/**
 * The WooCommerce → Move to Ecomm BD page.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin page and its actions.
 *
 * Flow: paste pairing details → "Check pairing details" shows the destination host (no request
 * is made yet) → the merchant ticks "Yes, this is my store" → pairing, then the first upload.
 *
 * Every action checks the manage_woocommerce capability and a WordPress nonce. The nonce only
 * proves the click came from this page; the capability check is what authorises it.
 */
final class EcommBD_Migrator_Admin {

	/**
	 * Page slug under WooCommerce.
	 */
	const PAGE = 'ecommbd-migrate';

	/**
	 * The admin-post.php action, also the nonce action for every change.
	 */
	const ACTION = 'ecommbd_migrate';

	/**
	 * Nonce action for "Check pairing details", which only displays.
	 */
	const REVIEW_NONCE = 'ecommbd_migrate_review';

	/**
	 * The admin-post.php action (and nonce action) that downloads the export file.
	 */
	const DOWNLOAD_ACTION = 'ecommbd_migrate_download';

	/**
	 * After this long without progress, the page suggests clicking "Continue now".
	 */
	const STALLED_SECONDS = 600;

	/**
	 * While an upload runs, the page reloads itself this often. Each page view also lets
	 * WP-Cron start the next background run, so an open page keeps the upload moving.
	 */
	const REFRESH_SECONDS = 30;

	/**
	 * Registers the menu and the action handler.
	 *
	 * @return void
	 */
	public static function boot() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_post_' . self::ACTION, array( __CLASS__, 'handle_action' ) );
		add_action( 'admin_post_' . self::DOWNLOAD_ACTION, array( __CLASS__, 'handle_download' ) );
	}

	/**
	 * Adds WooCommerce → Move to Ecomm BD.
	 *
	 * @return void
	 */
	public static function add_menu() {
		$hook = add_submenu_page(
			'woocommerce',
			__( 'Move to Ecomm BD', 'ecommbd-migrator' ),
			__( 'Move to Ecomm BD', 'ecommbd-migrator' ),
			EcommBD_Migrator::CAPABILITY,
			self::PAGE,
			array( __CLASS__, 'render_page' )
		);
		if ( $hook ) {
			add_action( 'admin_head-' . $hook, array( __CLASS__, 'print_head' ) );
		}
	}

	/**
	 * Prints the page's small stylesheet and, while uploading, the self-refresh.
	 *
	 * The reload goes to the plain page address (dropping old result messages) and is skipped
	 * while new pairing details are being typed, so nothing the merchant pasted is lost.
	 * Without JavaScript the page simply does not reload; "Continue now" still works.
	 *
	 * @return void
	 */
	public static function print_head() {
		$state     = EcommBD_Migrator::get_state();
		$is_get    = isset( $_SERVER['REQUEST_METHOD'] ) && 'GET' === $_SERVER['REQUEST_METHOD'];
		$uploading = null !== $state && self::is_confirmed( $state ) && empty( $state['done'] ) && empty( $state['error'] );
		$file      = EcommBD_Migrator_File::get_state();
		$exporting = null !== $file && empty( $file['done'] ) && empty( $file['error'] );
		if ( $is_get && ( $uploading || $exporting ) && ! self::cron_disabled() ) {
			wp_print_inline_script_tag(
				'setTimeout(function(){var t=document.getElementById("ecommbd-pairing");if(!t||""===t.value){window.location.replace(' . wp_json_encode( self::page_url() ) . ');}},' . ( self::REFRESH_SECONDS * 1000 ) . ');'
			);
		}
		echo '<style>.ecommbd-migrator .ecommbd-host code{font-size:1.5em;padding:6px 10px;display:inline-block}.ecommbd-migrator .ecommbd-status th{width:14em}.ecommbd-migrator textarea{width:100%;max-width:640px}</style>' . "\n";
	}

	/**
	 * Renders the page.
	 *
	 * @return void
	 */
	public static function render_page() {
		self::require_capability();
		$state  = EcommBD_Migrator::get_state();
		$review = self::review_from_request();

		echo '<div class="wrap ecommbd-migrator">';
		echo '<h1>' . esc_html__( 'Move to Ecomm BD', 'ecommbd-migrator' ) . '</h1>';
		echo '<p>' . esc_html__( 'This helper reads your store and sends a copy to your Ecomm BD store. It never changes products, orders, customers or passwords on this site. Remove it when the move is finished.', 'ecommbd-migrator' ) . '</p>';

		if ( ! EcommBD_Migrator::woocommerce_ready() ) {
			self::notice( 'error', self::error_message( 'WOOCOMMERCE_REQUIRED' ) );
			echo '</div>';
			return;
		}

		self::render_notices( $state, $review );

		if ( null !== $review && isset( $review['host'] ) ) {
			self::render_confirmation( $review['host'], $review['pairing'] );
		} elseif ( null !== $state && ! empty( $state['endpoint'] ) && ! self::is_confirmed( $state ) ) {
			try {
				self::render_confirmation( EcommBD_Migrator_Uploader::endpoint_host( $state['endpoint'] ), '' );
			} catch ( RuntimeException $error ) {
				self::notice( 'error', self::error_message( EcommBD_Migrator_Uploader::error_code( $error ) ) );
			}
		}

		if ( null !== $state ) {
			self::render_status( $state );
		}
		self::render_forms( $state, null !== $review && isset( $review['host'] ) );
		self::render_export();
		echo '</div>';
	}

	/**
	 * Handles every button: pair, confirm, resume and forget.
	 *
	 * Runs on admin-post.php, then redirects back to the page with a result or error code.
	 *
	 * @return void
	 * @throws RuntimeException Never escapes: every error becomes an error code on the page.
	 */
	public static function handle_action() {
		self::require_capability();
		check_admin_referer( self::ACTION );

		$operation = isset( $_POST['operation'] ) ? sanitize_key( wp_unslash( $_POST['operation'] ) ) : '';
		$pairing   = isset( $_POST['pairing'] ) ? sanitize_textarea_field( wp_unslash( $_POST['pairing'] ) ) : '';
		$confirmed = isset( $_POST['confirm_destination'] ) && '1' === sanitize_text_field( wp_unslash( $_POST['confirm_destination'] ) );
		$host      = isset( $_POST['confirm_host'] ) ? strtolower( sanitize_text_field( wp_unslash( $_POST['confirm_host'] ) ) ) : '';
		$args      = array();

		try {
			if ( ! EcommBD_Migrator::woocommerce_ready() ) {
				throw new RuntimeException( 'WOOCOMMERCE_REQUIRED' );
			}
			switch ( $operation ) {
				case 'forget':
					EcommBD_Migrator::remove_site_state();
					$args['ecommbd-result'] = 'removed';
					break;
				case 'pair':
					$parsed = EcommBD_Migrator_Uploader::parse_pairing( $pairing );
					self::require_confirmation( $parsed['host'], $confirmed, $host );
					EcommBD_Migrator_Uploader::pair( $parsed, get_current_user_id() );
					$args['ecommbd-result'] = EcommBD_Migrator_Uploader::run( null, true );
					break;
				case 'confirm':
					$state = EcommBD_Migrator::get_state();
					if ( null === $state || empty( $state['endpoint'] ) ) {
						throw new RuntimeException( 'NOT_PAIRED' );
					}
					self::require_confirmation( EcommBD_Migrator_Uploader::endpoint_host( $state['endpoint'] ), $confirmed, $host );
					EcommBD_Migrator_Uploader::confirm_destination( $host, get_current_user_id() );
					$args['ecommbd-result'] = EcommBD_Migrator_Uploader::run( null, true );
					break;
				case 'resume':
					$args['ecommbd-result'] = EcommBD_Migrator_Uploader::run( null, true );
					break;
				case 'export_start':
					$args['ecommbd-result'] = 'export-' . EcommBD_Migrator_File::start( get_current_user_id() );
					break;
				case 'export_resume':
					$args['ecommbd-result'] = 'export-' . EcommBD_Migrator_File::run( null, true );
					break;
				case 'export_delete':
					EcommBD_Migrator_File::remove();
					$args['ecommbd-result'] = 'export-deleted';
					break;
				default:
					throw new RuntimeException( 'UNKNOWN_OPERATION' );
			}
		} catch ( Throwable $error ) {
			$args['ecommbd-error'] = EcommBD_Migrator_Uploader::error_code( $error );
		}

		wp_safe_redirect( add_query_arg( $args, self::page_url() ) );
		exit;
	}

	/**
	 * Sends the finished export file. A GET link with its own nonce, so the browser downloads it.
	 *
	 * @return void
	 */
	public static function handle_download() {
		self::require_capability();
		check_admin_referer( self::DOWNLOAD_ACTION );
		try {
			EcommBD_Migrator_File::stream_download();
		} catch ( Throwable $error ) {
			wp_safe_redirect( add_query_arg( 'ecommbd-error', EcommBD_Migrator_Uploader::error_code( $error ), self::page_url() ) );
			exit;
		}
	}

	/**
	 * URL of the page.
	 *
	 * @return string
	 */
	public static function page_url() {
		return admin_url( 'admin.php?page=' . self::PAGE );
	}

	/**
	 * Stops with a bilingual 403 page unless the user may manage WooCommerce.
	 *
	 * @return void
	 */
	private static function require_capability() {
		if ( ! current_user_can( EcommBD_Migrator::CAPABILITY ) ) {
			wp_die(
				esc_html__( 'Sorry, you are not allowed to move this store. Only a WooCommerce shop manager or administrator can do this.', 'ecommbd-migrator' ),
				esc_html__( 'Not allowed', 'ecommbd-migrator' ),
				array( 'response' => 403 )
			);
		}
	}

	/**
	 * The merchant must tick the box, and the host on the form must be the pairing's host.
	 *
	 * The second check catches a page left open while different pairing details were pasted in
	 * another tab: the merchant confirmed one host, so only that host may receive data.
	 *
	 * @param string $expected  Host from the pairing details.
	 * @param bool   $confirmed Whether the box was ticked.
	 * @param string $host      Host the confirmation form showed.
	 * @return void
	 * @throws RuntimeException CONFIRM_DESTINATION or DESTINATION_CHANGED.
	 */
	private static function require_confirmation( $expected, $confirmed, $host ) {
		if ( ! $confirmed ) {
			throw new RuntimeException( 'CONFIRM_DESTINATION' );
		}
		if ( ! hash_equals( (string) $expected, (string) $host ) ) {
			throw new RuntimeException( 'DESTINATION_CHANGED' );
		}
	}

	/**
	 * Reads "Check pairing details". Display only: nothing is saved or sent.
	 *
	 * @return array|null Null when not reviewing; { host, pairing } or { error }.
	 */
	private static function review_from_request() {
		if ( ! isset( $_POST['ecommbd_review'] ) ) {
			return null;
		}
		check_admin_referer( self::REVIEW_NONCE );

		$raw = isset( $_POST['pairing'] ) ? sanitize_textarea_field( wp_unslash( $_POST['pairing'] ) ) : '';
		try {
			$pairing = EcommBD_Migrator_Uploader::parse_pairing( $raw );

			return array(
				'host'    => $pairing['host'],
				'pairing' => $raw,
			);
		} catch ( RuntimeException $error ) {
			return array( 'error' => EcommBD_Migrator_Uploader::error_code( $error ) );
		}
	}

	/**
	 * Shows result, error and help notices.
	 *
	 * @param array|null $state  State.
	 * @param array|null $review Review result.
	 * @return void
	 */
	private static function render_notices( $state, $review ) {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Display-only codes from this page's own redirect, checked against a fixed list.
		$result = isset( $_GET['ecommbd-result'] ) ? sanitize_key( wp_unslash( $_GET['ecommbd-result'] ) ) : '';
		$error  = isset( $_GET['ecommbd-error'] ) ? sanitize_text_field( wp_unslash( $_GET['ecommbd-error'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		if ( null !== $review && isset( $review['error'] ) ) {
			$error = $review['error'];
		}
		if ( preg_match( '/^[A-Z][A-Z_0-9]{2,60}$/', $error ) ) {
			self::notice( 'error', self::error_message( $error ), $error );
		}

		$results = array(
			'done'    => array( 'success', __( 'Upload complete. Go back to your Ecomm BD admin to check and import the data. Then remove this plugin.', 'ecommbd-migrator' ) ),
			'more'    => array( 'info', __( 'Part of your store was sent. The rest continues in the background.', 'ecommbd-migrator' ) ),
			'busy'    => array( 'warning', self::error_message( 'BUSY' ) ),
			'removed'        => array( 'success', __( 'The saved connection was removed from this site. Also revoke the helper upload token in your Ecomm BD admin.', 'ecommbd-migrator' ) ),
			'export-done'    => array( 'success', __( 'The export file is ready. Download it, then import it on the migration page of your Ecomm BD admin.', 'ecommbd-migrator' ) ),
			'export-more'    => array( 'info', __( 'Part of your store was written to the export file. The rest continues in the background.', 'ecommbd-migrator' ) ),
			'export-busy'    => array( 'warning', self::error_message( 'BUSY' ) ),
			'export-deleted' => array( 'success', __( 'The export file was deleted from this site.', 'ecommbd-migrator' ) ),
		);
		if ( isset( $results[ $result ] ) ) {
			self::notice( $results[ $result ][0], $results[ $result ][1] );
		}

		$file = EcommBD_Migrator_File::get_state();
		if ( null !== $file && ! empty( $file['error'] ) ) {
			$code   = (string) $file['error'];
			$detail = isset( $file['error_detail'] ) ? (string) $file['error_detail'] : '';
			self::notice( 'error', self::error_message( $code ), trim( $code . ' ' . $detail ) );
		}

		if ( null === $state ) {
			return;
		}
		if ( ! empty( $state['error'] ) ) {
			$code   = (string) $state['error'];
			$detail = isset( $state['error_detail'] ) ? (string) $state['error_detail'] : '';
			// Version 0.1.0 saved a sentence here instead of a code.
			$known = preg_match( '/^[A-Z][A-Z_0-9]{2,60}$/', $code );
			self::notice( 'error', self::error_message( $known ? $code : 'EXPORT_FAILED' ), trim( ( $known ? $code : 'EXPORT_FAILED' ) . ' ' . $detail ) );
		}

		$active = self::is_confirmed( $state ) && empty( $state['done'] ) && empty( $state['error'] );
		if ( $active && self::cron_disabled() ) {
			self::notice( 'warning', __( 'Background uploads are off on this site (WordPress cron is disabled). Click "Continue now" until the upload is complete.', 'ecommbd-migrator' ) );
		} elseif ( $active && ! empty( $state['last_activity'] ) && time() - (int) $state['last_activity'] > self::STALLED_SECONDS ) {
			self::notice( 'warning', __( 'Nothing was sent for more than 10 minutes. Click "Continue now". If it keeps stopping, ask your host whether WordPress cron runs on this site.', 'ecommbd-migrator' ) );
		}
	}

	/**
	 * Shows the destination host and asks the merchant to confirm it.
	 *
	 * @param string $host    Destination host.
	 * @param string $pairing Pasted pairing details for a new pairing; "" to confirm a saved one.
	 * @return void
	 */
	private static function render_confirmation( $host, $pairing ) {
		$operation = '' === $pairing ? 'confirm' : 'pair';
		?>
		<div class="notice notice-warning inline ecommbd-destination">
			<h2><?php esc_html_e( 'Check where your store data will go', 'ecommbd-migrator' ); ?></h2>
			<p><?php esc_html_e( 'The helper will send your products, orders, customers and customers\' password hashes to this store:', 'ecommbd-migrator' ); ?></p>
			<p class="ecommbd-host"><code dir="ltr"><?php echo esc_html( $host ); ?></code></p>
			<p><?php esc_html_e( 'Continue only if this is the address of your own Ecomm BD store, as shown in your Ecomm BD admin. If someone sent you these pairing details, stop and contact Ecomm BD support.', 'ecommbd-migrator' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
				<input type="hidden" name="operation" value="<?php echo esc_attr( $operation ); ?>">
				<input type="hidden" name="confirm_host" value="<?php echo esc_attr( $host ); ?>">
				<?php if ( '' !== $pairing ) : ?>
					<input type="hidden" name="pairing" value="<?php echo esc_attr( $pairing ); ?>">
				<?php endif; ?>
				<?php wp_nonce_field( self::ACTION ); ?>
				<p>
					<label>
						<input type="checkbox" name="confirm_destination" value="1" required>
						<?php
						echo wp_kses(
							sprintf(
								/* translators: %s: the destination store's address, for example shop.example.com */
								esc_html__( 'Yes, %s is my Ecomm BD store.', 'ecommbd-migrator' ),
								'<strong dir="ltr">' . esc_html( $host ) . '</strong>'
							),
							array( 'strong' => array( 'dir' => true ) )
						);
						?>
					</label>
				</p>
				<p>
					<button type="submit" class="button button-primary"><?php esc_html_e( 'Confirm and start the upload', 'ecommbd-migrator' ); ?></button>
					<?php if ( '' !== $pairing ) : ?>
						<a class="button" href="<?php echo esc_url( self::page_url() ); ?>"><?php esc_html_e( 'Cancel', 'ecommbd-migrator' ); ?></a>
					<?php endif; ?>
				</p>
			</form>
		</div>
		<?php
	}

	/**
	 * Shows progress.
	 *
	 * @param array $state State.
	 * @return void
	 */
	private static function render_status( array $state ) {
		$labels = self::stage_labels();
		$stages = EcommBD_Migrator::STAGES;
		$stage  = isset( $state['stage'] ) ? (int) $state['stage'] : 0;
		$kind   = isset( $stages[ $stage ] ) ? $stages[ $stage ] : 'finish';
		if ( ! empty( $state['done'] ) ) {
			$step = __( 'Upload complete', 'ecommbd-migrator' );
		} else {
			/* translators: 1: step number, 2: number of steps, 3: what is being sent, for example Products */
			$step = sprintf( __( 'Step %1$s of %2$s: %3$s', 'ecommbd-migrator' ), number_format_i18n( $stage + 1 ), number_format_i18n( count( $stages ) + 1 ), $labels[ $kind ] );
		}
		$host = ! empty( $state['host'] ) ? (string) $state['host'] : '';
		?>
		<h2><?php esc_html_e( 'Upload progress', 'ecommbd-migrator' ); ?></h2>
		<table class="widefat striped ecommbd-status" role="presentation">
			<tbody>
				<tr>
					<th scope="row"><?php esc_html_e( 'Destination store', 'ecommbd-migrator' ); ?></th>
					<td><?php echo '' === $host ? esc_html__( 'Not confirmed yet', 'ecommbd-migrator' ) : '<code dir="ltr">' . esc_html( $host ) . '</code>'; ?></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Progress', 'ecommbd-migrator' ); ?></th>
					<td><?php echo esc_html( $step ); ?></td>
				</tr>
				<?php foreach ( $stages as $name ) : ?>
					<tr>
						<th scope="row"><?php echo esc_html( $labels[ $name ] ); ?></th>
						<td><?php echo esc_html( number_format_i18n( isset( $state['counts'][ $name ] ) ? (int) $state['counts'][ $name ] : 0 ) ); ?></td>
					</tr>
				<?php endforeach; ?>
				<tr>
					<th scope="row"><?php esc_html_e( 'Parts sent', 'ecommbd-migrator' ); ?></th>
					<td><?php echo esc_html( number_format_i18n( isset( $state['sequence'] ) ? (int) $state['sequence'] : 0 ) ); ?></td>
				</tr>
				<?php if ( ! empty( $state['last_activity'] ) ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Last activity', 'ecommbd-migrator' ); ?></th>
						<td>
							<?php
							/* translators: %s: how long ago, for example "2 minutes" */
							echo esc_html( sprintf( __( '%s ago', 'ecommbd-migrator' ), human_time_diff( (int) $state['last_activity'] ) ) );
							?>
						</td>
					</tr>
				<?php endif; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Shows the pairing, continue and remove forms.
	 *
	 * @param array|null $state     State.
	 * @param bool       $reviewing Whether the confirmation box for new pairing details is shown.
	 * @return void
	 */
	private static function render_forms( $state, $reviewing ) {
		$running = null !== $state && empty( $state['done'] );
		if ( ! $reviewing ) {
			?>
			<h2><?php echo esc_html( $running ? __( 'Start again with new pairing details', 'ecommbd-migrator' ) : __( 'Connect to Ecomm BD', 'ecommbd-migrator' ) ); ?></h2>
			<form method="post" action="<?php echo esc_url( self::page_url() ); ?>">
				<input type="hidden" name="ecommbd_review" value="1">
				<?php wp_nonce_field( self::REVIEW_NONCE ); ?>
				<p>
					<label for="ecommbd-pairing"><?php esc_html_e( 'Pairing details from Ecomm BD', 'ecommbd-migrator' ); ?></label><br>
					<textarea id="ecommbd-pairing" name="pairing" rows="4" autocomplete="off" spellcheck="false" dir="ltr" required></textarea>
				</p>
				<p class="description"><?php esc_html_e( 'Create them on the migration page of your Ecomm BD admin. They work once, for one hour.', 'ecommbd-migrator' ); ?></p>
				<?php if ( $running ) : ?>
					<p class="description"><?php esc_html_e( 'New pairing details replace the current upload and start from the beginning.', 'ecommbd-migrator' ); ?></p>
				<?php endif; ?>
				<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Check pairing details', 'ecommbd-migrator' ); ?></button></p>
			</form>
			<?php
		}

		if ( null === $state ) {
			return;
		}
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<?php if ( $running && self::is_confirmed( $state ) ) : ?>
				<h2><?php esc_html_e( 'Continue', 'ecommbd-migrator' ); ?></h2>
				<p class="description"><?php esc_html_e( 'The upload continues by itself in the background. "Continue now" sends as much as fits in about 20 seconds; use it if the upload stopped or showed an error.', 'ecommbd-migrator' ); ?></p>
				<p><button type="submit" class="button button-primary" name="operation" value="resume"><?php esc_html_e( 'Continue now', 'ecommbd-migrator' ); ?></button></p>
			<?php endif; ?>
			<h2><?php esc_html_e( 'Remove saved connection', 'ecommbd-migrator' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Deletes the saved token and progress from this site. Your store data here is not touched.', 'ecommbd-migrator' ); ?></p>
			<p><button type="submit" class="button" name="operation" value="forget"><?php esc_html_e( 'Remove saved connection', 'ecommbd-migrator' ); ?></button></p>
		</form>
		<?php
	}

	/**
	 * Shows the "Export to a file" section: create, continue, download or delete the file.
	 *
	 * @return void
	 */
	private static function render_export() {
		$file    = EcommBD_Migrator_File::get_state();
		$ready   = null !== $file && ! empty( $file['done'] ) ? EcommBD_Migrator_File::finished_path() : null;
		$running = null !== $file && empty( $file['done'] );
		$labels  = self::stage_labels();
		?>
		<h2><?php esc_html_e( 'Export to a file', 'ecommbd-migrator' ); ?></h2>
		<p class="description"><?php esc_html_e( 'If this site cannot connect to Ecomm BD, export the store to a file instead. Download the file, then import it on the migration page of your Ecomm BD admin. The file contains your customers\' details and password hashes: keep it private and delete it when the move is finished.', 'ecommbd-migrator' ); ?></p>
		<?php if ( null !== $file ) : ?>
			<table class="widefat striped ecommbd-status" role="presentation">
				<tbody>
					<tr>
						<th scope="row"><?php esc_html_e( 'Progress', 'ecommbd-migrator' ); ?></th>
						<td>
							<?php
							if ( ! $running ) {
								esc_html_e( 'Export complete', 'ecommbd-migrator' );
							} else {
								$stages = EcommBD_Migrator::STAGES;
								$stage  = isset( $file['stage'] ) ? (int) $file['stage'] : 0;
								$kind   = isset( $stages[ $stage ] ) ? $stages[ $stage ] : 'finish';
								/* translators: 1: step number, 2: number of steps, 3: what is being sent, for example Products */
								echo esc_html( sprintf( __( 'Step %1$s of %2$s: %3$s', 'ecommbd-migrator' ), number_format_i18n( $stage + 1 ), number_format_i18n( count( $stages ) + 1 ), $labels[ $kind ] ) );
							}
							?>
						</td>
					</tr>
					<?php foreach ( EcommBD_Migrator::STAGES as $name ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( $labels[ $name ] ); ?></th>
							<td><?php echo esc_html( number_format_i18n( isset( $file['counts'][ $name ] ) ? (int) $file['counts'][ $name ] : 0 ) ); ?></td>
						</tr>
					<?php endforeach; ?>
					<?php if ( null !== $ready ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'File size', 'ecommbd-migrator' ); ?></th>
							<td><?php echo esc_html( size_format( (int) filesize( $ready ), 1 ) ); ?></td>
						</tr>
					<?php endif; ?>
				</tbody>
			</table>
		<?php endif; ?>
		<?php if ( null !== $ready ) : ?>
			<p>
				<a class="button button-primary" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=' . self::DOWNLOAD_ACTION ), self::DOWNLOAD_ACTION ) ); ?>"><?php esc_html_e( 'Download export file', 'ecommbd-migrator' ); ?></a>
			</p>
		<?php endif; ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<p>
				<?php if ( $running ) : ?>
					<button type="submit" class="button button-primary" name="operation" value="export_resume"><?php esc_html_e( 'Continue export', 'ecommbd-migrator' ); ?></button>
				<?php endif; ?>
				<button type="submit" class="button<?php echo null === $file ? ' button-primary' : ''; ?>" name="operation" value="export_start"><?php echo esc_html( null === $file ? __( 'Create export file', 'ecommbd-migrator' ) : __( 'Create a new export file', 'ecommbd-migrator' ) ); ?></button>
				<?php if ( null !== $file ) : ?>
					<button type="submit" class="button" name="operation" value="export_delete"><?php esc_html_e( 'Delete export file', 'ecommbd-migrator' ); ?></button>
				<?php endif; ?>
			</p>
		</form>
		<?php
	}

	/**
	 * Prints an admin notice.
	 *
	 * @param string $type    error, warning, success or info.
	 * @param string $message Message.
	 * @param string $code    Optional code for support.
	 * @return void
	 */
	private static function notice( $type, $message, $code = '' ) {
		echo '<div class="notice notice-' . esc_attr( $type ) . ' inline"><p>' . esc_html( $message );
		if ( '' !== $code ) {
			/* translators: %s: error code for Ecomm BD support, for example NETWORK_OR_TLS */
			echo ' <small>' . esc_html( sprintf( __( 'Code: %s', 'ecommbd-migrator' ), $code ) ) . '</small>';
		}
		echo '</p></div>';
	}

	/**
	 * Explains an error code in plain words.
	 *
	 * @param string $code Error code.
	 * @return string
	 */
	private static function error_message( $code ) {
		$messages = array(
			'INVALID_PAIRING'           => __( 'These pairing details are not valid. Copy them again from your Ecomm BD admin.', 'ecommbd-migrator' ),
			'HTTPS_REQUIRED'            => __( 'The pairing details must point to a secure (https) address.', 'ecommbd-migrator' ),
			'CONFIRM_DESTINATION'       => __( 'Tick the box to confirm the destination store first.', 'ecommbd-migrator' ),
			'DESTINATION_CHANGED'       => __( 'The destination is not the one you confirmed. Paste the pairing details again and check the address.', 'ecommbd-migrator' ),
			'DESTINATION_NOT_CONFIRMED' => __( 'Confirm the destination store before the upload can continue.', 'ecommbd-migrator' ),
			'NOT_PAIRED'                => __( 'There is no saved connection. Paste new pairing details.', 'ecommbd-migrator' ),
			'BUSY'                      => __( 'An upload is running right now. Wait a minute, then try again.', 'ecommbd-migrator' ),
			'NETWORK_OR_TLS'            => __( 'Could not reach Ecomm BD over a secure connection. A security plugin (such as Wordfence) or the host may block outgoing requests; ask them to allow your Ecomm BD address. The helper tries again by itself a few times.', 'ecommbd-migrator' ),
			'UPLOAD_REFUSED'            => __( 'Ecomm BD refused the data. The pairing may have expired or been revoked. Create new pairing details and start again.', 'ecommbd-migrator' ),
			'INVALID_RESPONSE'          => __( 'Ecomm BD sent an unexpected answer. Try again in a few minutes.', 'ecommbd-migrator' ),
			'CHECKPOINT_MISMATCH'       => __( 'Ecomm BD expected a different part of the upload. Remove the saved connection and pair again.', 'ecommbd-migrator' ),
			'RECORD_TOO_LARGE'          => __( 'One record is too large to send (over 1.9 MB). Contact Ecomm BD support.', 'ecommbd-migrator' ),
			'PERMISSION_CHANGED'        => __( 'The person who started the upload can no longer manage WooCommerce. Pair again as a shop manager or administrator.', 'ecommbd-migrator' ),
			'INVALID_SECRET'            => __( 'The saved connection cannot be read, probably because the site\'s security keys changed. Remove it and pair again.', 'ecommbd-migrator' ),
			'ENCRYPTION_FAILED'         => __( 'This server cannot encrypt the saved connection (PHP OpenSSL is missing). Ask your host to enable it.', 'ecommbd-migrator' ),
			'WOOCOMMERCE_REQUIRED'      => __( 'WooCommerce 4.0 or later must be active.', 'ecommbd-migrator' ),
			'FILE_WRITE_FAILED'         => __( 'The export file could not be written. Check that the uploads folder has free space and can be written to, then click "Continue export".', 'ecommbd-migrator' ),
			'NO_EXPORT'                 => __( 'There is no finished export file. Create one first.', 'ecommbd-migrator' ),
		);

		return isset( $messages[ $code ] ) ? $messages[ $code ] : __( 'The upload stopped. Click "Continue now" to try again.', 'ecommbd-migrator' );
	}

	/**
	 * Names of the export stages.
	 *
	 * @return array
	 */
	private static function stage_labels() {
		return array(
			'categories' => __( 'Categories', 'ecommbd-migrator' ),
			'tags'       => __( 'Tags', 'ecommbd-migrator' ),
			'products'   => __( 'Products', 'ecommbd-migrator' ),
			'customers'  => __( 'Customers', 'ecommbd-migrator' ),
			'orders'     => __( 'Orders', 'ecommbd-migrator' ),
			'coupons'    => __( 'Coupons', 'ecommbd-migrator' ),
			'reviews'    => __( 'Reviews', 'ecommbd-migrator' ),
			'settings'   => __( 'Store settings', 'ecommbd-migrator' ),
			'finish'     => __( 'Finishing', 'ecommbd-migrator' ),
		);
	}

	/**
	 * Whether the merchant confirmed the destination of this state.
	 *
	 * @param array $state State.
	 * @return bool
	 */
	private static function is_confirmed( array $state ) {
		return ! empty( $state['confirmed_at'] ) && ! empty( $state['host'] );
	}

	/**
	 * Whether WP-Cron is switched off in wp-config.php.
	 *
	 * @return bool
	 */
	private static function cron_disabled() {
		return defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON;
	}
}
