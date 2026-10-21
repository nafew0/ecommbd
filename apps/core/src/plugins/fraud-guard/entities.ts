import type { DismissReason, IncompleteStatus } from '@ecommbd/shared';
import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export interface CartSnapshotLine {
    variantId: ID;
    name: string;
    quantity: number;
    /** Poisha, with tax, when the shopper saw it. */
    unitPrice: number;
}

/**
 * A checkout the shopper started but didn't finish (roadmap phase 11): saved as soon as a valid
 * phone is typed. One open record per phone (the latest details win). After 30 days the personal
 * data (phone, name, cart) is removed and only the status and dates stay, for counts.
 */
@Entity('bd_incomplete_checkout')
@Index('IDX_bd_incomplete_checkout_open_phone', ['phone'], { unique: true, where: `"status" = 'open'` })
export class BdIncompleteCheckout extends VendureEntity {
    constructor(input?: DeepPartial<BdIncompleteCheckout>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar', length: 16 })
    status: IncompleteStatus;

    /** E.164; null once expired. */
    @Index()
    @Column({ type: 'varchar', length: 20, nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    name: string | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    districtId: string | null;

    @Column({ type: 'varchar', length: 24, nullable: true })
    thanaId: string | null;

    @Column({ type: 'simple-json', nullable: true })
    cart: CartSnapshotLine[] | null;

    /** Poisha. */
    @Column({ type: 'int', default: 0 })
    cartTotal: number;

    /** utm_source and friends, as the storefront passed them. */
    @Column({ type: 'simple-json', nullable: true })
    source: Record<string, string> | null;

    @Column({ type: 'varchar', length: 2, default: 'bn' })
    language: string;

    /** The order that recovered or converted it. */
    @Column({ type: 'int', nullable: true })
    orderId: ID | null;

    @Column({ type: 'varchar', length: 24, nullable: true })
    dismissReason: DismissReason | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    closedBy: string | null;

    @Column({ type: 'timestamp', nullable: true })
    closedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    smsSentAt: Date | null;
}

export type BlockKind = 'phone' | 'ip';

/** A phone or IP that may not order from the storefront. IPs are always temporary. */
@Entity('bd_block_entry')
export class BdBlockEntry extends VendureEntity {
    constructor(input?: DeepPartial<BdBlockEntry>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 8 })
    kind: BlockKind;

    /** E.164 phone, or a normalized IP address. */
    @Index()
    @Column({ type: 'varchar', length: 64 })
    value: string;

    /** Null: permanent (phones only). */
    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;

    @Column({ type: 'varchar', length: 120, default: '' })
    addedBy: string;

    /** Unblocked (kept for the record). */
    @Index()
    @Column({ type: 'timestamp', nullable: true })
    removedAt: Date | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    removedBy: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    removedReason: string | null;
}

/** A verification code sent for one order. Only a hash of the code is kept. */
@Entity('bd_otp_code')
export class BdOtpCode extends VendureEntity {
    constructor(input?: DeepPartial<BdOtpCode>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar', length: 20 })
    phone: string;

    @Index()
    @Column({ type: 'int' })
    orderId: ID;

    /** HMAC-SHA256 of the order and code, hex. */
    @Column({ type: 'varchar', length: 64 })
    codeHash: string;

    @Column({ type: 'timestamp' })
    expiresAt: Date;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    @Column({ type: 'timestamp', nullable: true })
    verifiedAt: Date | null;
}
