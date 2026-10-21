import { I18nError, LogLevel } from '@vendure/core';

/** Too many searches from one address; `extensions.code` is `RATE_LIMITED`. */
export class SearchRateLimitedError extends I18nError {
    constructor(readonly retryAfterSeconds: number) {
        super(
            'error.bd-search.rate-limited',
            { seconds: retryAfterSeconds },
            'RATE_LIMITED',
            LogLevel.Verbose,
        );
    }
}
