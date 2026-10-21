import { envPort, parseEnv } from '@ecommbd/shared/env';
import { z } from 'zod';

/**
 * Every environment variable the storefront's pages read, validated on first use. Server-side
 * only: nothing here reaches the browser (Astro only exposes `PUBLIC_` variables to client code,
 * and we have none). `server.mjs` reads the few it needs itself.
 */
const live = (appEnv: string) => appEnv === 'staging' || appEnv === 'production';

export const envSchema = z
    .object({
        APP_ENV: z.enum(['dev', 'test', 'staging', 'production']).default('dev'),
        /** The core on this server; the storefront calls its Shop API at `<CORE_URL>/shop-api`. */
        CORE_URL: z.url().default('http://localhost:3000'),
        CORE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
        /** The store's public address, for canonical URLs, sitemaps and Open Graph. */
        SITE_URL: z.url().optional(),
        /** `maintenance` or `suspended` serve a 503 page instead of the store (phases 24 and 39). */
        STOREFRONT_STATE: z.enum(['live', 'maintenance', 'suspended']).default('live'),
        REDIS_CACHE_HOST: z.string().optional(),
        REDIS_CACHE_PORT: envPort.optional(),
        REDIS_CACHE_USERNAME: z.string().optional(),
        REDIS_CACHE_PASSWORD: z.string().optional(),
        REDIS_KEY_PREFIX: z.string().default('ecommbd-dev'),
        /** Extra origins for the Content Security Policy, e.g. a store's analytics (comma-separated). */
        CSP_ALLOWED_ORIGINS: z
            .string()
            .default('')
            .transform(value =>
                value
                    .split(',')
                    .map(item => item.trim())
                    .filter(Boolean),
            )
            .pipe(z.array(z.url())),
        /** Seconds the data cache keeps settings, menus and categories. */
        CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    })
    .superRefine((value, context) => {
        if (live(value.APP_ENV) && !value.SITE_URL) {
            context.addIssue({
                code: 'custom',
                path: ['SITE_URL'],
                message: 'is required in staging and production (the store’s public https:// address)',
            });
        }
    })
    .transform(value => ({
        ...value,
        SITE_URL: (value.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, ''),
        CORE_URL: value.CORE_URL.replace(/\/$/, ''),
    }));

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** The validated environment (throws `EnvValidationError` listing every problem). */
export function env(): Env {
    cached ??= parseEnv(envSchema, process.env);
    return cached;
}
