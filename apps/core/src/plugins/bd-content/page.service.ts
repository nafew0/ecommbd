import { looksLikeHtml, parsePageInput, type SettingsFieldError, sanitizeRichText } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { type ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { In, Not } from 'typeorm';
import { CONTENT_LANGUAGES } from './constants';
import { BdPage, BdPageTranslation } from './entities';
import { SlugHistoryService } from './slug.service';

export type SavePageResult = { page: BdPage; errors: [] } | { page: null; errors: SettingsFieldError[] };

/** Storefront pages (roadmap phase 12): saved sanitized, with their slugs recorded for redirects. */
@Injectable()
export class PageService {
    constructor(
        private connection: TransactionalConnection,
        private slugs: SlugHistoryService,
    ) {}

    async list(ctx: RequestContext, options: { skip?: number; take?: number } = {}) {
        const [items, totalItems] = await this.connection.getRepository(ctx, BdPage).findAndCount({
            order: { updatedAt: 'DESC' },
            skip: options.skip ?? 0,
            take: Math.min(options.take ?? 50, 100),
        });
        return { items, totalItems };
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, BdPage).findOne({ where: { id } });
    }

    /** Enabled pages, for the storefront's sitemap. */
    listEnabled(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, BdPage)
            .find({ where: { enabled: true }, order: { id: 'ASC' } });
    }

    /** An enabled page with this slug in any language (the storefront picks the language). */
    async findBySlug(ctx: RequestContext, slug: string): Promise<BdPage | null> {
        const translation = await this.connection
            .getRepository(ctx, BdPageTranslation)
            .findOne({ where: { slug: slug.normalize('NFD') } });
        if (!translation) return null;
        return this.connection
            .getRepository(ctx, BdPage)
            .findOne({ where: { id: translation.pageId, enabled: true } });
    }

    async save(ctx: RequestContext, id: ID | undefined, input: unknown): Promise<SavePageResult> {
        const parsed = parsePageInput(input);
        if (!parsed.ok) return { page: null, errors: parsed.errors };
        const repo = this.connection.getRepository(ctx, BdPage);
        const existing = id !== undefined ? await this.findOne(ctx, id) : null;
        if (id !== undefined && !existing) {
            return { page: null, errors: [{ path: 'id', code: 'notFound' }] };
        }
        const wanted = CONTENT_LANGUAGES.map(languageCode => ({
            languageCode,
            ...parsed.value.translations[languageCode],
        })).filter(translation => translation.title);

        const errors: SettingsFieldError[] = [];
        for (const translation of wanted) {
            const clash = await this.connection.getRepository(ctx, BdPageTranslation).findOne({
                where: {
                    languageCode: translation.languageCode,
                    slug: translation.slug,
                    ...(existing ? { pageId: Not(existing.id) } : {}),
                },
            });
            if (clash) errors.push({ path: `translations.${translation.languageCode}.slug`, code: 'taken' });
        }
        if (errors.length) return { page: null, errors };

        const page = existing ?? new BdPage({ translations: [] });
        page.enabled = parsed.value.enabled;
        const saved = await repo.save(page);
        const translations = this.connection.getRepository(ctx, BdPageTranslation);
        await translations.delete({
            pageId: saved.id,
            languageCode: Not(In(wanted.map(translation => translation.languageCode))),
        });
        for (const translation of wanted) {
            const row =
                saved.translations?.find(candidate => candidate.languageCode === translation.languageCode) ??
                new BdPageTranslation({ languageCode: translation.languageCode, page: saved });
            row.title = translation.title;
            row.slug = translation.slug;
            row.body = looksLikeHtml(translation.body)
                ? sanitizeRichText(translation.body)
                : translation.body.trim();
            row.seoTitle = translation.seoTitle;
            row.seoDescription = translation.seoDescription;
            await translations.save(row);
        }
        await this.slugs.record('page', saved.id, wanted);
        return { page: (await this.findOne(ctx, saved.id))!, errors: [] };
    }

    /** Deletes a page; its URLs then answer 410 Gone. */
    async delete(ctx: RequestContext, id: ID): Promise<boolean> {
        const page = await this.findOne(ctx, id);
        if (!page) return false;
        await this.connection.getRepository(ctx, BdPage).delete(page.id);
        await this.slugs.markDeleted('page', page.id);
        return true;
    }
}
