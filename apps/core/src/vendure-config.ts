import {
    DefaultLogger,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    RedisCachePlugin,
    VendureConfig,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { BullMQJobQueuePlugin } from '@vendure/job-queue-plugin/package/bullmq';
import path from 'path';
import { env } from './env';
import { JsonLogger, toVendureLogLevel } from './logging/json-logger';
import { requestIdMiddleware } from './logging/request-context';
import { customPlugins } from './plugins';
import { skipPlaceholderRecipients } from './plugins/bd-checkout';
import { LogSmsDriver, NoSmsDriver } from './plugins/notifications';

const IS_DEV = env.APP_ENV === 'dev';
const IS_LIVE = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
// Every store's Redis keys live under its own prefix (see docs/architecture.md, Decision 5).
const KEY_PREFIX = env.REDIS_KEY_PREFIX;
const serverPort = env.SERVER_PORT;
const shopApiPath = 'shop-api';
const adminApiPath = 'admin-api';
const logLevel = toVendureLogLevel(env.LOG_LEVEL);

export const config: VendureConfig = {
    apiOptions: {
        port: serverPort,
        adminApiPath,
        shopApiPath,
        trustProxy: IS_DEV ? false : 1,
        // Which browser origins may make credentialed requests to the Shop and Admin APIs.
        // In dev any origin is reflected, so a storefront on any port works. In production set
        // CORS_ORIGINS to a comma-separated list of the origins you serve, for example
        // "https://example.com,https://admin.example.com". An unset value blocks all
        // cross-origin browser requests, which is the safe default.
        cors: {
            origin: IS_DEV ? true : (env.CORS_ORIGINS ?? []),
            credentials: true,
        },
        // Refuses API requests a browser could send from another site without a preflight (form
        // posts, which enable login CSRF). Our admin, the Dashboard and @vendure/testing send the
        // header this needs on uploads.
        csrfPrevention: true,
        // Every API request gets an ID, returned as x-request-id and included in its log lines.
        middleware: [
            { handler: requestIdMiddleware, route: shopApiPath },
            { handler: requestIdMiddleware, route: adminApiPath },
        ],
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: env.SUPERADMIN_USERNAME,
            password: env.SUPERADMIN_PASSWORD,
        },
        // HTTP-only session cookies, never readable by scripts. Separate names, so signing in to the
        // storefront never replaces a staff member's admin session on the same domain.
        cookieOptions: {
            secret: env.COOKIE_SECRET,
            name: { shop: 'shop-session', admin: 'admin-session' },
            sameSite: 'lax',
            secure: IS_LIVE,
        },
    },
    dbConnectionOptions: {
        type: 'postgres',
        // See the README.md "Migrations" section for an explanation of
        // the `synchronize` and `migrations` options.
        synchronize: false,
        migrations: [path.join(__dirname, './migrations/*.+(js|ts)')],
        logging: false,
        database: env.DB_NAME,
        host: env.DB_HOST,
        port: env.DB_PORT,
        username: env.DB_USERNAME,
        password: env.DB_PASSWORD,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    // JSON with masked phone numbers and emails in staging/production; readable output in dev.
    logger:
        env.LOG_FORMAT === 'json'
            ? new JsonLogger({ level: logLevel, storeId: env.STORE_ID, release: env.RELEASE_VERSION })
            : new DefaultLogger({ level: logLevel }),
    // When adding or altering custom field definitions, the database will
    // need to be updated. See the "Migrations" section in README.md.
    customFields: {},
    plugins: [
        // GraphiQL is a development tool: never expose it on a live store.
        ...(IS_DEV ? [GraphiqlPlugin.init()] : []),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
            // In dev the URL is guessed from the request; staging and production must set it.
            assetUrlPrefix: IS_DEV ? undefined : env.ASSET_URL_PREFIX,
        }),
        DefaultSchedulerPlugin.init(),
        // Job queue on the "queue" Redis (noeviction): jobs are pushed to the worker, no database polling.
        BullMQJobQueuePlugin.init({
            connection: {
                host: env.REDIS_QUEUE_HOST,
                port: env.REDIS_QUEUE_PORT,
                username: env.REDIS_QUEUE_USERNAME,
                password: env.REDIS_QUEUE_PASSWORD,
                maxRetriesPerRequest: null,
            },
            queueOptions: { prefix: `${KEY_PREFIX}:bull` },
            workerOptions: { prefix: `${KEY_PREFIX}:bull` },
        }),
        // Cache on the "cache" Redis (allkeys-lru).
        RedisCachePlugin.init({
            namespace: `${KEY_PREFIX}:cache`,
            redisOptions: {
                host: env.REDIS_CACHE_HOST,
                port: env.REDIS_CACHE_PORT,
                username: env.REDIS_CACHE_USERNAME,
                password: env.REDIS_CACHE_PASSWORD,
            },
        }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        EmailPlugin.init({
            // Development writes emails to files and shows them at /mailbox; nowhere else is that
            // page served. Staging and production send through SMTP, or nothing without SMTP_HOST.
            ...(IS_DEV
                ? {
                      devMode: true as const,
                      outputPath: path.join(__dirname, '../static/email/test-emails'),
                      route: 'mailbox',
                  }
                : {
                      transport: env.SMTP_HOST
                          ? {
                                type: 'smtp' as const,
                                host: env.SMTP_HOST,
                                port: env.SMTP_PORT ?? 587,
                                secure: env.SMTP_SECURE === 'true',
                                auth: { user: env.SMTP_USER ?? '', pass: env.SMTP_PASSWORD ?? '' },
                            }
                          : { type: 'none' as const },
                  }),
            // Never to a phone-only customer's placeholder address (…@phone.invalid).
            handlers: skipPlaceholderRecipients(defaultEmailHandlers),
            templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../static/email/templates')),
            globalTemplateVars: {
                // The following variables will change depending on your storefront implementation.
                // No storefront was created, so port 3001 is only a placeholder:
                // nothing is listening on it until you point these at your own storefront.
                fromAddress: env.SMTP_FROM ?? '"example" <noreply@example.com>',
                verifyEmailAddressUrl: 'http://localhost:3001/verify',
                passwordResetUrl: 'http://localhost:3001/reset-password',
                changeEmailAddressUrl: 'http://localhost:3001/account/verify-email',
                // The URL of the password reset page of the Vendure Dashboard.
                adminPasswordResetUrl: `http://localhost:${serverPort}/dashboard/reset-password`,
            },
        }),
        DashboardPlugin.init({
            route: 'dashboard',
            appDir: IS_DEV ? path.join(__dirname, '../dist/dashboard') : path.join(__dirname, 'dashboard'),
        }),
        ...customPlugins({
            defaultLanguage: env.STORE_DEFAULT_LANGUAGE,
            assetUrlPrefix: env.ASSET_URL_PREFIX,
            imagesDir: env.IMAGES_DIR,
            imageUrlPrefix: env.IMAGE_URL_PREFIX,
            cacheRedis: {
                host: env.REDIS_CACHE_HOST,
                port: env.REDIS_CACHE_PORT,
                username: env.REDIS_CACHE_USERNAME,
                password: env.REDIS_CACHE_PASSWORD,
            },
            redisKeyPrefix: KEY_PREFIX,
            smsDriver:
                (env.SMS_DRIVER ?? (IS_DEV ? 'log' : 'none')) === 'log'
                    ? new LogSmsDriver()
                    : new NoSmsDriver(),
            storefrontUrl: env.STOREFRONT_URL,
            searchRateLimits: {
                search: { limit: env.SEARCH_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 },
                suggest: { limit: env.SEARCH_RATE_LIMIT_PER_MINUTE * 2, windowMs: 60_000 },
            },
        }),
    ],
};
