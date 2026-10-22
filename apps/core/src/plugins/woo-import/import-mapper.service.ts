import { getDistricts, getThanas } from '@ecommbd/bd-geo';
import { createHttpClient, isPlaceholderEmail, placeholderEmailFor, stripShortcodes } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Address,
    AssetService,
    ChannelService,
    CollectionService,
    Collection,
    Country,
    Customer,
    FacetService,
    ProductTranslation,
    CollectionTranslation,
    FacetValueService,
    ID,
    isGraphQlErrorResult,
    LanguageCode,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevel,
    StockLevelService,
    StockLocationService,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull } from 'typeorm';
import sharp from 'sharp';
import { BdImageService } from '../bd-images';
import { LegacyOrder, WooIssue, WooMapping, WooRun, WooSource } from './entities';
import {
    arrays,
    catalogPrice,
    digest,
    gmt,
    minor,
    pathOf,
    phoneOf,
    recordPhone,
    safeDescription,
    text,
    WooRecord,
} from './helpers';

// ISO subdivision codes used by WooCommerce are NOT the BBS district codes in bd-geo.
// Names from WooCommerce i18n/states.php, matched against our maintained aliases.
const WC_DISTRICTS = [
    'Bandarban',
    'Barguna',
    'Bogura',
    'Brahmanbaria',
    'Bagerhat',
    'Barishal',
    'Bhola',
    'Cumilla',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Chuadanga',
    'Dhaka',
    'Dinajpur',
    'Faridpur',
    'Feni',
    'Gopalganj',
    'Gazipur',
    'Gaibandha',
    'Habiganj',
    'Jamalpur',
    'Jashore',
    'Jhenaidah',
    'Joypurhat',
    'Jhalokati',
    'Kishoreganj',
    'Khulna',
    'Kurigram',
    'Khagrachhari',
    'Kushtia',
    'Lakshmipur',
    'Lalmonirhat',
    'Manikganj',
    'Mymensingh',
    'Munshiganj',
    'Madaripur',
    'Magura',
    'Moulvibazar',
    'Meherpur',
    'Narayanganj',
    'Netrakona',
    'Narsingdi',
    'Narail',
    'Natore',
    'Nawabganj',
    'Nilphamari',
    'Noakhali',
    'Naogaon',
    'Pabna',
    'Pirojpur',
    'Patuakhali',
    'Panchagarh',
    'Rajbari',
    'Rajshahi',
    'Rangpur',
    'Rangamati',
    'Sherpur',
    'Satkhira',
    'Sirajganj',
    'Sylhet',
    'Sunamganj',
    'Shariatpur',
    'Tangail',
    'Thakurgaon',
];
const nameKey = (value: string) =>
    value
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
export function mapWooAddress(row: WooRecord) {
    const state = text(row.state);
    const stateName = /^BD-\d\d$/.test(state) ? WC_DISTRICTS[Number(state.slice(3)) - 1] : state;
    const district = getDistricts().find(d =>
        [d.en, d.bn, ...d.aliases].some(n => nameKey(n) === nameKey(stateName ?? '')),
    );
    const city = text(row.city);
    const candidates = district
        ? getThanas(district.id).filter(t =>
              [t.en, t.bn, ...t.aliases].some(n => nameKey(n) === nameKey(city)),
          )
        : [];
    return {
        fullName: text(`${row.first_name ?? ''} ${row.last_name ?? ''}`, 100),
        streetLine1: text(row.address_1, 500),
        streetLine2: text(row.address_2, 500),
        city: candidates.length === 1 ? candidates[0].en : city,
        province: district?.en ?? state,
        postalCode: text(row.postcode, 30),
        countryCode: text(row.country, 2) || 'BD',
        phoneNumber: phoneOf(row.phone),
        customFields: district
            ? {
                  districtId: district.id,
                  thanaId: candidates.length === 1 ? candidates[0].id : 'other',
                  area: city || text(row.address_1, 100) || district.en,
              }
            : {},
        resolved: !!district && candidates.length === 1,
    };
}

@Injectable()
export class ImportMapperService {
    constructor(
        private connection: TransactionalConnection,
        private products: ProductService,
        private variants: ProductVariantService,
        private groups: ProductOptionGroupService,
        private options: ProductOptionService,
        private facets: FacetService,
        private facetValues: FacetValueService,
        private collections: CollectionService,
        private assets: AssetService,
        private images: BdImageService,
        private channels: ChannelService,
        private stock: StockLevelService,
        private locations: StockLocationService,
    ) {}

