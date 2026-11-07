<?php
/**
 * Time and memory budget for one upload run.
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Decides how long one run may keep sending chunks.
 *
 * Why: cheap Bangladeshi hosting often allows 30 seconds and 128 MB per request. Version 0.1.0
 * sent one small chunk per cron run, so 20,000 orders took hours. Now one run keeps sending
 * chunks while it is safely inside both limits, then schedules the next run straight away.
 *
 * - Time: half of max_execution_time, at most 20 seconds. When there is no limit (0, as in
 *   WP-CLI), still 20 seconds, so a cron request stays short and the page stays responsive.
 *   Time is counted from the start of the request, because WordPress itself already used some.
 * - Memory: stop at 60% of memory_limit (for example 77 MB of 128M), leaving room to finish
 *   the current chunk and save. "-1" means no limit, so only time applies.
 *
 * A run always sends at least one chunk, even over budget, so a busy site still makes progress.
 * If the host kills the request anyway, the saved pending chunk is resent on the next run.
 */
final class EcommBD_Migrator_Budget {

	/**
	 * Longest run, in seconds, whatever max_execution_time says.
	 */
	const MAX_SECONDS = 20;

	/**
	 * Share of max_execution_time a run may use.
	 */
	const TIME_SHARE = 0.5;

	/**
	 * Share of memory_limit a run may use before it stops.
	 */
	const MEMORY_SHARE = 0.6;

	/**
	 * Run length in seconds.
	 *
	 * @var float
	 */
	private $seconds;

	/**
	 * Memory ceiling in bytes; 0 means no limit.
	 *
	 * @var int
	 */
	private $memory_bytes;

	/**
	 * Unix time (with microseconds) the budget counts from.
	 *
	 * @var float
	 */
	private $started;

	/**
	 * Creates a budget.
	 *
	 * @param int|string $max_execution_time Seconds, as in php.ini (0 means no limit).
	 * @param int|string $memory_limit       Bytes or shorthand such as "256M" or "-1".
	 * @param float|null $started            When the request started; defaults to now.
	 */
	public function __construct( $max_execution_time, $memory_limit, $started = null ) {
		$this->seconds      = self::seconds_for( $max_execution_time );
		$this->memory_bytes = self::memory_for( $memory_limit );
		$this->started      = null === $started ? microtime( true ) : (float) $started;
	}

	/**
	 * Budget for the current request, from php.ini.
	 *
	 * @return self
	 */
	public static function from_environment() {
		$started = isset( $_SERVER['REQUEST_TIME_FLOAT'] ) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : microtime( true );

		return new self( ini_get( 'max_execution_time' ), ini_get( 'memory_limit' ), $started );
	}

	/**
	 * Run length for a max_execution_time value.
	 *
	 * @param int|string $max_execution_time Seconds; 0 or less means no limit.
	 * @return float Seconds.
	 */
	public static function seconds_for( $max_execution_time ) {
		$limit = (int) $max_execution_time;
		if ( $limit <= 0 ) {
			return (float) self::MAX_SECONDS;
		}

		return (float) min( self::MAX_SECONDS, max( 1, $limit * self::TIME_SHARE ) );
	}

	/**
	 * Memory ceiling for a memory_limit value.
	 *
	 * @param int|string $memory_limit Bytes or shorthand ("128M", "1G", "-1").
	 * @return int Bytes; 0 means no limit.
	 */
	public static function memory_for( $memory_limit ) {
		$bytes = wp_convert_hr_to_bytes( (string) $memory_limit );

		return $bytes > 0 ? (int) floor( $bytes * self::MEMORY_SHARE ) : 0;
	}

	/**
	 * Run length in seconds.
	 *
	 * @return float
	 */
	public function seconds() {
		return $this->seconds;
	}

	/**
	 * Memory ceiling in bytes; 0 means no limit.
	 *
	 * @return int
	 */
	public function memory_bytes() {
		return $this->memory_bytes;
	}

	/**
	 * Seconds used so far.
	 *
	 * @return float
	 */
	public function elapsed() {
		return microtime( true ) - $this->started;
	}

	/**
	 * Whether another chunk like the last one fits in the time left.
	 *
	 * The 1.5 factor leaves room for a chunk that is a bit slower than the last one.
	 *
	 * @param float $last_chunk_seconds How long the last chunk took (build and upload).
	 * @return bool
	 */
	public function has_time_for( $last_chunk_seconds ) {
		return $this->elapsed() + 1.5 * max( 0.05, (float) $last_chunk_seconds ) < $this->seconds;
	}

	/**
	 * Whether memory use is still under the ceiling.
	 *
	 * Compares memory_get_usage( true ), the memory PHP really reserved, because that is what
	 * memory_limit is checked against.
	 *
	 * @return bool
	 */
	public function has_memory() {
		return 0 === $this->memory_bytes || memory_get_usage( true ) < $this->memory_bytes;
	}
}
