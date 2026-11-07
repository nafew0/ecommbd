import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * The purge outbox. A change writes a row in its own transaction (so a rolled-back change purges
 * nothing), and the worker delivers due rows: the data cache in Redis first, then Varnish. A row
 * stays until Varnish accepts it, so nothing is lost while Varnish or Redis is down.
 */
@Entity('cache_purge_request')
@Index(['channelId', 'dueAt'])
export class CachePurgeRequest extends VendureEntity {
    constructor(input?: DeepPartial<CachePurgeRequest>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ type: 'jsonb' }) tags: string[];
    /** Purge the whole store, then warm it up (imports, theme switches). */
    @Column({ default: false }) all: boolean;
    @Column() dueAt: Date;
    /**
     * Null for an ordinary change, delivered with the next batch. Otherwise a scheduled purge that
     * waits for its own time: `promotion:<id>` (a promotion starts or ends) or `listing-settle…`
     * (listings again, once the search index has caught up).
     */
    @Column({ nullable: true }) boundary: string;
}

/**
 * The stock level each variant last showed on the storefront, so a sale that leaves it "in stock"
 * purges nothing and only a change of what shoppers see (in stock, low stock, sold out) does.
 */
@Entity('cache_stock_state')
@Index(['channelId', 'variantId'], { unique: true })
export class CacheStockState extends VendureEntity {
    constructor(input?: DeepPartial<CacheStockState>) {
        super(input);
    }
    @Column() channelId: number;
    @Column() variantId: number;
    /** Kept for rows written before `level` (any stock left). */
    @Column() available: boolean;
    /** `IN_STOCK`, `LOW_STOCK` or `OUT_OF_STOCK`, as the Shop API shows it. Null on older rows. */
    @Column({ type: 'varchar', length: 16, nullable: true }) level: string | null;
}

/**
 * One anonymous speed measurement from a shopper's browser: the metric, its value, the kind of
 * page and the Dhaka day. Nothing about the visitor: `metricId` is a hash of web-vitals' random
 * per-page-view ID, used only so a repeated report updates its row instead of adding one.
 */
@Entity('cache_vital_sample')
@Index(['channelId', 'metricId'], { unique: true })
@Index(['channelId', 'day'])
export class CacheVitalSample extends VendureEntity {
    constructor(input?: DeepPartial<CacheVitalSample>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ length: 40 }) metricId: string;
    /** `LCP`, `INP` or `CLS`. */
    @Column({ length: 3 }) name: string;
    /** Milliseconds (LCP, INP) or the layout-shift score (CLS). */
    @Column({ type: 'double precision' }) value: number;
    /** The kind of page (`product`, `category`…), never its address. */
    @Column({ length: 16 }) route: string;
    /** The day in Asia/Dhaka (YYYY-MM-DD). */
    @Column({ type: 'date' }) day: string;
}
