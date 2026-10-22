import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('cache_purge_request')
@Index(['channelId', 'dueAt'])
export class CachePurgeRequest extends VendureEntity {
    constructor(input?: DeepPartial<CachePurgeRequest>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ type: 'jsonb' }) tags: string[];
    @Column({ default: false }) all: boolean;
    @Column() dueAt: Date;
    @Column({ nullable: true }) boundary: string;
}
@Entity('cache_stock_state')
@Index(['channelId', 'variantId'], { unique: true })
export class CacheStockState extends VendureEntity {
    constructor(input?: DeepPartial<CacheStockState>) {
        super(input);
    }
    @Column() channelId: number;
    @Column() variantId: number;
    @Column() available: boolean;
}
@Entity('cache_vital_sample')
@Index(['channelId', 'metricId'], { unique: true })
@Index(['channelId', 'day'])
export class CacheVitalSample extends VendureEntity {
    constructor(input?: DeepPartial<CacheVitalSample>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ length: 40 }) metricId: string;
    @Column({ length: 3 }) name: string;
    @Column({ type: 'double precision' }) value: number;
    @Column({ length: 16 }) route: string;
    @Column({ type: 'date' }) day: string;
}
