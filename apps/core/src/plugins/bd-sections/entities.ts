import type { LayoutDocument, LayoutType } from '@ecommbd/sections';
import { type DeepPartial, EntityId, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BdPage } from '../bd-content/entities';

/**
 * A page's sections (roadmap phase 15): one row for the home page (`home`), one for the product
 * page template (`product`) and one per phase 12 page (`page:<id>`). The draft is autosaved; a
 * publish copies it to `published` with a new version stamp.
 */
@Entity('bd_page_layout')
export class BdPageLayout extends VendureEntity {
    constructor(input?: DeepPartial<BdPageLayout>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    type: LayoutType;

    /** `home`, `product` or `page:<id>`: one layout each. */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 60 })
    key: string;

    @ManyToOne(() => BdPage, { nullable: true, onDelete: 'CASCADE' })
    page: BdPage | null;

    @EntityId({ nullable: true })
    pageId: ID | null;

    @Column({ type: 'jsonb' })
    draft: LayoutDocument;

    /** Raised by every draft save; a save from an older revision is a conflict. */
    @Column({ type: 'int', default: 0 })
    draftRevision: number;

    @Column({ type: 'timestamp', nullable: true })
    draftSavedAt: Date | null;

    @Column({ type: 'varchar', length: 120, default: '' })
    draftSavedBy: string;

    @Column({ type: 'jsonb', nullable: true })
    published: LayoutDocument | null;

    /** 0 until first published; a publish from an older version is a conflict. */
    @Column({ type: 'int', default: 0 })
    publishedVersion: number;

    @Column({ type: 'timestamp', nullable: true })
    publishedAt: Date | null;

    @Column({ type: 'varchar', length: 120, default: '' })
    publishedBy: string;
}

/** The last published versions of a layout, for one-click restore. */
@Entity('bd_page_layout_version')
@Index(['layoutId', 'version'], { unique: true })
export class BdPageLayoutVersion extends VendureEntity {
    constructor(input?: DeepPartial<BdPageLayoutVersion>) {
        super(input);
    }

    @ManyToOne(() => BdPageLayout, { onDelete: 'CASCADE' })
    layout: BdPageLayout;

    @EntityId()
    layoutId: ID;

    @Column({ type: 'int' })
    version: number;

    @Column({ type: 'jsonb' })
    document: LayoutDocument;

    @Column({ type: 'timestamp' })
    publishedAt: Date;

    @Column({ type: 'varchar', length: 120, default: '' })
    publishedBy: string;
}

/** A styled section saved for reuse on other pages. */
@Entity('bd_saved_section')
export class BdSavedSection extends VendureEntity {
    constructor(input?: DeepPartial<BdSavedSection>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 80 })
    name: string;

    @Column({ type: 'jsonb' })
    section: LayoutDocument['sections'][number];

    @Column({ type: 'varchar', length: 120, default: '' })
    createdBy: string;
}
