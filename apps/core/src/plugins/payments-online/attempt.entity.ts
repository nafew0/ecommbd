import type {
    AttemptStatus,
    GatewayMode,
    OnlineGateway,
    PaymentReviewReason,
    PaymentReviewState,
} from '@ecommbd/shared';
import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** One gateway event, kept for support with secrets removed. */
export interface AttemptEvent {
    at: string;
    /** start, ipn, return, callback, execute, query, refund */
    source: string;
    /** The gateway's own status words, e.g. VALID, Completed, 2023. */
    status: string;
    /** JSON of the gateway's answer, secrets and personal data removed. */
    data: string;
}

/**
 * One try at paying an online payment (phase 18). A Vendure payment can have several (the shopper
 * pays again after a failure); only one can settle it. Money from any other attempt (a second tab,
 * after the order was cancelled) goes to the review queue for a refund, never silently dropped.
 */
@Entity('bd_payment_attempt')
export class BdPaymentAttempt extends VendureEntity {
    constructor(input?: DeepPartial<BdPaymentAttempt>) {
        super(input);
    }

    /** 32 random hex characters: our `tran_id` / invoice number, and the key in the shopper's pay link. */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 40 })
    token: string;

    @Index()
    @Column({ type: 'int' })
    orderId: ID;

    @Index()
    @Column({ type: 'int' })
    paymentId: ID;

    @Column({ type: 'varchar', length: 16 })
    gateway: OnlineGateway;

    /** Sandbox or live, as when the attempt was made: its checks and refunds use the same credentials. */
    @Column({ type: 'varchar', length: 8 })
    mode: GatewayMode;

    /** Poisha, the amount this attempt must pay. */
    @Column({ type: 'int' })
    amount: number;

    @Index()
    @Column({ type: 'varchar', length: 12 })
    status: AttemptStatus;

    /** The gateway's session or payment ID (SSLCommerz sessionkey, bKash paymentID). */
    @Index()
    @Column({ type: 'varchar', length: 100, nullable: true })
    gatewaySessionId: string | null;

    /**
     * The gateway's own proof of payment, `gateway:id` (SSLCommerz val_id, bKash trxID). Unique, so the
     * same payment is applied once however many notifications arrive.
     */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 120, nullable: true })
    gatewayReference: string | null;

    /** What staff look up in the gateway's panel (SSLCommerz bank_tran_id, bKash trxID). */
    @Column({ type: 'varchar', length: 100, nullable: true })
    gatewayTransactionId: string | null;

    /** Poisha the gateway says was paid (may differ: then it's a mismatch). */
    @Column({ type: 'int', nullable: true })
    paidAmount: number | null;

    @Column({ type: 'timestamp', precision: 6, nullable: true })
    paidAt: Date | null;

    /** Why the shopper's last try failed, as a code for the storefront (e.g. insufficientBalance). */
    @Column({ type: 'varchar', length: 40, nullable: true })
    failureCode: string | null;

    /** When the reconciliation task next asks the gateway; null when finished or given up. */
    @Index()
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    nextCheckAt: Date | null;

    @Column({ type: 'int', default: 0 })
    checks: number;

    @Column({ type: 'timestamp', precision: 6, nullable: true })
    lastCheckedAt: Date | null;

    @Column({ type: 'varchar', length: 12, nullable: true })
    reviewReason: PaymentReviewReason | null;

    @Index()
    @Column({ type: 'varchar', length: 12, nullable: true })
    reviewState: PaymentReviewState | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    reviewNote: string | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    reviewedBy: string | null;

    @Column({ type: 'timestamp', precision: 6, nullable: true })
    reviewedAt: Date | null;

    /** The gateway's refund reference, once refunded through the API. */
    @Column({ type: 'varchar', length: 100, nullable: true })
    refundReference: string | null;

    /** Gateway responses with secrets removed, oldest first (at most 30). */
    @Column({ type: 'jsonb', default: () => "'[]'" })
    events: AttemptEvent[];
}
