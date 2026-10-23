import { envList, envPort, parseEnv, parseKeyring } from '@ecommbd/shared';
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
        WOO_PUBLIC_URL: z
            .url()
            .refine(value => new URL(value).protocol === 'https:', 'must use HTTPS')
            .optional(),
        // Storefront cache (phase 17, docs/runbooks/storefront-cache.md). The cache tags' prefix, the
        // same on core and storefront and unique per store (default: REDIS_KEY_PREFIX).
        CACHE_STORE_ID: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,48}$/)
            .optional(),
        // Varnish's purge listener, e.g. http://127.0.0.1:6082/. Without it only the data cache is purged.
        CACHE_PURGE_URL: z.url().optional(),
        // Shared with Varnish: 64 lowercase hex characters (openssl rand -hex 32).
        CACHE_PURGE_SECRET: z
            .string()
            .regex(/^[a-f0-9]{64}$/, 'must be 64 lowercase hex characters (openssl rand -hex 32)')
            .optional(),
        // Request the top pages through STOREFRONT_URL after a purge-all or a Varnish restart.
        CACHE_WARM_UP: z.enum(['true', 'false']).default('false'),
        // Listings are refreshed a second time this long after a catalog change, once the search
        // index has caught up (it is updated in the worker, after the change).
        CACHE_LISTING_SETTLE_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
        WOO_IMPORT_KEYS: z
            .string()
            .refine(value => {
                try {
                    parseKeyring(value);
                    return true;
                } catch {
                    return false;
                }
            }, 'must be versioned 32-byte base64 keys, e.g. v1:<key>')
            .optional(),
        SUPERADMIN_USERNAME: z.string(),
        SUPERADMIN_PASSWORD: z.string(),
        CORS_ORIGINS: envList
            .pipe(z.array(z.url('must be a list of URLs, e.g. https://shop.example.com')))
            .optional(),
        ASSET_URL_PREFIX: z.url().optional(),
        // Where the WebP image sizes are written (default apps/core/static/images) and served from (default /img).
        IMAGES_DIR: z.string().optional(),
        IMAGE_URL_PREFIX: z.string().optional(),
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
        // The storefront's default language for a new store, chosen at setup. Later changed in Store settings.
        STORE_DEFAULT_LANGUAGE: z.enum(['bn', 'en']).default('bn'),
        // SMS: `log` records messages without sending (development); `none` until a provider is set up.
        SMS_DRIVER: z.enum(['log', 'none']).optional(),
        // The storefront's address, for SMS tracking links (<url>/t/<token>). Without it SMS carry no link.
        STOREFRONT_URL: z.url().optional(),
        // Searches a minute from one address (category pages count too); suggestions may be twice as many.
        SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(1_000_000).default(600),
        // Order tracking lookups from one address per 10 minutes (each phone also gets 10 an hour).
        TRACKING_RATE_LIMIT_PER_IP: z.coerce.number().int().min(5).max(1_000_000).default(20),
        // Real email (staff invites, password resets) outside development. Without SMTP_HOST, no email is sent.
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: envPort.optional(),
        SMTP_SECURE: z.enum(['true', 'false']).optional(),
        SMTP_USER: z.string().optional(),
        SMTP_PASSWORD: z.string().optional(),
        SMTP_FROM: z.string().optional(),
        LOG_LEVEL: z.enum(['error', 'warn', 'info', 'verbose', 'debug']).default('info'),
        LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
        STORE_ID: z.string().optional(),
        RELEASE_VERSION: z.string().optional(),
    })
    .superRefine((value, context) => {
        if (value.CACHE_PURGE_URL && !value.CACHE_PURGE_SECRET)
            context.addIssue({
                code: 'custom',
                path: ['CACHE_PURGE_SECRET'],
                message: 'is required with CACHE_PURGE_URL',
            });
        // Warming goes to the store's public address (the shoppers' cache keys) and notices a
        // Varnish restart through the purge listener.
        if (value.CACHE_WARM_UP === 'true' && (!value.STOREFRONT_URL || !value.CACHE_PURGE_URL))
            context.addIssue({
                code: 'custom',
                path: ['CACHE_WARM_UP'],
                message: 'needs STOREFRONT_URL and CACHE_PURGE_URL',
            });
        if (!live(value.APP_ENV)) {
            return;
        }
        if (value.CACHE_PURGE_SECRET && /^0+$/.test(value.CACHE_PURGE_SECRET)) {
            context.addIssue({
                code: 'custom',
                path: ['CACHE_PURGE_SECRET'],
                message: 'must not be all zeros in staging and production (openssl rand -hex 32)',
            });
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