    async issue(
        ctx: RequestContext,
        run: WooRun,
        kind: string,
        key: string,
        code: string,
        severity = 'warning',
    ) {
        const repo = this.connection.getRepository(ctx, WooIssue);
        if (
            !(await repo.exists({
                where: { runId: Number(run.id), kind, sourceKey: key.slice(0, 100), code },
            }))
        ) {
            await repo.save(
                new WooIssue({ runId: Number(run.id), kind, sourceKey: key.slice(0, 100), code, severity }),
            );
        }
    }
    mapping(ctx: RequestContext, source: WooSource, kind: string, key: string) {
        return this.connection
            .getRepository(ctx, WooMapping)
            .findOneBy({ sourceId: Number(source.id), kind, sourceKey: key });
    }
    async remember(
        ctx: RequestContext,
        source: WooSource,
        kind: string,
        key: string,
        targetId: ID | null,
        row: unknown,
        metadata: Record<string, unknown> = {},
    ) {
        const repo = this.connection.getRepository(ctx, WooMapping);
        const current = await this.mapping(ctx, source, kind, key);
        return repo.save(
            new WooMapping({
                ...current,
                sourceId: Number(source.id),
                kind,
                sourceKey: key,
                targetId: targetId == null ? null : String(targetId),
                digest: digest(row),
                metadata: metadata as never,
            }),
        );
    }

    async inspectRecord(ctx: RequestContext, source: WooSource, run: WooRun, kind: string, row: WooRecord) {
        const key = String(row.id);
        if (kind === 'products') {
            if (source.settings.currency !== 'BDT') throw new Error('SOURCE_CATALOG_CURRENCY_NOT_BDT');
            if (!['simple', 'variable'].includes(row.type) || row.virtual || row.downloadable)
                await this.issue(ctx, run, kind, key, 'UNSUPPORTED_PRODUCT_TYPE');
            const stripped = stripShortcodes(text(row.description, 500_000));
            if (stripped.removed.length) await this.issue(ctx, run, kind, key, 'BUILDER_SHORTCODES');
            if (row.type === 'variable' && row.manage_stock)
                await this.issue(ctx, run, kind, key, 'SHARED_PARENT_STOCK_REQUIRES_REVIEW', 'error');
            for (const image of arrays(row.images)) {
                try {
                    const host = new URL(image.src).hostname.toLowerCase();
                    if (!source.imageHosts.includes(host))
                        await this.issue(
                            ctx,
                            run,
                            'imageHosts',
                            host.slice(0, 100),
                            'IMAGE_HOST_NOT_APPROVED',
                        );
                } catch {
                    await this.issue(ctx, run, kind, key, 'INVALID_IMAGE_URL');
                }
            }
            if (row.type === 'simple') catalogPrice(row.price);
            for (const variant of arrays(row._variations)) catalogPrice(variant.price);
            if (arrays(row.images).length > 100 || text(row.description, 500_001).length > 500_000)
                await this.issue(ctx, run, kind, key, 'SOURCE_CONTENT_LIMIT_REQUIRES_REVIEW', 'error');
            if (row.dimensions && Object.values(row.dimensions).some(Boolean))
                await this.issue(ctx, run, kind, key, 'DIMENSIONS_RETAINED_IN_MAPPING');
            if (row.catalog_visibility === 'hidden')
                await this.issue(ctx, run, kind, key, 'HIDDEN_PRODUCT_IMPORTED_DISABLED');
            const skus = [row, ...arrays(row._variations)].filter(v => text(v.sku));
            for (const variant of skus) {
                const sku = text(variant.sku, 255);
                const seen = await this.mapping(ctx, source, `drySku${run.id}`, digest(sku));
                if (seen && seen.metadata.productId !== String(row.id))
                    await this.issue(ctx, run, kind, key, 'DUPLICATE_SKU_IN_SOURCE');
                if (run.mode === 'dryRun')
                    await this.remember(
                        ctx,
                        source,
                        `drySku${run.id}`,
                        digest(sku),
                        null,
                        {},
                        { productId: String(row.id) },
                    );
            }
        }
        if (kind === 'customers' || kind === 'orders') {
            const address = row.shipping?.address_1 ? row.shipping : (row.billing ?? {});
            if (!mapWooAddress(address).resolved)
                await this.issue(ctx, run, kind, key, 'ADDRESS_NEEDS_REVIEW');
            if (!recordPhone(row)) await this.issue(ctx, run, kind, key, 'PHONE_MISSING_OR_AMBIGUOUS');
        }
        if (kind === 'orders') {
            minor(row.total);
            if (row.currency !== 'BDT') await this.issue(ctx, run, kind, key, 'FOREIGN_CURRENCY_PRESERVED');
        }
    }

