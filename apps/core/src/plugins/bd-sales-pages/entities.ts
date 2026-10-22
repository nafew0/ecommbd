import type { SalesPageSettings } from '@ecommbd/sections';
import { type DeepPartial, EntityId, type ID, Product, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

/**
 * A sales page (roadmap phase 16): an ad landing page for one product at `/s/<slug>/`, with its own
 * settings (header, colours, packs, the add-on offer, thank-you) next to its sections, which live in
 * phase 15's layouts as `landing:<id>`.
 */
@Entity('bd_sales_page')
export class BdSalesPage extends VendureEntity {
    constructor(input?: DeepPartial<BdSalesPage>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 150 })
    title: string;

    /** The address: `/s/<slug>/`. NFC; Bangla is fine. */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 80 })
    slug: string;

    /** The template it was made from (`ghee-honey`…), for the list. */
    @Column({ type: 'varchar', length: 40, default: '' })
    template: string;

    /** When the product is deleted the page stays, inactive, with a warning in the list. */
    @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
    product: Product | null;

    @EntityId({ nullable: true })
    productId: ID | null;

    /** SalesPageSettings from @ecommbd/sections; the add-on's variant ID as stored. */
    @Column({ type: 'jsonb' })
    settings: SalesPageSettings;

    /** Switched off by the merchant (or when its product goes): the address shows "not found". */
    @Column({ type: 'boolean', default: true })
    active: boolean;

    @Column({ type: 'varchar', length: 120, default: '' })
    createdBy: string;
}
