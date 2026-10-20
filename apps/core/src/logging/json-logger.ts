import { redactText } from '@ecommbd/shared';
import { LogLevel, type VendureLogger } from '@vendure/core';
import { getRequestId } from './request-context';

/**
 * JSON logs for staging and production: one line per entry, with the store ID, release and
 * request ID, and phone numbers and emails masked. Errors go to stderr, everything else to stdout.
 */

export type LogLevelName = 'error' | 'warn' | 'info' | 'verbose' | 'debug';

const LEVELS: Record<LogLevelName, LogLevel> = {
    error: LogLevel.Error,
    warn: LogLevel.Warn,
    info: LogLevel.Info,
    verbose: LogLevel.Verbose,
    debug: LogLevel.Debug,
};

export function toVendureLogLevel(name: LogLevelName): LogLevel {
    return LEVELS[name];
}

export interface JsonLoggerOptions {
    level: LogLevel;
    storeId?: string;
    release?: string;
    /** For tests. Defaults to stdout, or stderr for errors. */
    write?: (line: string, isError: boolean) => void;
    now?: () => Date;
}

export class JsonLogger implements VendureLogger {
    private defaultContext = 'Vendure';

    constructor(private readonly options: JsonLoggerOptions) {}

    setDefaultContext(defaultContext: string): void {
        this.defaultContext = defaultContext;
    }

    error(message: string, context?: string, trace?: string): void {
        this.log(LogLevel.Error, 'error', message, context, trace);
    }

    warn(message: string, context?: string): void {
        this.log(LogLevel.Warn, 'warn', message, context);
    }

    info(message: string, context?: string): void {
        this.log(LogLevel.Info, 'info', message, context);
    }

    verbose(message: string, context?: string): void {
        this.log(LogLevel.Verbose, 'verbose', message, context);
    }

    debug(message: string, context?: string): void {
        this.log(LogLevel.Debug, 'debug', message, context);
    }

    private log(
        level: LogLevel,
        name: LogLevelName,
        message: unknown,
        context?: string,
        trace?: string,
    ): void {
        if (level > this.options.level) {
            return;
        }
        const entry: Record<string, string> = {
            time: (this.options.now?.() ?? new Date()).toISOString(),
            level: name,
            context: context ?? this.defaultContext,
            msg: redactText(String(message)),
        };
        const requestId = getRequestId();
        if (requestId) {
            entry.requestId = requestId;
        }
        if (this.options.storeId) {
            entry.storeId = this.options.storeId;
        }
        if (this.options.release) {
            entry.release = this.options.release;
        }
        if (trace) {
            entry.trace = redactText(trace);
        }
        const line = JSON.stringify(entry);
        const isError = level === LogLevel.Error;
        if (this.options.write) {
            this.options.write(line, isError);
        } else {
            (isError ? process.stderr : process.stdout).write(line + '\n');
        }
    }
}
