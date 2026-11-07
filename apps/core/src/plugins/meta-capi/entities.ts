import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, Unique } from 'typeorm';

/** JSON as stored (an object; read it with a cast). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM can't type unknown JSON in an update.
export type MetaPayload = Record<string, any>;

export type MetaEventStatus = 'queued' | 'sent' | 'failed' | 'skipped';

/**
 * One event for one Pixel, kept like an outbox (phase 20): written first, sent in batches by a task,
 * with Meta's answer. Unique by Pixel and event ID, so a repeated event (a retry, a second trigger)
 * is sent once. The client's IP and browser are kept only until sent; the payload holds only hashed
 * personal data.
 */
@Entity('bd_meta_event')
@Unique(['pixelId', 'eventId'])
export class BdMetaEvent extends VendureEntity {
    constructor(input?: DeepPartial<BdMetaEvent>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar', length: 20 })
    pixelId: string;

    @Index()
    @Column({ type: 'varchar', length: 30 })
    eventName: string;

    @Column({ type: 'varchar', length: 80 })
    eventId: string;

    /** browser (the storefront's copy), server (Purchase from the order) or test */
    @Column({ type: 'varchar', length: 10 })
    source: 'browser' | 'server' | 'test';

    @Index()
    @Column({ type: 'int', nullable: true })
    orderId: ID | null;

    @Index()
    @Column({ type: 'varchar', length: 10 })
    status: MetaEventStatus;

    /** When it happened (Meta's event_time). */
    @Column({ type: 'timestamp', precision: 6 })
    eventTime: Date;

    /** The event as sent, without the client's IP and browser (hashed user data only). */
    @Column({ type: 'jsonb' })
    payload: MetaPayload;

    @Column({ type: 'varchar', length: 64, nullable: true })
    clientIp: string | null;

    @Column({ type: 'varchar', length: 400, nullable: true })
    userAgent: string | null;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    @Index()
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    nextAttemptAt: Date | null;

    @Column({ type: 'timestamp', precision: 6, nullable: true })
    sentAt: Date | null;

    /** Meta's answer: events_received, fbtrace_id, messages. */
    @Column({ type: 'jsonb', nullable: true })
    response: MetaPayload | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    error: string | null;
}
