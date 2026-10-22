import { I18nError, LogLevel } from '@vendure/core';

/** Too many tracking lookups; `extensions.code` is `RATE_LIMITED`. */
export class TrackingRateLimitedError extends I18nError {
    constructor(readonly retryAfterSeconds: number) {
        super(
            'error.bd-tracking.rate-limited',
            { seconds: retryAfterSeconds },
            'RATE_LIMITED',
            LogLevel.Verbose,
        );
    }
}
