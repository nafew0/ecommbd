import { type DeepPartial, EntityId, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

export type ContentLanguage = 'bn' | 'en';

/** A simple storefront page (About us, Size guide…). Section-based pages come in phase 15. */
@Entity('bd_page')
export class BdPage extends VendureEntity {
    constructor(input?: DeepPartial<BdPage>) {
        super(input);
    }

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    /** One per language that has a title. */
    @OneToMany(() => BdPageTranslation, translation => translation.page, { eager: true, cascade: true })
    translations: BdPageTranslation[];
}

@Entity('bd_page_translation')
@Index(['languageCode', 'slug'], { unique: true })
export class BdPageTranslation extends VendureEntity {
    constructor(input?: DeepPartial<BdPageTranslation>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 8 })
    languageCode: ContentLanguage;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    /** As Vendure stores slugs: NFD (see `toSlug`). */
    @Column({ type: 'varchar', length: 255 })
    slug: string;

    /** Sanitized HTML, or plain text with line breaks. */
    @Column({ type: 'text' })
    body: string;

    @Column({ type: 'varchar', length: 255, default: '' })
    seoTitle: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    seoDescription: string;

    @ManyToOne(() => BdPage, page => page.translations, { onDelete: 'CASCADE' })
    page: BdPage;

    @EntityId()
    pageId: ID;
}

export type SlugEntityType = 'product' | 'collection' | 'page';

/**
 * Every slug a product, category or page has had, per language. An old slug redirects to the
 * current one; the slugs of a deleted product answer 410 Gone.
 */
@Entity('bd_slug')
@Index(['entityType', 'languageCode', 'slug'], { unique: true })
@Index(['entityType', 'entityId'])
export class BdSlug extends VendureEntity {
    constructor(input?: DeepPartial<BdSlug>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    entityType: SlugEntityType;

    @Column({ type: 'varchar', length: 40 })
    entityId: string;

    @Column({ type: 'varchar', length: 8 })
    languageCode: string;

    @Column({ type: 'varchar', length: 255 })
    slug: string;

    /** The entity's slug now, in this language. */
    @Column({ type: 'boolean', default: true })
    current: boolean;

    /** The entity was deleted: its URLs are gone (410). */
    @Column({ type: 'timestamp', nullable: true })
    deletedAt: Date | null;
}
