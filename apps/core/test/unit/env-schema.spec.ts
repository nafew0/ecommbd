import { describe, expect, it } from 'vitest';
import { readEnv } from '../../src/env-schema';

// The settings from .env.example.
const dev = {
    APP_ENV: 'dev',
    COOKIE_SECRET: 'a'.repeat(64),
    SUPERADMIN_USERNAME: 'superadmin',
    SUPERADMIN_PASSWORD: 'superadmin',
    DB_HOST: '127.0.0.1',
    DB_PORT: '54320',
    DB_NAME: 'ecommbd',
    DB_USERNAME: 'ecommbd',
    DB_PASSWORD: 'ecommbd',
    REDIS_QUEUE_HOST: '127.0.0.1',
    REDIS_QUEUE_PORT: '63790',
    REDIS_CACHE_HOST: '127.0.0.1',
    REDIS_CACHE_PORT: '63791',
};

describe('server settings', () => {
    it('accepts the development settings and fills in defaults', () => {
        const env = readEnv(dev);
        expect(env.SERVER_PORT).toBe(3000);
        expect(env.REDIS_KEY_PREFIX).toBe('ecommbd-dev');
        expect(env.LOG_FORMAT).toBe('pretty');
    });

    it('names each missing or invalid setting', () => {
        expect(() => readEnv({ ...dev, DB_HOST: undefined, COOKIE_SECRET: 'short' })).toThrow(
            /COOKIE_SECRET: must be at least 32 characters[\s\S]*DB_HOST: is required/,
        );
    });

    it('refuses unsafe production settings', () => {
        expect(() => readEnv({ ...dev, APP_ENV: 'production' })).toThrow(
            /SUPERADMIN_PASSWORD[\s\S]*REDIS_KEY_PREFIX[\s\S]*ASSET_URL_PREFIX/,
        );
    });

    it('accepts correct production settings and logs JSON', () => {
        const env = readEnv({
            ...dev,
            APP_ENV: 'production',
            SUPERADMIN_PASSWORD: 'a-long-random-password',
            REDIS_KEY_PREFIX: 's42',
            ASSET_URL_PREFIX: 'https://shop.example.com/assets/',
            PORT: '5000',
        });
        expect(env.LOG_FORMAT).toBe('json');
        expect(env.SERVER_PORT).toBe(5000);
    });
});
