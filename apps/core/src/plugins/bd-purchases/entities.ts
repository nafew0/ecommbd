import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** Someone the shop buys stock from (phase 52). The balance is calculated, not stored. */
@Entity('bd_supplier')
export class BdSupplier extends VendureEntity {
    constructor(input?: DeepPartial<BdSupplier>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 150 })
    name: string;

    /** E.164, or null when the shop has no number for them. */
    @Column({ type: 'varchar', length: 20, nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 500, default: '' })
    address: string;

    @Column({ type: 'varchar', length: 1000, default: '' })
    note: string;
}

/** One purchase. `number` is ours (PO-1001). Stock changes only when goods are received. */
@Entity('bd_purchase')
export class BdPurchase extends VendureEntity {
    constructor(input?: DeepPartial<BdPurchase>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    supplierId: ID;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 40 })
    number: string;

    /** draft, ordered, partial or received. */
    @Column({ type: 'varchar', length: 16 })
    status: string;

    /** The Dhaka calendar day, YYYY-MM-DD. */
    @Column({ type: 'varchar', length: 10 })
    purchasedOn: string;

    @Column({ type: 'varchar', length: 1000, default: '' })
    note: string;

    /** Written when more arrived than was ordered. */
    @Column({ type: 'varchar', length: 500, default: '' })
    receiveNote: string;

    @Column({ type: 'int', default: 0 })
    delivery: number;

    @Column({ type: 'int', default: 0 })
    otherCharge: number;

    @Column({ type: 'int', default: 0 })
    discount: number;

    @Column({ type: 'int', default: 0 })
    paid: number;

    @Column({ type: 'int', nullable: true })
    billAssetId: ID | null;
}

@Entity('bd_purchase_line')
export class BdPurchaseLine extends VendureEntity {
    constructor(input?: DeepPartial<BdPurchaseLine>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    purchaseId: ID;

    @Index()
    @Column({ type: 'int' })
    productVariantId: ID;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int', default: 0 })
    received: number;

    @Column({ type: 'int', default: 0 })
    returned: number;

    @Column({ type: 'int' })
    unitCost: number;

    /** The variation's cost just before this line was first received. */
    @Column({ type: 'int', nullable: true })
    priorUnitCost: number | null;

    @Column({ default: false })
    priorKnown: boolean;
}

@Entity('bd_purchase_return')
export class BdPurchaseReturn extends VendureEntity {
    constructor(input?: DeepPartial<BdPurchaseReturn>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    purchaseId: ID;

    @Index()
    @Column({ type: 'int' })
    supplierId: ID;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 40 })
    number: string;

    @Column({ type: 'varchar', length: 10 })
    returnedOn: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;
}

@Entity('bd_purchase_return_line')
export class BdPurchaseReturnLine extends VendureEntity {
    constructor(input?: DeepPartial<BdPurchaseReturnLine>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    returnId: ID;

    @Index()
    @Column({ type: 'int' })
    purchaseLineId: ID;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int' })
    unitCost: number;
}

/** Money paid to a supplier outside a single purchase's own "paid" amount. Accounts come in phase 53. */
@Entity('bd_supplier_payment')
export class BdSupplierPayment extends VendureEntity {
    constructor(input?: DeepPartial<BdSupplierPayment>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    supplierId: ID;

    @Column({ type: 'int' })
    amount: number;

    @Column({ type: 'varchar', length: 10 })
    paidOn: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;

    /** The account the money left, when the shop recorded one (phase 53). Null on older payments. */
    @Column({ type: 'int', nullable: true })
    accountId: number | null;
}
