import { type DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type BdImageStatus = 'pending' | 'ready' | 'failed';

/** One WebP size on disk: `<IMAGES_DIR>/<hash>/<size>.webp`. */
export interface BdImageVariantRecord {
    size: number;
    width: number;
    height: number;
    bytes: number;
}

/**
 * One picture, by content hash, shared by every asset showing it (`Asset.customFields.bdImage`),
 * so its WebP sizes are stored once (roadmap phase 09).
 */
@Entity('bd_image')
export class BdImage extends VendureEntity {
    constructor(input?: DeepPartial<BdImage>) {
        super(input);
    }

    /** SHA-256 of the cleaned image. The unique index makes two uploads at once share one row. */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 64 })
    hash: string;

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: BdImageStatus;

    /** Why processing failed (an error code such as ENOSPC), for staff. */
    @Column({ type: 'varchar', length: 200, nullable: true })
    failure: string | null;

    @Column({ type: 'int', default: 0 })
    width: number;

    @Column({ type: 'int', default: 0 })
    height: number;

    @Column({ type: 'boolean', default: false })
    animated: boolean;

    @Column({ type: 'simple-json', nullable: true })
    variants: BdImageVariantRecord[] | null;

    /** Total bytes of the WebP sizes. */
    @Column({ type: 'int', default: 0 })
    bytes: number;

    @Column({ type: 'varchar', length: 7, nullable: true })
    dominantColor: string | null;

    @Column({ type: 'text', nullable: true })
    placeholder: string | null;

    /** When no asset used this image any more; its files are deleted 7 days later. */
    @Column({ type: 'timestamp', nullable: true })
    orphanedAt: Date | null;
}
