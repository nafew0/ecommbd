import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * A stock change made by staff, with why (recount, received, damaged, gift, returned, other).
 * Vendure records the movement itself; this keeps the reason and who did it, for the stock history.
 */
@Entity('bd_stock_adjustment')
export class BdStockAdjustment extends VendureEntity {
    constructor(input?: DeepPartial<BdStockAdjustment>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    productVariantId: ID;

    /** Units added (positive) or removed (negative). */
    @Column({ type: 'int' })
    change: number;

    @Column({ type: 'int' })
    stockAfter: number;

    @Column({ type: 'varchar', length: 16 })
    reason: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;

    @Column({ type: 'varchar', length: 120, default: '' })
    staffName: string;
}
