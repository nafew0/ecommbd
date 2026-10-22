import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('woo_pairing')
export class WooPairing extends VendureEntity {
    constructor(input?: DeepPartial<WooPairing>) {
        super(input);
    }
    @Column() sourceId: number;
    @Column({ length: 64, select: false }) codeHash: string;
    @Column() expiresAt: Date;
    @Column({ type: 'timestamp', nullable: true }) usedAt: Date | null;
    @Column({ type: 'text', nullable: true, select: false }) token: string | null;
    @Column({ type: 'timestamp', nullable: true }) tokenExpiresAt: Date | null;
    @Column({ default: 0 }) nextSequence: number;
    @Column({ default: false }) finished: boolean;
    @Column({ type: 'jsonb', default: {} }) manifest: Record<string, unknown>;
}
@Entity('woo_chunk')
@Index(['pairingId', 'sequence'], { unique: true })
export class WooChunk extends VendureEntity {
    constructor(input?: DeepPartial<WooChunk>) {
        super(input);
    }
    @Column() pairingId: number;
    @Column() sequence: number;
    @Column({ length: 64 }) digest: string;
    @Column({ length: 64 }) nonce: string;
    @Column({ length: 24 }) kind: string;
    @Column() recordCount: number;
    @Column({ type: 'text', select: false }) payload: string;
}
@Entity('woo_legacy_auth')
@Index(['reference'], { unique: true })
@Index(['customerId'], { unique: true })
export class WooLegacyAuth extends VendureEntity {
    constructor(input?: DeepPartial<WooLegacyAuth>) {
        super(input);
    }
    @Column({ length: 64 }) reference: string;
    @Column() customerId: number;
    @Column() sourceId: number;
    @Column({ type: 'text', select: false }) secret: string;
    @Column() expiresAt: Date;
}
@Entity('woo_redirect')
@Index(['channelId', 'path'], { unique: true })
export class WooRedirect extends VendureEntity {
    constructor(input?: DeepPartial<WooRedirect>) {
        super(input);
    }
    @Column() channelId: number;
    @Column() sourceId: number;
    @Column({ length: 1000 }) path: string;
    @Column({ type: 'varchar', length: 1000, nullable: true }) target: string | null;
    @Column({ default: 301 }) status: number;
    @Column({ default: 0 }) hits: number;
}
@Entity('woo_miss')
@Index(['channelId', 'path'], { unique: true })
export class WooMiss extends VendureEntity {
    constructor(input?: DeepPartial<WooMiss>) {
        super(input);
    }
    @Column() channelId: number;
    @Column({ length: 1000 }) path: string;
    @Column({ default: 1 }) hits: number;
}
@Entity('woo_extra')
@Index(['sourceId', 'kind', 'sourceKey'], { unique: true })
export class WooExtra extends VendureEntity {
    constructor(input?: DeepPartial<WooExtra>) {
        super(input);
    }
    @Column() sourceId: number;
    @Column({ length: 24 }) kind: string;
    @Column({ length: 100 }) sourceKey: string;
    @Column({ type: 'jsonb' }) data: Record<string, unknown>;
}
