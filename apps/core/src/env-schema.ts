import { envList, envPort, parseEnv } from '@ecommbd/shared';
import { z } from 'zod';

/**
 * Every environment variable the core reads, validated at startup (see ./env.ts).
 * This file has no side effects, so tests can import it.
 */

const live = (appEnv: string) => appEnv === 'staging' || appEnv === 'production';

export const envSchema = z
    .object({
        APP_ENV: z.enum(['dev', 'test', 'staging', 'production']),
        // Hosting platforms inject PORT; it wins over VENDURE_SERVER_PORT.
        PORT: envPort.optional(),
        VENDURE_SERVER_PORT: envPort.default(3000),
        COOKIE_SECRET: z
            .string()
            .min(32, 'must be at least 32 characters (generate one with: openssl rand -hex 32)'),
        SUPERADMIN_USERNAME: z.string(),
        SUPERADMIN_PASSWORD: z.string(),
        CORS_ORIGINS: envList
            .pipe(z.array(z.url('must be a list of URLs, e.g. https://shop.example.com')))
            .optional(),
        ASSET_URL_PREFIX: z.url().optional(),
        DB_HOST: z.string(),
        DB_PORT: envPort,
        DB_NAME: z.string(),
        DB_USERNAME: z.string(),
        DB_PASSWORD: z.string(),
        REDIS_KEY_PREFIX: z
            .string()
            .regex(/^[a-z0-9][a-z0-9:_-]{1,62}$/, 'use 2–63 lowercase letters, digits, ":", "_" or "-"')
            .optional(),
        REDIS_QUEUE_HOST: z.string(),
        REDIS_QUEUE_PORT: envPort,
        REDIS_QUEUE_USERNAME: z.string().optional(),
        REDIS_QUEUE_PASSWORD: z.string().optional(),
        REDIS_CACHE_HOST: z.string(),
        REDIS_CACHE_PORT: envPort,
        REDIS_CACHE_USERNAME: z.string().optional(),
        REDIS_CACHE_PASSWORD: z.string().optional(),
        LOG_LEVEL: z.enum(['error', 'warn', 'info', 'verbose', 'debug']).default('info'),
        LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
        STORE_ID: z.string().optional(),
        RELEASE_VERSION: z.string().optional(),
    })
    .superRefine((value, context) => {
        if (!live(value.APP_ENV)) {
            return;
        }
        if (value.SUPERADMIN_PASSWORD === 'superadmin' || value.SUPERADMIN_PASSWORD.length < 16) {
            context.addIssue({
                code: 'custom',
                path: ['SUPERADMIN_PASSWORD'],
                message: 'must be at least 16 characters, and not the default, in staging and production',
            });
        }
        if (!value.REDIS_KEY_PREFIX) {
            context.addIssue({
                code: 'custom',
                path: ['REDIS_KEY_PREFIX'],
                message: 'is required in staging and production (every store needs its own prefix)',
            });
        }
        if (!value.ASSET_URL_PREFIX) {
            context.addIssue({
                code: 'custom',
                path: ['ASSET_URL_PREFIX'],
                message: 'is required in staging and production (the public URL of /assets/)',
            });
        }
    })
    .transform(value => ({
        ...value,
        REDIS_KEY_PREFIX: value.REDIS_KEY_PREFIX ?? 'ecommbd-dev',
        LOG_FORMAT: value.LOG_FORMAT ?? (live(value.APP_ENV) ? 'json' : 'pretty'),
        SERVER_PORT: value.PORT ?? value.VENDURE_SERVER_PORT,
    }));

export type Env = z.infer<typeof envSchema>;

/** Validates a source of variables (for tests). Throws `EnvValidationError` listing every problem. */
export function readEnv(source: Record<string, string | undefined>): Env {
    return parseEnv(envSchema, source);
}
