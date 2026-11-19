import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Stock on its way from one branch to another (phase 54). The goods leave the source when this
 * is sent and arrive when received. What is still on the way is quantity minus received: it is
 * not a stock location, so it cannot be sold twice.
 */
@Entity('bd_stock_transfer')
export class BdStockTransfer extends VendureEntity {
    constructor(input?: DeepPartial<BdStockTransfer>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 40 })
    number: string;

    @Index()
    @Column({ type: 'int' })
    fromLocationId: ID;

    @Index()
    @Column({ type: 'int' })
    toLocationId: ID;

    /** sent, partial or received. */
    @Column({ type: 'varchar', length: 16 })
    status: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;

    @Column({ type: 'timestamp', precision: 6 })
    sentAt: Date;
}

@Entity('bd_stock_transfer_line')
export class BdStockTransferLine extends VendureEntity {
    constructor(input?: DeepPartial<BdStockTransferLine>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    transferId: ID;

    @Index()
    @Column({ type: 'int' })
    productVariantId: ID;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int', default: 0 })
    received: number;
}