    async apply(ctx: RequestContext, source: WooSource, run: WooRun, kind: string, row: WooRecord) {
        const current = await this.mapping(ctx, source, kind, String(row.id));
        if (current?.digest === digest(row) && !current.metadata.retryMedia) return 'unchanged';
        if (kind === 'categories') await this.category(ctx, source, row);
        else if (kind === 'tags') await this.tag(ctx, source, row);
        else if (kind === 'products') await this.product(ctx, source, run, row);
        else if (kind === 'customers') await this.customer(ctx, source, run, row);
        else if (kind === 'orders') await this.order(ctx, source, run, row);
        return 'written';
    }

    private translations<T extends object = Record<never, never>>(name: unknown, extra: T = {} as T) {
        return [LanguageCode.bn, LanguageCode.en].map(languageCode => ({
            languageCode,
            name: text(name, 255),
            ...extra,
        }));
    }
    private async category(ctx: RequestContext, source: WooSource, row: WooRecord) {
        const old = await this.mapping(ctx, source, 'categories', String(row.id));
        const conflict = await this.connection.getRepository(ctx, CollectionTranslation).findOne({
            where: { slug: text(row.slug, 255).normalize('NFD'), languageCode: LanguageCode.bn },
            relations: { base: true },
        });
        if (conflict && String(conflict.base.id) !== old?.targetId) throw new Error('CATEGORY_SLUG_CONFLICT');
        const input = {
            isPrivate: false,
            translations: this.translations(row.name, {
                slug: text(row.slug, 255),
                description: safeDescription(row.description),
            }),
            customFields: { bdCategory: true },
        };
        const category = old?.targetId
            ? await this.collections.update(ctx, { id: Number(old.targetId), ...input })
            : await this.collections.create(ctx, { ...input, filters: [] });
        await this.remember(ctx, source, 'categories', String(row.id), category.id, row, {
            parent: Number(row.parent) || 0,
            slug: text(row.slug, 255),
            sourcePath: pathOf(row.link, source.url),
        });
    }
    private async tag(ctx: RequestContext, source: WooSource, row: WooRecord) {
        const old = await this.mapping(ctx, source, 'tags', String(row.id));
        let facet = await this.mapping(ctx, source, 'facets', 'tags');
        if (!facet?.targetId) {
            const created = await this.facets.create(ctx, {
                isPrivate: false,
                code: `woo-${source.id}-tags`,
                translations: this.translations('Tags'),
            });
            facet = await this.remember(ctx, source, 'facets', 'tags', created.id, {});
        }
        const input = { code: `woo-${source.id}-tag-${row.id}`, translations: this.translations(row.name) };
        const value = old?.targetId
            ? await this.facetValues.update(ctx, { id: Number(old.targetId), ...input })
            : await this.facetValues.create(ctx, (await this.facets.findOne(ctx, facet.targetId!))!, input);
        await this.remember(ctx, source, 'tags', String(row.id), value.id, row);
    }

    private async attributeValue(
        ctx: RequestContext,
        source: WooSource,
        attribute: WooRecord,
        optionName: string,
    ) {
        const key = `attribute:${attribute.id}`;
        let mappedFacet = await this.mapping(ctx, source, 'facets', key);
        if (!mappedFacet?.targetId) {
            const facet = await this.facets.create(ctx, {
                isPrivate: false,
                code: `woo-${source.id}-attribute-${attribute.id}`,
                translations: this.translations(attribute.name),
            });
            mappedFacet = await this.remember(ctx, source, 'facets', key, facet.id, {});
        }
        const valueKey = `${key}:${digest(optionName).slice(0, 24)}`;
        let mappedValue = await this.mapping(ctx, source, 'facetValues', valueKey);
        if (!mappedValue?.targetId) {
            const facet = await this.facets.findOne(ctx, mappedFacet.targetId!);
            if (!facet) throw new Error('IMPORTED_FACET_MISSING');
            const value = await this.facetValues.create(ctx, facet, {
                code: `woo-${digest(`${source.id}:${valueKey}`).slice(0, 30)}`,
                translations: this.translations(optionName),
            });
            mappedValue = await this.remember(ctx, source, 'facetValues', valueKey, value.id, {});
        }
        return mappedValue.targetId!;
    }

