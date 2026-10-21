import { Injectable } from '@nestjs/common';
import { type ID, TransactionalConnection } from '@vendure/core';
import { Not } from 'typeorm';
import { BdSlug, type SlugEntityType } from './entities';

export interface SlugTranslation {
    languageCode: string;
    slug: string;
}

export type SlugLookup = { status: 'moved'; slug: string } | { status: 'gone'; slug: null };

/**
 * Slug history (roadmap phase 12). Writes use the raw connection: they run from events after the
 * change has committed, and from our own saves just after them.
 */
@Injectable()
export class SlugHistoryService {
    constructor(private connection: TransactionalConnection) {}

    private get repo() {
        return this.connection.rawConnection.getRepository(BdSlug);
    }

    /** Records an entity's current slugs; its earlier slugs become redirects to them. */
    async record(entityType: SlugEntityType, entityId: ID, translations: SlugTranslation[]) {
        const id = String(entityId);
        const current = translations.filter(translation => translation.slug);
        for (const { languageCode, slug } of current) {
            await this.repo.update(
                { entityType, entityId: id, languageCode, slug: Not(slug) },
                { current: false },
            );
            // A slug used before by another entity now belongs to this one.
            await this.repo
                .createQueryBuilder()
                .insert()
                .values({ entityType, entityId: id, languageCode, slug, current: true, deletedAt: null })
                .orUpdate(
                    ['entityId', 'current', 'deletedAt', 'updatedAt'],
                    ['entityType', 'languageCode', 'slug'],
                )
                .updateEntity(false)
                .execute();
        }
        const languages = current.map(translation => translation.languageCode);
        const others = await this.repo.find({ where: { entityType, entityId: id, current: true } });
        for (const row of others.filter(row => !languages.includes(row.languageCode))) {
            await this.repo.update(row.id, { current: false });
        }
    }

    /** The entity was deleted: its URLs answer 410 Gone. */
    async markDeleted(entityType: SlugEntityType, entityId: ID) {
        await this.repo.update({ entityType, entityId: String(entityId) }, { deletedAt: new Date() });
    }

    /**
     * What an unknown slug means: `moved` (to the entity's current slug in this language, or any
     * language) or `gone`. Null when we know nothing, or when it is already the current slug (the
     * entity is then disabled: a plain 404).
     */
    async lookup(entityType: SlugEntityType, slug: string, languageCode: string): Promise<SlugLookup | null> {
        const rows = await this.repo.find({ where: { entityType, slug } });
        const row = rows.find(candidate => candidate.languageCode === languageCode) ?? rows[0];
        if (!row) return null;
        if (row.deletedAt) return { status: 'gone', slug: null };
        if (row.current) return null;
        const currentRows = await this.repo.find({
            where: { entityType, entityId: row.entityId, current: true },
        });
        const target =
            currentRows.find(candidate => candidate.languageCode === languageCode) ?? currentRows[0];
        return target && target.slug !== slug ? { status: 'moved', slug: target.slug } : null;
    }
}
