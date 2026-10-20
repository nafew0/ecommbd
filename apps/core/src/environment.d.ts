export {};

// Here we declare the members of the process.env object, so that we
// can use them in our application code in a type-safe manner.
declare global {
    namespace NodeJS {
        interface ProcessEnv {
            APP_ENV: string;
            VENDURE_SERVER_PORT: string;
            PORT: string;
            COOKIE_SECRET: string;
            SUPERADMIN_USERNAME: string;
            SUPERADMIN_PASSWORD: string;
            CORS_ORIGINS?: string;
            DB_HOST: string;
            DB_PORT: string;
            DB_NAME: string;
            DB_USERNAME: string;
            DB_PASSWORD: string;
            REDIS_KEY_PREFIX?: string;
            REDIS_QUEUE_HOST: string;
            REDIS_QUEUE_PORT: string;
            REDIS_QUEUE_USERNAME?: string;
            REDIS_QUEUE_PASSWORD?: string;
            REDIS_CACHE_HOST: string;
            REDIS_CACHE_PORT: string;
            REDIS_CACHE_USERNAME?: string;
            REDIS_CACHE_PASSWORD?: string;
        }
    }
}
