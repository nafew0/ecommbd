<?php
/**
 * Encryption of the upload token and the pending chunk.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Seals values with AES-256-GCM before they are saved in the options table.
 *
 * Why: the saved state holds the upload token and, between "built" and "acknowledged", a whole
 * chunk that can contain customers' names, phones, addresses and password hashes. The options
 * table is copied by backups, staging tools and database dumps, and is readable by every plugin.
 * Encrypting with a key derived from the site's AUTH_KEY and AUTH_SALT (normally kept in
 * wp-config.php, not in the database) keeps a leaked database dump from exposing them.
 *
 * Changing the site's salts makes saved values unreadable: the page then asks to pair again.
 * The format (base64 of 12-byte IV, 16-byte tag, ciphertext) is unchanged since 0.1.0, so an
 * upload paused by the old version can still be continued.
 */
final class EcommBD_Migrator_Crypto {

	/**
	 * Cipher used for every sealed value.
	 */
	const CIPHER = 'aes-256-gcm';

	/**
	 * Encrypts a string.
	 *
	 * @param string $value Plain text.
	 * @return string Base64 text safe to store in an option.
	 * @throws RuntimeException When OpenSSL fails.
	 */
	public static function seal( $value ) {
		$iv     = random_bytes( 12 );
		$tag    = '';
		$cipher = openssl_encrypt( (string) $value, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag );
		if ( false === $cipher ) {
			throw new RuntimeException( 'ENCRYPTION_FAILED' );
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Stores binary ciphertext as text; this is not obfuscated code.
		return base64_encode( $iv . $tag . $cipher );
	}

	/**
	 * Decrypts a value made by seal().
	 *
	 * @param string $value Sealed value.
	 * @return string Plain text.
	 * @throws RuntimeException When the value was changed or the site's salts changed.
	 */
	public static function open( $value ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Reads binary ciphertext stored as text.
		$bytes = base64_decode( (string) $value, true );
		if ( false === $bytes || strlen( $bytes ) < 28 ) {
			throw new RuntimeException( 'INVALID_SECRET' );
		}
		$plain = openssl_decrypt( substr( $bytes, 28 ), self::CIPHER, self::key(), OPENSSL_RAW_DATA, substr( $bytes, 0, 12 ), substr( $bytes, 12, 16 ) );
		if ( false === $plain ) {
			throw new RuntimeException( 'INVALID_SECRET' );
		}

		return $plain;
	}

	/**
	 * The 256-bit key: SHA-256 of WordPress's auth salt.
	 *
	 * @return string Raw key bytes.
	 */
	private static function key() {
		return hash( 'sha256', wp_salt( 'auth' ), true );
	}
}
