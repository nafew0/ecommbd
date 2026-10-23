import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('woo_source')
@Index(['channelId', 'url'], { unique: true })
export class WooSource extends VendureEntity {
    constructor(input?: DeepPartial<WooSource>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ length: 500 }) url: string;
    @Column({ type: 'text', nullable: true, select: false }) credentials: string | null;
    @Column({ type: 'jsonb', default: [] }) imageHosts: string[];
    @Column({ type: 'jsonb', default: {} }) settings: Record<string, unknown>;
    @Column({ type: 'timestamp', nullable: true }) lastSyncedAt: Date | null;
    @Column({ type: 'boolean', default: false }) completed: boolean;
}

@Entity('woo_run')
@Index(['sourceId', 'createdAt'])
export class WooRun extends VendureEntity {
    constructor(input?: DeepPartial<WooRun>) {
        super(input);
    }
    @Column() sourceId: number;
    @Column({ length: 24 }) mode: 'dryRun' | 'import' | 'catchUp';
    @Column({ length: 24, default: 'queued' }) status: string;
    @Column({ type: 'timestamp' }) watermark: Date;
    @Column({ type: 'timestamp', nullable: true }) modifiedAfter: Date | null;
    @Column({ type: 'jsonb', default: { stage: 0, offset: 0, size: 100 } }) cursor: {
        stage: number;
        offset: number;
        size: number;
    };
    @Column({ type: 'jsonb', default: {} }) counts: Record<string, number>;
    @Column({ type: 'jsonb', default: {} }) verification: Record<string, unknown>;
    @Column({ type: 'timestamp', nullable: true }) leaseUntil: Date | null;
    @Column({ type: 'varchar', nullable: true }) leaseOwner: string | null;
    @Column({ type: 'varchar', nullable: true }) error: string | null;
    /** The staff member (administrator user ID) who started the run: every run is recorded. */
    @Column({ type: 'varchar', nullable: true }) startedBy: string | null;
}

@Entity('woo_mapping')
@Index(['sourceId', 'kind', 'sourceKey'], { unique: true })
export class WooMapping extends VendureEntity {
    constructor(input?: DeepPartial<WooMapping>) {
        super(input);
    }
    @Column() sourceId: number;
    @Column({ length: 32 }) kind: string;
    @Column({ length: 600 }) sourceKey: string;
    @Column({ type: 'varchar', nullable: true }) targetId: string | null;
    @Column({ length: 64 }) digest: string;
    @Column({ type: 'jsonb', default: {} }) metadata: Record<string, unknown>;
}

@Entity('woo_issue')
@Index(['runId', 'createdAt'])
export class WooIssue extends VendureEntity {
    constructor(input?: DeepPartial<WooIssue>) {
        super(input);
    }
    @Column() runId: number;
    @Column({ length: 32 }) kind: string;
    @Column({ length: 100 }) sourceKey: string;
    @Column({ length: 64 }) code: string;
    @Column({ length: 16, default: 'warning' }) severity: string;
}

@Entity('woo_legacy_order')
@Index(['sourceId', 'sourceOrderId'], { unique: true })
@Index(['channelId', 'customerId'])
export class LegacyOrder extends VendureEntity {
    constructor(input?: DeepPartial<LegacyOrder>) {
        super(input);
    }
    @Column() channelId: number;
    @Column() sourceId: number;
    @Column({ length: 100 }) sourceOrderId: string;
    @Column({ length: 100 }) number: string;
    @Column({ length: 64 }) status: string;
    @Column({ length: 8 }) currency: string;
    @Column({ type: 'bigint' }) total: string;
    @Column({ type: 'bigint', default: '0' }) refunded: string;
    @Column({ type: 'timestamp', nullable: true }) placedAt: Date | null;
    @Column({ type: 'integer', nullable: true }) customerId: number | null;
    @Column({ type: 'varchar', length: 30, nullable: true }) phone: string | null;
    @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
    @Column({ type: 'integer', nullable: true }) liveOrderId: number | null;
}
