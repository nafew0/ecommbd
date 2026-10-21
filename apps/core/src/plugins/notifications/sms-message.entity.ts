import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type SmsStatus = 'queued' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'skipped';

/**
 * Every SMS, kept like an outbox: written first, then sent by a job with retries. The idempotency
 * key (order, event, recipient) makes a retry or a repeated event never send twice.
 */
@Entity('bd_sms_message')
export class BdSmsMessage extends VendureEntity {
    constructor(input?: DeepPartial<BdSmsMessage>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 120 })
    idempotencyKey: string;

    @Index()
    @Column({ type: 'int', nullable: true })
    orderId: ID | null;

    @Column({ type: 'varchar', length: 24 })
    event: string;

    /** E.164 mobile number. */
    @Index()
    @Column({ type: 'varchar', length: 20 })
    to: string;

    @Column({ type: 'text' })
    body: string;

    @Column({ type: 'varchar', length: 2 })
    language: string;

    @Column({ type: 'boolean', default: false })
    unicode: boolean;

    @Column({ type: 'int', default: 1 })
    segments: number;

    @Index()
    @Column({ type: 'varchar', length: 12 })
    status: string;

    /** Why it was skipped or failed (no personal data). */
    @Column({ type: 'varchar', length: 200, default: '' })
    reason: string;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    /** Not before this time (quiet hours). */
    @Index()
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    sendAfter: Date | null;

    @Column({ type: 'timestamp', precision: 6, nullable: true })
    sentAt: Date | null;

    @Index()
    @Column({ type: 'varchar', length: 80, nullable: true })
    providerMessageId: string | null;
}
