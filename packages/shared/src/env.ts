import { z } from 'zod';

/**
 * Environment variable validation. Apps describe their variables with a zod schema and call
 * `loadEnvOrExit` at startup: a missing or invalid variable stops the process with a clear list.
 */

export class EnvValidationError extends Error {
    constructor(public readonly problems: string[]) {
        super(`Invalid environment configuration:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
        this.name = 'EnvValidationError';
    }
}

type EnvSource = Record<string, string | undefined>;

/** Treats empty values (`KEY=`) as missing, so defaults and "required" checks behave as expected. */
function withoutEmptyValues(source: EnvSource): EnvSource {
    const result: EnvSource = {};
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined && value.trim() !== '') {
            result[key] = value;
        }
    }
    return result;
}

/** Validates `source` against `schema`. Throws `EnvValidationError` listing every problem. */
export function parseEnv<T extends z.ZodType>(schema: T, source: EnvSource = process.env): z.infer<T> {
    const result = schema.safeParse(withoutEmptyValues(source));
    if (result.success) {
        return result.data;
    }
    const problems = result.error.issues.map(issue => {
        const name = issue.path.length > 0 ? issue.path.join('.') : 'environment';
        const message =
            issue.code === 'invalid_type' && issue.input === undefined ? 'is required' : issue.message;
        return `${name}: ${message}`;
    });
    throw new EnvValidationError(problems);
}

export interface LoadEnvOptions {
    /** Shown in the error, e.g. "apps/core/.env". */
    label?: string;
    source?: EnvSource;
    /** For tests. Defaults to `process.exit`. */
    exit?: (code: number) => never;
    /** For tests. Defaults to writing to stderr. */
    report?: (message: string) => void;
}

/** Like `parseEnv`, but prints the problems and exits with code 1 instead of throwing. */
export function loadEnvOrExit<T extends z.ZodType>(schema: T, options: LoadEnvOptions = {}): z.infer<T> {
    const {
        label,
        source = process.env,
        exit = (code: number): never => process.exit(code),
        report = (message: string): void => {
            process.stderr.write(message + '\n');
        },
    } = options;
    try {
        return parseEnv(schema, source);
    } catch (error) {
        if (error instanceof EnvValidationError) {
            report(label ? `${error.message}\n(check ${label})` : error.message);
            return exit(1);
        }
        throw error;
    }
}

/** A TCP port number from a string variable. */
export const envPort = z.coerce.number().int().min(1).max(65535);

/** `true`/`false`/`1`/`0` (case-insensitive) as a boolean. */
export const envBoolean = z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false', '1', '0']))
    .transform(value => value === 'true' || value === '1');

/** A comma-separated list, trimmed, with empty entries removed. */
export const envList = z.string().transform(value =>
    value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
);