    private async image(
        ctx: RequestContext,
        source: WooSource,
        run: WooRun,
        urlText: unknown,
    ): Promise<ID | undefined> {
        if (!urlText) return;
        const key = digest(String(urlText));
        const old = await this.mapping(ctx, source, 'images', key);
        if (old?.targetId) return old.targetId;
        const client = createHttpClient({
            maxResponseBytes: 15 * 1024 * 1024,
            maxRedirects: 0,
            maxRetries: 1,
        });
        try {
            let url = new URL(String(urlText));
            let response;
            for (let hop = 0; hop < 4; hop++) {
                if (url.protocol !== 'https:' || !source.imageHosts.includes(url.hostname.toLowerCase()))
                    throw new Error('IMAGE_HOST_NOT_APPROVED');
                response = await client.request(url);
                const location = response.headers.get('location');
                if ([301, 302, 303, 307, 308].includes(response.status) && location) {
                    url = new URL(location, url);
                    response = undefined;
                    continue;
                }
                break;
            }
            if (!response || response.status !== 200) throw new Error('IMAGE_DOWNLOAD_FAILED');
            const bytesHash = digest(response.body.toString('base64'));
            const byContent = await this.mapping(ctx, source, 'imageContent', bytesHash);
            if (byContent?.targetId) {
                await this.remember(ctx, source, 'images', key, byContent.targetId, {});
                return byContent.targetId;
            }
            const metadata = await sharp(response.body).metadata();
            const extension = metadata.format === 'heif' ? 'avif' : metadata.format;
            const asset = await this.images.createImageAsset(ctx, {
                data: response.body,
                fileName: `woo-${bytesHash}.${extension ?? 'bin'}`,
            });
            if (isGraphQlErrorResult(asset)) throw new Error('IMAGE_REJECTED');
            await this.remember(ctx, source, 'images', key, asset.id, {});
            await this.remember(ctx, source, 'imageContent', bytesHash, asset.id, {});
            return asset.id;
        } catch {
            run.verification.imageFailures = Number(run.verification.imageFailures ?? 0) + 1;
            await this.issue(ctx, run, 'images', key, 'IMAGE_FAILED_OR_UNAPPROVED');
            return;
        } finally {
            await client.close();
        }
    }
    private async description(ctx: RequestContext, source: WooSource, run: WooRun, value: unknown) {
        let html = text(value, 500_000);
        const urls = [
            ...new Set(
                [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]),
            ),
        ].slice(0, 100);
        for (const url of urls) {
            let assetId: ID | undefined;
            try {
                assetId = await this.image(ctx, source, run, new URL(url, source.url).href);
            } catch {
                await this.issue(ctx, run, 'images', digest(url), 'INVALID_IMAGE_URL');
            }
            if (assetId) {
                const asset = await this.assets.findOne(ctx, assetId);
                // Local preview paths are sanitized again on storefront rendering.
                if (asset) html = html.split(url).join(`/assets/${asset.preview}`);
            } else html = html.split(url).join('');
        }
        return safeDescription(html);
    }

    private async product(ctx: RequestContext, source: WooSource, run: WooRun, row: WooRecord) {
        const priorImageFailures = Number(run.verification.imageFailures ?? 0);
        if (!['simple', 'variable'].includes(row.type) || row.virtual || row.downloadable) {
            await this.remember(ctx, source, 'products', String(row.id), null, row, { skipped: true });
            return;
        }
        const old = await this.mapping(ctx, source, 'products', String(row.id));
        const conflict = await this.connection.getRepository(ctx, ProductTranslation).findOne({
            where: { slug: text(row.slug, 255).normalize('NFD'), languageCode: LanguageCode.bn },
            relations: { base: true },
        });
        if (conflict && String(conflict.base.id) !== old?.targetId) throw new Error('PRODUCT_SLUG_CONFLICT');
        const categoryIds = arrays(row.categories).map(c => String(c.id));
        const primary = categoryIds.length
            ? await this.mapping(ctx, source, 'categories', categoryIds[0])
            : null;
        const assetIds: ID[] = [];
        for (const image of arrays(row.images).slice(0, 100)) {
            const id = await this.image(ctx, source, run, image.src);
            if (id) assetIds.push(id);
        }
        const sharedStock = row.type === 'variable' && !!row.manage_stock;
        const taxReview =
            source.settings.pricesIncludeTax !== true &&
            source.settings.taxesEnabled !== false &&
            row.tax_status === 'taxable';
        if (taxReview)
            await this.issue(
                ctx,
                run,
                'products',
                String(row.id),
                'TAX_EXCLUSIVE_PRICE_REQUIRES_REVIEW',
                'error',
            );
        const input = {
            enabled:
                row.status === 'publish' && row.catalog_visibility !== 'hidden' && !sharedStock && !taxReview,
            featuredAssetId: assetIds[0],
            assetIds,
            translations: this.translations(row.name, {
                slug: text(row.slug, 255),
                description: await this.description(ctx, source, run, row.description),
                customFields: { shortDescription: safeDescription(row.short_description) },
            }),
            customFields: { featured: !!row.featured, categoryId: primary?.targetId ?? null },
        };
        const product = old?.targetId
            ? await this.products.update(ctx, { id: Number(old.targetId), ...input })
            : await this.products.create(ctx, input);
        const variations = row.type === 'variable' ? arrays(row._variations) : [row];
        if (!variations.length) throw new Error('VARIABLE_PRODUCT_HAS_NO_VARIATIONS');
        const groups = new Map<string, { id: ID; options: Map<string, ID> }>();
        for (const attribute of arrays(row.attributes).filter(a => a.variation)) {
            const key = `${row.id}:${attribute.id || nameKey(text(attribute.name))}`;
            let mapped = await this.mapping(ctx, source, 'optionGroups', key);
            if (!mapped?.targetId) {
                const group = await this.groups.create(ctx, {
                    code: `woo-${source.id}-${key}`,
                    translations: this.translations(attribute.name),
                });
                await this.products.addOptionGroupToProduct(ctx, product.id, group.id);
                mapped = await this.remember(ctx, source, 'optionGroups', key, group.id, {});
            }
            const optionIds = new Map<string, ID>();
            for (const name of attribute.options ?? []) {
                const optionKey = `${key}:${digest(name).slice(0, 16)}`;
                let mappedOption = await this.mapping(ctx, source, 'options', optionKey);
                if (!mappedOption?.targetId) {
                    const option = await this.options.create(ctx, mapped.targetId!, {
                        code: `woo-${digest(optionKey).slice(0, 24)}`,
                        translations: this.translations(name),
                    });
                    mappedOption = await this.remember(ctx, source, 'options', optionKey, option.id, {});
                }
                optionIds.set(nameKey(String(name)), mappedOption.targetId!);
            }
            groups.set(nameKey(text(attribute.name)), { id: mapped.targetId!, options: optionIds });
        }
        const tagIds: ID[] = [];
        for (const tag of arrays(row.tags)) {
            const mapped = await this.mapping(ctx, source, 'tags', String(tag.id));
            if (mapped?.targetId) tagIds.push(mapped.targetId);
        }
        const commonFacets: ID[] = [];
        for (const attribute of arrays(row.attributes).filter(a => a.id && !a.variation)) {
            for (const name of attribute.options ?? [])
                commonFacets.push(await this.attributeValue(ctx, source, attribute, String(name)));
        }
        const kept = new Set<string>();
        for (const variant of variations) {
            const key = row.type === 'simple' ? `product:${row.id}` : `variation:${variant.id}`;
            const mapped = await this.mapping(ctx, source, 'variants', key);
            const selection: ID[] = [];
            let wildcard = false;
            for (const attribute of arrays(variant.attributes)) {
                const option = groups
                    .get(nameKey(text(attribute.name)))
                    ?.options.get(nameKey(text(attribute.option)));
                if (!option) wildcard = true;
                else selection.push(option);
            }
            if (row.type === 'variable' && (wildcard || selection.length !== groups.size)) {
                await this.issue(
                    ctx,
                    run,
                    'products',
                    String(row.id),
                    'WILDCARD_VARIATION_REQUIRES_REVIEW',
                    'error',
                );
                await this.products.update(ctx, { id: product.id, enabled: false });
                continue;
            }
            let sku = text(variant.sku, 255) || `W${source.id}-${key.replace(':', '-')}`;
            const conflict = await this.connection
                .getRepository(ctx, ProductVariant)
                .findOne({ where: { sku, deletedAt: IsNull() } });
            if (conflict && String(conflict.id) !== mapped?.targetId) {
                sku = `${sku.slice(0, 200)}-W${source.id}-${variant.id}`;
                await this.issue(ctx, run, 'products', String(row.id), 'DUPLICATE_SKU_SUFFIXED');
            }
            const price = catalogPrice(variant.price);
            const regular = variant.regular_price ? catalogPrice(variant.regular_price) : null;
            const factor =
                ({ kg: 1000, g: 1, lbs: 453.59237, oz: 28.349523125 } as Record<string, number>)[
                    String(source.settings.weightUnit)
                ] ?? 1000;
            const weight = variant.weight || row.weight;
            if (weight && (!Number.isFinite(Number(weight)) || Number(weight) < 0))
                throw new Error('INVALID_WEIGHT');
            const attributeFacets = [...commonFacets];
            for (const attribute of arrays(variant.attributes).filter(a => a.id && a.option))
                attributeFacets.push(
                    await this.attributeValue(ctx, source, attribute, String(attribute.option)),
                );
            const variantInput = {
                sku,
                price,
                enabled:
                    variant.status === 'publish' &&
                    (variant.manage_stock || variant.stock_status !== 'outofstock'),
                trackInventory: (variant.manage_stock === true
                    ? 'TRUE'
                    : 'FALSE') as ProductVariant['trackInventory'],
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold:
                    variant.backorders === 'yes' || variant.backorders === 'notify' ? -1_000_000 : 0,
                optionIds: selection.map(Number),
                facetValueIds: [...tagIds, ...attributeFacets].map(Number),
                featuredAssetId: (await this.image(ctx, source, run, variant.image?.src)) ?? assetIds[0],
                translations: this.translations(
                    `${row.name}${
                        row.type === 'variable'
                            ? ` - ${arrays(variant.attributes)
                                  .map(a => a.option)
                                  .join(' / ')}`
                            : ''
                    }`,
                ),
                customFields: {
                    oldPrice: regular && regular > price ? regular : null,
                    weightGrams: weight ? Math.round(Number(weight) * factor) : null,
                    isDefault: arrays(row.default_attributes).length
                        ? arrays(row.default_attributes).every(a =>
                              arrays(variant.attributes).some(
                                  v =>
                                      nameKey(text(v.name)) === nameKey(text(a.name)) &&
                                      nameKey(text(v.option)) === nameKey(text(a.option)),
                              ),
                          )
                        : variations[0] === variant,
                },
            };
            const saved = mapped?.targetId
                ? (await this.variants.update(ctx, [{ id: Number(mapped.targetId), ...variantInput }]))[0]
                : (await this.variants.create(ctx, [{ productId: product.id, ...variantInput }]))[0];
            kept.add(String(saved.id));
            const quantity = Number.isSafeInteger(variant.stock_quantity) ? variant.stock_quantity : 0;
            const location = await this.locations.defaultStockLocation(ctx);
            await this.stock.lockStockLevelsForVariants(ctx, [saved.id], { includeUntrackedVariants: true });
            const level = await this.connection
                .getRepository(ctx, StockLevel)
                .findOneBy({ productVariantId: saved.id, stockLocationId: location.id });
            // Absolute import into a staging store, without sale/allocation events. Never overwrite
            // stock already allocated by a converted/live order on subsequent catch-up runs.
            if ((level?.stockAllocated ?? 0) > 0) throw new Error('DESTINATION_HAS_ALLOCATED_STOCK');
            await this.stock.updateStockOnHandForLocation(
                ctx,
                saved.id,
                location.id,
                quantity - (level?.stockOnHand ?? 0),
            );
            await this.remember(ctx, source, 'variants', key, saved.id, variant, {
                parentId: String(row.id),
                sourceQuantity: quantity,
            });
            if (variant.date_on_sale_from_gmt || variant.date_on_sale_to_gmt)
                await this.issue(ctx, run, 'products', String(row.id), 'SALE_SCHEDULE_REQUIRES_REVIEW');
        }
        const previous = await this.connection
            .getRepository(ctx, ProductVariant)
            .find({ where: { productId: product.id, deletedAt: IsNull() } });
        for (const variant of previous)
            if (!kept.has(String(variant.id)))
                await this.variants.update(ctx, [{ id: variant.id, enabled: false }]);
        await this.remember(ctx, source, 'products', String(row.id), product.id, row, {
            categoryIds,
            sourcePath: pathOf(row.permalink, source.url),
            slug: text(row.slug, 255),
            dimensions: row.dimensions ?? {},
            retryMedia: Number(run.verification.imageFailures ?? 0) > priorImageFailures,
        });
    }

    private async customer(
        ctx: RequestContext,
        source: WooSource,
        run: WooRun,
        row: WooRecord,
        kind = 'customers',
    ): Promise<Customer> {
        const repo = this.connection.getRepository(ctx, Customer);
        const mapped = await this.mapping(ctx, source, kind, String(row.id));
        const billing = row.billing ?? {};
        const phone = recordPhone(row);
        const email = text(row.email || billing.email, 254).toLowerCase();
        const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !isPlaceholderEmail(email);
        if (mapped?.targetId) {
            const customer = await repo.findOneOrFail({
                where: { id: mapped.targetId, deletedAt: IsNull() },
                relations: { user: true },
            });
            if (mapped.digest !== digest(row)) {
                if (mapped.metadata.owned && !customer.user) {
                    if (
                        phone !== (customer.customFields.phone ?? null) ||
                        (validEmail && email !== customer.emailAddress)
                    )
                        throw new Error('MAPPED_CUSTOMER_IDENTITY_CHANGED');
                    customer.firstName =
                        text(
                            `${row.first_name || billing.first_name || ''} ${row.last_name || billing.last_name || ''}`,
                            100,
                        ) || customer.firstName;
                    await repo.save(customer);
                    const addressId = await this.customerAddress(
                        ctx,
                        customer,
                        row,
                        mapped.metadata.addressId as string | undefined,
                    );
                    await this.remember(ctx, source, kind, String(row.id), customer.id, row, {
                        ...mapped.metadata,
                        addressId,
                    });
                } else {
                    await this.issue(
                        ctx,
                        run,
                        kind,
                        String(row.id),
                        'MERGED_CUSTOMER_PROFILE_NOT_OVERWRITTEN',
                    );
                    await this.remember(ctx, source, kind, String(row.id), customer.id, row, mapped.metadata);
                }
            }
            return customer;
        }
        const byPhone = phone
            ? await repo.findOne({ where: { customFields: { phone }, deletedAt: IsNull() } })
            : null;
        const byEmail = validEmail
            ? await repo
                  .createQueryBuilder('c')
                  .where('lower(c.emailAddress) = :email AND c.deletedAt IS NULL', { email })
                  .getOne()
            : null;
        if (byPhone && byEmail && byPhone.id !== byEmail.id)
            await this.issue(ctx, run, kind, String(row.id), 'CUSTOMER_IDENTITY_CONFLICT');
        const emailPhone = byEmail?.customFields.phone;
        const emailConflict = !!(byEmail && phone && emailPhone && emailPhone !== phone);
        if (emailConflict) await this.issue(ctx, run, kind, String(row.id), 'EMAIL_HAS_DIFFERENT_PHONE');
        let customer = byPhone ?? (!emailConflict ? byEmail : null);
        let owned = false;
        let addressId: string | undefined;
        if (!customer) {
            owned = true;
            customer = await repo.save(
                new Customer({
                    firstName:
                        text(
                            `${row.first_name || billing.first_name || ''} ${row.last_name || billing.last_name || ''}`,
                            100,
                        ) || 'WooCommerce customer',
                    lastName: '',
                    phoneNumber: phone ?? '',
                    emailAddress:
                        validEmail && !byEmail
                            ? email
                            : phone
                              ? placeholderEmailFor(phone)
                              : `woo-${source.id}-${kind}-${row.id}@phone.invalid`,
                    customFields: { phone, source: 'import' },
                }),
            );
            await this.channels.assignToCurrentChannel(customer, ctx);
            await repo.save(customer);
            addressId = await this.customerAddress(ctx, customer, row);
        }
        await this.remember(ctx, source, kind, String(row.id), customer.id, row, {
            identityConflict: emailConflict || !!(byPhone && byEmail && byPhone.id !== byEmail.id),
            owned,
            addressId,
        });
        return customer;
    }

    private async customerAddress(ctx: RequestContext, customer: Customer, row: WooRecord, id?: string) {
        const address = mapWooAddress(row.shipping?.address_1 ? row.shipping : (row.billing ?? {}));
        const country = await this.connection
            .getRepository(ctx, Country)
            .findOneBy({ code: address.countryCode });
        if (!country || !address.streetLine1) return id;
        const { countryCode: _country, resolved: _resolved, ...fields } = address;
        const saved = await this.connection.getRepository(ctx, Address).save(
            new Address({
                ...(id ? { id: Number(id) } : {}),
                ...fields,
                phoneNumber: address.phoneNumber ?? customer.customFields.phone ?? '',
                country,
                customer,
                defaultShippingAddress: true,
            }),
        );
        return String(saved.id);
    }

    private async order(ctx: RequestContext, source: WooSource, run: WooRun, row: WooRecord) {
        const repo = this.connection.getRepository(ctx, LegacyOrder);
        const existing = await repo.findOneBy({ sourceId: Number(source.id), sourceOrderId: String(row.id) });
        if (existing?.liveOrderId) throw new Error('OPEN_ORDER_ALREADY_CONVERTED');
        const customerMap = row.customer_id
            ? await this.mapping(ctx, source, 'customers', String(row.customer_id))
            : null;
        const customer = customerMap?.targetId
            ? await this.connection.getRepository(ctx, Customer).findOneBy({ id: customerMap.targetId })
            : await this.customer(
                  ctx,
                  source,
                  run,
                  { id: row.id, billing: row.billing, shipping: row.shipping },
                  'guestCustomers',
              );
        const snapshot: WooRecord = {};
        for (const key of [
            'id',
            'number',
            'status',
            'currency',
            'version',
            'prices_include_tax',
            'date_created_gmt',
            'date_modified_gmt',
            'date_paid_gmt',
            'date_completed_gmt',
            'billing',
            'shipping',
            'customer_id',
            'customer_note',
            'line_items',
            'shipping_lines',
            'fee_lines',
            'coupon_lines',
            'tax_lines',
            'discount_total',
            'discount_tax',
            'shipping_total',
            'shipping_tax',
            'cart_tax',
            'total',
            'total_tax',
            'payment_method',
            'payment_method_title',
            'transaction_id',
            '_notes',
            '_refunds',
        ])
            if (row[key] !== undefined) snapshot[key] = row[key];
        const refunded = arrays(row._refunds)
            .reduce((sum, r) => sum + BigInt(minor(r.amount)), BigInt('0'))
            .toString();
        const saved = await repo.save(
            new LegacyOrder({
                ...existing,
                channelId: Number(ctx.channelId),
                sourceId: Number(source.id),
                sourceOrderId: String(row.id),
                number: text(row.number || String(row.id), 100),
                status: text(row.status, 64),
                currency: text(row.currency, 8),
                total: minor(row.total),
                refunded,
                placedAt: gmt(row.date_created_gmt),
                phone: recordPhone(row),
                customerId: customer ? Number(customer.id) : null,
                snapshot,
            }),
        );
        await this.remember(ctx, source, 'orders', String(row.id), saved.id, row);
    }

    async finalize(ctx: RequestContext, source: WooSource) {
        // Advance, never reset: a concurrent checkout can safely consume additional numbers.
        const [maxRow] = (await this.connection
            .getRepository(ctx, LegacyOrder)
            .query(
                `SELECT COALESCE(max(number::bigint), 0)::text AS maximum FROM woo_legacy_order WHERE "sourceId" = $1 AND number ~ '^[0-9]{1,12}$'`,
                [source.id],
            )) as Array<{ maximum: string }>;
        const [sequence] = (await this.connection
            .getRepository(ctx, LegacyOrder)
            .query('SELECT last_value::text AS current FROM bd_order_number_seq')) as Array<{
            current: string;
        }>;
        const advance = BigInt(maxRow.maximum) - BigInt(sequence.current);
        if (advance > BigInt(1_000_000)) throw new Error('ORDER_NUMBER_RANGE_REQUIRES_REVIEW');
        if (advance > BigInt(0))
            await this.connection
                .getRepository(ctx, LegacyOrder)
                .query("SELECT max(nextval('bd_order_number_seq')) FROM generate_series(1, $1::int)", [
                    Number(advance),
                ]);

        const mappings = await this.connection
            .getRepository(ctx, WooMapping)
            .find({ where: { sourceId: Number(source.id), kind: 'categories' } });
        if (!mappings.length) return;
        const root = await this.connection.getRepository(ctx, Collection).findOneByOrFail({ isRoot: true });
        const products = await this.connection
            .getRepository(ctx, WooMapping)
            .find({ where: { sourceId: Number(source.id), kind: 'products' } });
        for (const category of mappings) {
            if (!category.targetId) continue;
            const parent = mappings.find(c => c.sourceKey === String(category.metadata.parent));
            if (category.metadata.parent && !parent?.targetId) throw new Error('CATEGORY_PARENT_MISSING');
            const ids = products
                .filter(
                    p =>
                        p.targetId &&
                        (p.metadata.categoryIds as string[] | undefined)?.includes(category.sourceKey),
                )
                .map(p => p.targetId!);
            await this.collections.update(ctx, {
                id: Number(category.targetId),
                inheritFilters: false,
                filters: [
                    {
                        code: 'product-id-filter',
                        arguments: [
                            { name: 'productIds', value: JSON.stringify(ids) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            const current = await this.connection
                .getRepository(ctx, Collection)
                .findOneByOrFail({ id: Number(category.targetId) });
            const parentId = parent?.targetId ? Number(parent.targetId) : root.id;
            if (String(current.parentId) !== String(parentId))
                await this.collections.move(ctx, {
                    collectionId: Number(category.targetId),
                    parentId,
                    index: 0,
                });
        }
    }
}
