<?php
/**
 * The atomic "one upload at a time" lock.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Makes sure only one request uploads at a time.
 *
 * Why it matters: each chunk carries a sequence number and the destination accepts exactly the
 * next one. If two requests (two cron runs, or cron and a "Continue" click) both read the same
 * checkpoint, both send it, and the slower one then saves an old checkpoint over the newer one.
 * The helper is then stuck on CHECKPOINT_MISMATCH until the merchant pairs again.
 *
 * Why not something simpler:
 * - A transient (0.1.0 used one) is "read, then write": two requests can both read "no lock"
 *   before either writes. With a persistent object cache it may not even reach the database.
 * - add_option() looks atomic but runs INSERT ... ON DUPLICATE KEY UPDATE, so a second caller
 *   silently overwrites the first one's row instead of failing.
 * - MySQL GET_LOCK() is server-wide (shared hosts share one MySQL server) and breaks behind some
 *   database proxies that do not keep one connection per request.
 *
 * What it does: one row in this site's options table, written with plain SQL.
 * - INSERT IGNORE is atomic because option_name has a UNIQUE index: only one request inserts.
 * - The row holds "token:expiry". A run that dies (host timeout, out of memory) cannot release
 *   it, so another request may take over an expired row, but only with a compare-and-swap
 *   UPDATE on the exact old value. If two requests try at once, only one UPDATE matches.
 * - The holder refreshes the expiry before each chunk and before each save. If it finds the
 *   row gone or taken over, it stops without saving (see EcommBD_Migrator_Uploader).
 *
 * The row is never read through get_option(), so the option cache cannot hide it.
 */
final class EcommBD_Migrator_Lock {

	/**
	 * Tries to take the lock.
	 *
	 * @param int $seconds How long the lock lasts if it is not refreshed.
	 * @return string|false The lock token, or false when another request holds the lock.
	 */
	public static function acquire( $seconds ) {
		global $wpdb;

		$token = bin2hex( random_bytes( 16 ) );
		$value = self::value( $token, $seconds );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- An atomic insert is the whole point; the option cache would defeat it.
		$inserted = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", EcommBD_Migrator::LOCK_OPTION, $value ) );
		if ( 1 === (int) $inserted ) {
			return $token;
		}

		$current = self::current();
		if ( null === $current || self::expiry( $current ) > time() ) {
			return false;
		}

		// The holder died without releasing. Take over only if nobody else took over first.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Compare-and-swap on the lock row.
		$updated = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", $value, EcommBD_Migrator::LOCK_OPTION, $current ) );

		return 1 === (int) $updated ? $token : false;
	}

	/**
	 * Extends the lock if this request still holds it.
	 *
	 * @param string $token   Token returned by acquire().
	 * @param int    $seconds New lifetime from now.
	 * @return bool False when the lock was removed or taken over.
	 */
	public static function refresh( $token, $seconds ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Only the holder's own row is updated.
		$updated = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value LIKE %s", self::value( $token, $seconds ), EcommBD_Migrator::LOCK_OPTION, $wpdb->esc_like( $token . ':' ) . '%' ) );
		if ( 1 === (int) $updated ) {
			return true;
		}

		// MySQL reports 0 changed rows when the new value equals the old one (same second).
		$current = self::current();

		return null !== $current && 0 === strpos( $current, $token . ':' );
	}

	/**
	 * Releases the lock if this request still holds it.
	 *
	 * @param string $token Token returned by acquire().
	 * @return void
	 */
	public static function release( $token ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Deletes only the holder's own row.
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value LIKE %s", EcommBD_Migrator::LOCK_OPTION, $wpdb->esc_like( $token . ':' ) . '%' ) );
	}

	/**
	 * Reads the lock row straight from the database.
	 *
	 * @return string|null The row's value, or null when there is no lock.
	 */
	private static function current() {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Must bypass the option cache.
		$value = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", EcommBD_Migrator::LOCK_OPTION ) );

		return null === $value ? null : (string) $value;
	}

	/**
	 * Builds the stored value.
	 *
	 * @param string $token   Lock token.
	 * @param int    $seconds Lifetime from now.
	 * @return string "token:expiry".
	 */
	private static function value( $token, $seconds ) {
		return $token . ':' . ( time() + max( 1, (int) $seconds ) );
	}

	/**
	 * Reads the expiry from a stored value.
	 *
	 * @param string $value Stored value.
	 * @return int Unix time; 0 when the value is not ours (treated as expired).
	 */
	private static function expiry( $value ) {
		$parts = explode( ':', $value );

		return isset( $parts[1] ) ? (int) $parts[1] : 0;
	}
}
