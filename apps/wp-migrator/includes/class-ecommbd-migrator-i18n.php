<?php
/**
 * English and Bangla text.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Loads translations, with built-in Bangla that works on every supported WordPress.
 *
 * All text uses the standard functions (__(), esc_html__()…) with the text domain
 * "ecommbd-migrator", so normal tools (wp i18n make-pot, Loco Translate) work.
 *
 * Bangla ships as languages/ecommbd-migrator-bn_BD.l10n.php, WordPress's PHP translation format:
 * - WordPress 6.5 and later load it by themselves for the bn_BD locale.
 * - WordPress 5.8 to 6.4 cannot read that format, so a gettext filter looks up the same file
 *   when the admin language starts with "bn" and nothing else translated the text.
 * A real .mo file (for example from Loco Translate) always wins: the filter only fills gaps.
 * No compiled .mo is shipped, so there is no binary file to build or keep in sync.
 */
final class EcommBD_Migrator_I18n {

	/**
	 * Locale the plugin's text was last loaded for.
	 *
	 * @var string
	 */
	private static $locale = '';

	/**
	 * Built-in Bangla strings, loaded on first use.
	 *
	 * @var array|null
	 */
	private static $bangla = null;

	/**
	 * Registers the hooks.
	 *
	 * @return void
	 */
	public static function boot() {
		add_action( 'init', array( __CLASS__, 'load' ) );
		add_action( 'change_locale', array( __CLASS__, 'change_locale' ) );
		add_filter( 'gettext_ecommbd-migrator', array( __CLASS__, 'fallback' ), 10, 2 );
	}

	/**
	 * Loads the text domain for the current admin language.
	 *
	 * @return void
	 */
	public static function load() {
		self::$locale = determine_locale();
		load_plugin_textdomain( 'ecommbd-migrator', false, dirname( plugin_basename( ECOMMBD_MIGRATOR_FILE ) ) . '/languages' );
	}

	/**
	 * Reloads after switch_to_locale(). WordPress 5.8 does not reload plugin folders by itself.
	 *
	 * @param string $locale New locale.
	 * @return void
	 */
	public static function change_locale( $locale ) {
		self::$locale = (string) $locale;
		unload_textdomain( 'ecommbd-migrator' );
		load_plugin_textdomain( 'ecommbd-migrator', false, dirname( plugin_basename( ECOMMBD_MIGRATOR_FILE ) ) . '/languages' );
	}

	/**
	 * Fills in Bangla when WordPress found no translation.
	 *
	 * @param string $translation Text after WordPress's own lookup.
	 * @param string $text        Original English text.
	 * @return string
	 */
	public static function fallback( $translation, $text ) {
		if ( $translation !== $text ) {
			return $translation;
		}
		$locale = '' !== self::$locale ? self::$locale : determine_locale();
		if ( 0 !== strpos( $locale, 'bn' ) ) {
			return $translation;
		}
		$strings = self::bangla();

		return isset( $strings[ $text ] ) ? $strings[ $text ] : $translation;
	}

	/**
	 * The built-in Bangla strings (English => Bangla).
	 *
	 * @return array
	 */
	public static function bangla() {
		if ( null === self::$bangla ) {
			$file         = dirname( ECOMMBD_MIGRATOR_FILE ) . '/languages/ecommbd-migrator-bn_BD.l10n.php';
			$data         = is_readable( $file ) ? include $file : array();
			self::$bangla = isset( $data['messages'] ) && is_array( $data['messages'] ) ? $data['messages'] : array();
		}

		return self::$bangla;
	}
}
