import {
    BRAND_FACET_CODE,
    BRAND_LIMITS,
    type BrandInput,
    cleanText,
    parseBrandInput,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Asset,
    ConfigService,
    Facet,
    FacetService,
    FacetValue,
    FacetValueService,
    type ID,
    LanguageCode,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { assetUrl } from '../bd-catalog/asset-url';

export interface AdminBrand {
    id: ID;
    code: string;
    name: { bn: string; en: string };
    description: { bn: string; en: string };
    logoAssetId: ID | null;
    logoPreview: string | null;
    productCount: number;
}

export interface ShopBrand {
    id: ID;
    code: string;
    name: string;
    description: string;
    logo: Asset | null;
}

type Saved = { brand: AdminBrand; errors: [] } | { brand: null; errors: SettingsFieldError[] };

/**
 * Brands (phase 55) are values of one public facet, `brand`, so the storefront search already
 * offers them as a filter with counts, and a product's brand travels with its facet values.
 * This service adds what a plain facet value lacks for merchants: Bangla and English names,
 * a logo and a description, and a delete that leaves the products working without a brand.
 */
@Injectable()
export class BrandService {
    constructor(
        private connection: TransactionalConnection,
        private facets: FacetService,
        private facetValues: FacetValueService,
        private config: ConfigService,
    ) {}

    /** The brand facet, created on first use (also by the store-defaults step). */
    async facet(ctx: RequestContext): Promise<Facet> {
        const found = await this.connection.getRepository(ctx, Facet).findOne({ where: { code: BRAND_FACET_CODE } });
        if (found) return found;
        const created = await this.facets.create(ctx, {
            code: BRAND_FACET_CODE,
            isPrivate: false,
            translations: [
                { languageCode: LanguageCode.bn, name: 'ব্র্যান্ড' },
                { languageCode: LanguageCode.en, name: 'Brand' },
            ],
        });
        return this.connection.getRepository(ctx, Facet).findOneOrFail({ where: { id: created.id } });
    }

    async list(ctx: RequestContext, search?: string | null): Promise<AdminBrand[]> {
        const rows = await this.rows(ctx);
        const term = cleanText(search ?? '').toLowerCase();
        const filtered = term
            ? rows.filter(
                  row =>
                      row.code.includes(term) ||
                      row.translations.some(translation => translation.name.toLowerCase().includes(term)),
              )
            : rows;
        const counts = await this.counts(ctx, filtered.map(row => row.id));
        return filtered.map(row => this.admin(ctx, row, counts.get(String(row.id)) ?? 0));
    }

    async one(ctx: RequestContext, id: ID): Promise<AdminBrand | null> {
        const row = (await this.rows(ctx, { id }))[0];
        if (!row) return null;
        const counts = await this.counts(ctx, [row.id]);
        return this.admin(ctx, row, counts.get(String(row.id)) ?? 0);
    }

    async save(ctx: RequestContext, input: unknown): Promise<Saved> {
        const parsed = parseBrandInput(input);
        if (!parsed.ok) return { brand: null, errors: parsed.errors };
        const brand = parsed.brand;
        const id = await this.connection.withTransaction(ctx, tx => this.write(tx, brand));
        if (typeof id === 'object') return { brand: null, errors: [id] };
        return { brand: (await this.one(ctx, id))!, errors: [] };
    }

    /** Deletes the brand. `force` takes it off its products first, so they keep working with no brand. */
    async delete(ctx: RequestContext, id: ID): Promise<boolean> {
        const row = (await this.rows(ctx, { id }))[0];
        if (!row) throw new UserInputError('message.bd-brands.missing');
        const result = await this.facetValues.delete(ctx, row.id, true);
        return result.result === 'DELETED';
    }

    /**
     * The brand with this code, created with `name` (in both languages) when there is none.
     * Used by the WooCommerce import, where a brand arrives as a name and a slug.
     */
    async ensure(ctx: RequestContext, input: { name: string; code: string }): Promise<ID> {
        const existing = (await this.rows(ctx, { code: input.code }))[0];
        if (existing) return existing.id;
        const parsed = parseBrandInput({ name: { bn: input.name, en: input.name }, code: input.code });
        if (!parsed.ok) throw new UserInputError('message.bd-brands.missing');
        const id = await this.write(ctx, parsed.brand);
        if (typeof id === 'object') throw new UserInputError('message.bd-brands.missing');
        return id;
    }

    /** For the brand's page. Null when there is no such brand. */
    async byCode(ctx: RequestContext, code: string): Promise<ShopBrand | null> {
        const clean = cleanText(code).toLowerCase().slice(0, BRAND_LIMITS.code);
        if (!clean) return null;
        const row = (await this.rows(ctx, { code: clean }))[0];
        return row ? this.shop(ctx, row) : null;
    }

    /** Brands with at least one product on sale (a page for the sitemap). */
    async onSale(ctx: RequestContext): Promise<ShopBrand[]> {
        const rows = await this.rows(ctx);
        if (!rows.length) return [];
        const used: Array<{ id: string }> = await this.connection.getRepository(ctx, FacetValue).query(
            `SELECT DISTINCT pf."facetValueId"::text AS id
             FROM product_facet_values_facet_value pf
             JOIN product p ON p.id = pf."productId"
             WHERE p."deletedAt" IS NULL AND p.enabled = true AND pf."facetValueId" = ANY($1)`,
            [rows.map(row => row.id)],
        );
        const ids = new Set(used.map(row => row.id));
        return rows.filter(row => ids.has(String(row.id))).map(row => this.shop(ctx, row));
    }

    private async write(ctx: RequestContext, brand: BrandInput): Promise<ID | SettingsFieldError> {
        const facet = await this.facet(ctx);
        const existing = brand.id ? (await this.rows(ctx, { id: brand.id }))[0] : undefined;
        if (brand.id && !existing) return { path: 'id', code: 'notFound' };
        if (brand.logoAssetId) {
            const asset = await this.connection.getRepository(ctx, Asset).findOne({ where: { id: brand.logoAssetId } });
            if (!asset) return { path: 'logoAssetId', code: 'notFound' };
        }
        // A Bangla-only brand has no English name to make an address from.
        const code = brand.code || existing?.code || `brand-${Date.now().toString(36)}`;
        const taken = await this.connection.getRepository(ctx, FacetValue).findOne({
            where: { code, facet: { id: facet.id } },
        });
        if (taken && String(taken.id) !== String(existing?.id ?? '')) return { path: 'code', code: 'taken' };
        const translations = (['bn', 'en'] as const)
            .filter(language => brand.name[language] || (language === 'bn' && !brand.name.en))
            .map(language => ({
                languageCode: LanguageCode[language],
                name: brand.name[language] || brand.name.bn || brand.name.en,
                customFields: { description: brand.description[language] || null },
            }));
        const customFields = { logoId: brand.logoAssetId };
        if (existing) {
            await this.facetValues.update(ctx, { id: existing.id, code, translations, customFields });
            return existing.id;
        }
        const created = await this.facetValues.create(ctx, facet, { code, translations, customFields });
        return created.id;
    }

    private async rows(ctx: RequestContext, where: { id?: ID; code?: string } = {}): Promise<FacetValue[]> {
        return this.connection.getRepository(ctx, FacetValue).find({
            where: { ...where, facet: { code: BRAND_FACET_CODE } },
            relations: { facet: true, translations: true, customFields: { logo: true } } as never,
            order: { code: 'ASC' },
            take: BRAND_LIMITS.brands,
        });
    }

    private async counts(ctx: RequestContext, ids: ID[]): Promise<Map<string, number>> {
        if (!ids.length) return new Map();
        const rows: Array<{ id: string; count: string }> = await this.connection
            .getRepository(ctx, FacetValue)
            .query(
                `SELECT pf."facetValueId"::text AS id, COUNT(*)::text AS count
                 FROM product_facet_values_facet_value pf
                 JOIN product p ON p.id = pf."productId"
                 WHERE p."deletedAt" IS NULL AND pf."facetValueId" = ANY($1)
                 GROUP BY pf."facetValueId"`,
                [ids],
            );
        return new Map(rows.map(row => [row.id, Number(row.count)]));
    }

    private text(row: FacetValue, language: 'bn' | 'en', field: 'name' | 'description'): string {
        const translation = row.translations.find(item => item.languageCode === language);
        const value =
            field === 'name'
                ? translation?.name
                : (translation?.customFields as { description?: string | null } | undefined)?.description;
        return value ?? '';
    }

    private admin(ctx: RequestContext, row: FacetValue, productCount: number): AdminBrand {
        const logo = row.customFields.logo ?? null;
        return {
            id: row.id,
            code: row.code,
            name: { bn: this.text(row, 'bn', 'name'), en: this.text(row, 'en', 'name') },
            description: { bn: this.text(row, 'bn', 'description'), en: this.text(row, 'en', 'description') },
            logoAssetId: logo?.id ?? null,
            logoPreview: assetUrl(this.config, ctx, logo?.preview),
            productCount,
        };
    }

    private shop(ctx: RequestContext, row: FacetValue): ShopBrand {
        const language = ctx.languageCode === 'en' ? 'en' : 'bn';
        const other = language === 'en' ? 'bn' : 'en';
        return {
            id: row.id,
            code: row.code,
            name: this.text(row, language, 'name') || this.text(row, other, 'name'),
            description: this.text(row, language, 'description') || this.text(row, other, 'description'),
            logo: row.customFields.logo ?? null,
        };
    }
}
