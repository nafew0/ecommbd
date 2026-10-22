import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@vendure/core';
import Redis from 'ioredis';
import { BD_SECTIONS_PLUGIN_OPTIONS, type BdSectionsPluginOptions, loggerCtx } from './constants';

/**
 * Tells the storefront's data cache (apps/storefront/src/lib/cache.ts) to forget entries, the way
 * its own `invalidate` does: delete the tagged keys in the cache Redis, then publish the tags on
 * `<prefix>:sf:purge` so every storefront process drops its in-memory copies. Without Redis the
 * entries simply expire (CACHE_TTL_SECONDS). Varnish purging is phase 17.
 */
@Injectable()
export class StorefrontPurger implements OnModuleDestroy {
    private readonly redis: Redis;
    private readonly prefix: string;

    constructor(@Inject(BD_SECTIONS_PLUGIN_OPTIONS) options: BdSectionsPluginOptions) {
        this.prefix = `${options.redisKeyPrefix}:sf:`;
        this.redis = new Redis({
            ...options.redis,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            commandTimeout: 1000,
        });
        this.redis.on('error', () => undefined);
    }

    async purge(tags: string[]): Promise<void> {
        try {
            for (const tag of tags) {
                const names = await this.redis.smembers(`${this.prefix}tag:${tag}`);
                if (names.length) await this.redis.del(...names.map(name => `${this.prefix}data:${name}`));
                await this.redis.del(`${this.prefix}tag:${tag}`);
            }
            await this.redis.publish(`${this.prefix}purge`, tags.join(','));
        } catch (error) {
            Logger.warn(`Storefront cache not purged (Redis unavailable): ${String(error)}`, loggerCtx);
        }
    }

    async onModuleDestroy() {
        if (this.redis.status === 'ready') {
            await this.redis.quit();
        } else {
            this.redis.disconnect();
        }
    }
}
