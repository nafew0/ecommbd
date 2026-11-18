import { type DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** Where the shop's money sits. The current balance is calculated, not stored. */
@Entity('bd_account')
export class BdAccount extends VendureEntity {
    constructor(input?: DeepPartial<BdAccount>) {
        super(input);
    }

    /** cash, bank, wallet or courier. */
    @Column({ type: 'varchar', length: 16 })
    kind: string;

    @Column({ type: 'varchar', length: 80 })
    name: string;

    /** Poisha, whole taka, zero or more. Not a movement: it is the balance before any transaction. */
    @Column({ type: 'int', default: 0 })
    openingBalance: number;
}

/** A name for a kind of expense. `code` stays put when the shop renames it. */
@Entity('bd_expense_head')
export class BdExpenseHead extends VendureEntity {
    constructor(input?: DeepPartial<BdExpenseHead>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 40 })
    code: string;

    @Column({ type: 'varchar', length: 80 })
    nameBn: string;

    @Column({ type: 'varchar', length: 80 })
    nameEn: string;
}

/** Money spent that is not a purchase. It leaves `account` and counts on the profit and loss. */
@Entity('bd_expense')
export class BdExpense extends VendureEntity {
    constructor(input?: DeepPartial<BdExpense>) {
        super(input);
    }

    /** The Dhaka calendar day, YYYY-MM-DD. */
    @Column({ type: 'varchar', length: 10 })
    day: string;

    @Index()
    @Column({ type: 'int' })
    headId: number;

    @Column({ type: 'int' })
    amount: number;

    @Index()
    @Column({ type: 'int' })
    accountId: number;

    @Column({ type: 'varchar', length: 1000, default: '' })
    note: string;

    @Column({ type: 'int', nullable: true })
    receiptAssetId: number | null;
}

/**
 * One movement in or out of an account.
 * A transfer is two rows with the same `transferId`. Those rows are not profit or loss.
 */
@Entity('bd_transaction')
export class BdTransaction extends VendureEntity {
    constructor(input?: DeepPartial<BdTransaction>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    accountId: number;

    /** `in` or `out`. */
    @Column({ type: 'varchar', length: 8 })
    direction: string;

    @Column({ type: 'int' })
    amount: number;

    /** The Dhaka calendar day, YYYY-MM-DD. */
    @Index()
    @Column({ type: 'varchar', length: 10 })
    day: string;

    /** order, purchase, expense, transfer or manual. */
    @Column({ type: 'varchar', length: 16 })
    source: string;

    @Column({ type: 'varchar', length: 40, nullable: true })
    sourceId: string | null;

    @Column({ type: 'varchar', length: 500, default: '' })
    note: string;

    @Column({ type: 'varchar', length: 40, nullable: true })
    transferId: string | null;

    /** Stops a settled payment or a purchase payment being counted twice. */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 80, nullable: true })
    idempotencyKey: string | null;
}
