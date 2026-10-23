<?php
/**
 * Static check of the helper's text. Runs with plain PHP, no WordPress needed:
 *
 *     php apps/wp-migrator/tests/strings.php
 *
 * Fails when a translatable string has no Bangla translation, when a Bangla translation has
 * different placeholders (%s, %1$s…) from its English text, when a call uses another text
 * domain, or when a PHP 8-only function is used (WordPress 5.8 has no polyfills for them).
 *
 * @package EcommBD_Migrator
 */

// The plugin files exit unless ABSPATH is defined; nothing below runs WordPress code.
define( 'ABSPATH', __DIR__ . '/' );

$plugin   = dirname( __DIR__ );
$files    = array_merge( array( $plugin . '/ecommbd-migrator.php', $plugin . '/uninstall.php' ), glob( $plugin . '/includes/*.php' ) );
$i18n     = array( '__', 'esc_html__', 'esc_attr__', 'esc_html_e', 'esc_attr_e', '_e' );
$php8     = array( 'str_contains', 'str_starts_with', 'str_ends_with', 'array_is_list', 'get_debug_type', 'fdiv', 'get_resource_id' );
$failures = array();
$strings  = array();

foreach ( $files as $file ) {
	$tokens = token_get_all( file_get_contents( $file ) );
	$count  = count( $tokens );
	for ( $i = 0; $i < $count; $i++ ) {
		if ( ! is_array( $tokens[ $i ] ) || T_STRING !== $tokens[ $i ][0] ) {
			continue;
		}
		$name     = $tokens[ $i ][1];
		$previous = $i > 0 ? $tokens[ $i - 1 ] : null;
		$is_call  = ! ( is_array( $previous ) && in_array( $previous[0], array( T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION ), true ) );
		if ( $is_call && in_array( $name, $php8, true ) ) {
			$failures[] = basename( $file ) . ':' . $tokens[ $i ][2] . ' uses PHP 8-only ' . $name . '()';
		}
		if ( ! $is_call || ! in_array( $name, $i18n, true ) ) {
			continue;
		}
		// Collect the call's string arguments: text first, text domain second.
		$args  = array();
		$depth = 0;
		for ( $j = $i + 1; $j < $count; $j++ ) {
			$token = $tokens[ $j ];
			if ( '(' === $token ) {
				++$depth;
			} elseif ( ')' === $token ) {
				--$depth;
				if ( 0 === $depth ) {
					break;
				}
			} elseif ( is_array( $token ) && T_CONSTANT_ENCAPSED_STRING === $token[0] && 1 === $depth ) {
				$args[] = eval( 'return ' . $token[1] . ';' ); // phpcs:ignore Squiz.PHP.Eval -- Decodes a PHP string literal from our own source.
			}
		}
		if ( count( $args ) < 2 || 'ecommbd-migrator' !== $args[1] ) {
			$failures[] = basename( $file ) . ':' . $tokens[ $i ][2] . ' ' . $name . '() needs a literal text and the ecommbd-migrator text domain';
			continue;
		}
		$strings[ $args[0] ] = basename( $file ) . ':' . $tokens[ $i ][2];
	}
}

$translation = include $plugin . '/languages/ecommbd-migrator-bn_BD.l10n.php';
$bangla      = isset( $translation['messages'] ) ? $translation['messages'] : array();
foreach ( $strings as $text => $where ) {
	if ( ! isset( $bangla[ $text ] ) || '' === trim( $bangla[ $text ] ) ) {
		$failures[] = $where . ' has no Bangla translation: ' . $text;
		continue;
	}
	preg_match_all( '/%(?:\d+\$)?[sd]/', $text, $english_placeholders );
	preg_match_all( '/%(?:\d+\$)?[sd]/', $bangla[ $text ], $bangla_placeholders );
	$english_placeholders = $english_placeholders[0];
	$bangla_placeholders  = $bangla_placeholders[0];
	sort( $english_placeholders );
	sort( $bangla_placeholders );
	if ( $english_placeholders !== $bangla_placeholders ) {
		$failures[] = $where . ' Bangla placeholders differ: ' . $text;
	}
}
foreach ( array_diff_key( $bangla, $strings ) as $text => $unused ) {
	$failures[] = 'Unused Bangla translation: ' . $text;
}

if ( $failures ) {
	fwrite( STDERR, implode( PHP_EOL, $failures ) . PHP_EOL ); // phpcs:ignore WordPress.WP.AlternativeFunctions -- CLI script.
	exit( 1 );
}
echo 'HELPER_STRINGS_OK ' . count( $strings ) . ' strings' . PHP_EOL;
