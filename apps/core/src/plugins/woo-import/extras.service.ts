import { Injectable } from '@nestjs/common';
import {
    CollectionService,
    Customer,
    isGraphQlErrorResult,
    LanguageCode,
    NativeAuthenticationMethod,
    ProductService,
    PromotionService,
    RequestContext,
    TransactionalConnection,
    User,
    UserService,
} from '@vendure/core';
import { encodeSlug, encryptSecret, isPlaceholderEmail, POLICY_SLUGS } from '@ecommbd/shared';
import { randomBytes } from 'node:crypto';
import { BdPageTranslation } from '../bd-content';
import { WooExtra, WooLegacyAuth } from './helper-entities';
import { WooMapping, WooRun, WooSource } from './entities';
import {
    arrays,
    catalogPrice,
    gmt,
    pathOf,
    recordPhone,
    safeDescription,
    sourceSettings,
    text,
    WooRecord,
    wooSlug,
} from './helpers';
import { ImportMapperService } from './import-mapper.service';
import { WooHelperService } from './helper.service';
import { WooRedirectService } from './redirect.service';
import { isSupportedWordPressHash } from './passwords';

@Injectable()
export class WooExtrasService {
    constructor(
        private connection: TransactionalConnection,
        private mapper: ImportMapperService,
        private helper: WooHelperService,
        private redirects: WooRedirectService,
        private products: ProductService,
        private collections: CollectionService,
        private users: UserService,
        private promotions: PromotionService,
    ) {}
    async apply(ctx: RequestContext, source: WooSource, run: WooRun, kind: string, row: WooRecord) {
        if (source.settings.transport !== 'helper') return;
        if (kind === 'customers' && row._password_hash) await this.login(ctx, source, run, row);
        if (['products', 'categories'].includes(kind)) {
            const mapping = await this.mapper.mapping(ctx, source, kind, String(row.id));
            const seoTitle = text(row._seo?.title, 255);
            const seoDescription = text(row._seo?.description, 2000);
            // Only what Yoast or RankMath actually had: an empty source field must not wipe an SEO
            // title the merchant has since written here.
            if (mapping?.targetId && (seoTitle || seoDescription)) {
                const translations = [LanguageCode.bn, LanguageCode.en].map(languageCode => ({
                    languageCode,
                    customFields: {
                        ...(seoTitle ? { seoTitle } : {}),
                        ...(seoDescription ? { seoDescription } : {}),
                    },
                }));
                if (kind === 'products')
                    await this.products.update(ctx, { id: Number(mapping.targetId), translations });
                else await this.collections.update(ctx, { id: Number(mapping.targetId), translations });
            }
            // Only allowlisted source paths are retained; never the password-bearing record.
            if (mapping?.targetId) {
                const repo = this.connection.getRepository(ctx, WooExtra);
                const old = await repo.findOneBy({
                    sourceId: Number(source.id),
                    kind: 'urls',
                    sourceKey: `${kind}:${row.id}`,
                });
                await repo.save(
                    new WooExtra({
                        ...old,
                        sourceId: Number(source.id),
                        kind: 'urls',
                        sourceKey: `${kind}:${row.id}`,
                        data: {
                            kind,
                            id: row.id,
                            url: row.permalink || row.link,
                            attachments: row._attachments ?? [],
                        },
                    }),
                );
            }
        }
        if (['coupons', 'reviews', 'settings'].includes(kind)) {
            const repo = this.connection.getRepository(ctx, WooExtra);
            const old = await repo.findOneBy({
                sourceId: Number(source.id),
                kind,
                sourceKey: String(row.id),
            });
            if (kind === 'reviews' && row.status !== 'approved') return;
            const data =
                kind === 'reviews'
                    ? {
                          id: row.id,
                          product_id: row.product_id,
                          rating: row.rating,
                          review: safeDescription(text(row.review, 10000)),
                          reviewer: text(row.reviewer, 100),
                          date_created_gmt: row.date_created_gmt,
                      }
                    : kind === 'settings'
                      ? sourceSettings(row)
                      : Object.fromEntries(
                            [
                                'id',
                                'code',
                                'description',
                                'discount_type',
                                'amount',
                                'date_expires_gmt',
                                'usage_limit',
                                'usage_limit_per_user',
                                'usage_count',
                                'minimum_amount',
                                'maximum_amount',
                                'product_ids',
                                'excluded_product_ids',
                                'product_categories',
                                'excluded_product_categories',
                                'email_restrictions',
                                'individual_use',
                                'free_shipping',
                                'exclude_sale_items',
                            ]
                                .filter(key => row[key] !== undefined)
                                .map(key => [key, row[key]]),
                        );
            await repo.save(
                new WooExtra({ ...old, sourceId: Number(source.id), kind, sourceKey: String(row.id), data }),
            );
            if (kind === 'coupons') await this.coupon(ctx, source, run, row);
            if (kind === 'settings') {
                for (const feature of row.warnings ?? [])
                    await this.mapper.issue(ctx, run, 'settings', '1', text(feature, 64));
                await this.connection
                    .getRepository(ctx, WooSource)
                    .update(source.id, { settings: { ...source.settings, reference: sourceSettings(row) } });
            }
        }
    }
    private async login(ctx: RequestContext, source: WooSource, run: WooRun, row: WooRecord) {
        const mapping = await this.mapper.mapping(ctx, source, 'customers', String(row.id));
        if (!mapping?.targetId || mapping.metadata.identityConflict || row._role !== 'customer') {
            await this.mapper.issue(ctx, run, 'customers', String(row.id), 'LEGACY_LOGIN_IDENTITY_REFUSED');
            return;
        }
        const repo = this.connection.getRepository(ctx, Customer);
        const customer = await repo.findOneOrFail({
            where: { id: mapping.targetId },
            relations: { user: true },
        });
        const email = text(row.email || row.billing?.email, 254).toLowerCase();
        if (customer.user) {
            // A final frozen upload may change a still-unused WP password. Only refresh our own
            // pending reference; a successful login or reset has already replaced it natively.
            const native = await this.connection
                .getRepository(ctx, NativeAuthenticationMethod)
                .createQueryBuilder('n')
                .addSelect('n.passwordHash')
                .where('n.userId = :id', { id: customer.user.id })
                .getOne();
            if (
                native?.passwordHash?.startsWith('woo:') &&
                mapping.metadata.owned &&
                email === customer.emailAddress &&
                recordPhone(row) === (customer.customFields.phone ?? null)
            ) {
                if (!isSupportedWordPressHash(row._password_hash)) {
                    await this.mapper.issue(
                        ctx,
                        run,
                        'customers',
                        String(row.id),
                        'LEGACY_PASSWORD_FORMAT_REQUIRES_RESET',
                    );
                    return;
                }
                const legacy = await this.connection.getRepository(ctx, WooLegacyAuth).findOneBy({
                    reference: native.passwordHash.slice(4),
                    customerId: Number(customer.id),
                    sourceId: Number(source.id),
                });
                if (legacy)
                    await this.connection.getRepository(ctx, WooLegacyAuth).update(legacy.id, {
                        secret: encryptSecret(
                            row._password_hash,
                            this.helper.keyring(),
                            `woo-password:${customer.id}`,
                        ),
                    });
            }
            return;
        }
        if (
            !email ||
            isPlaceholderEmail(email) ||
            email !== customer.emailAddress ||
            !mapping.metadata.owned ||
            !isSupportedWordPressHash(row._password_hash)
        ) {
            await this.mapper.issue(ctx, run, 'customers', String(row.id), 'LEGACY_LOGIN_IDENTITY_REFUSED');
            return;
        }
        if (await this.connection.getRepository(ctx, User).exists({ where: { identifier: email } })) {
            await this.mapper.issue(
                ctx,
                run,
                'customers',
                String(row.id),
                'LEGACY_LOGIN_IDENTIFIER_CONFLICT',
            );
            return;
        }
        const user = await this.users.createCustomerUser(ctx, email, randomBytes(32).toString('hex'));
        if (isGraphQlErrorResult(user)) throw new Error('LEGACY_USER_CREATE_FAILED');
        const reference = randomBytes(32).toString('hex');
        await this.connection.getRepository(ctx, User).update(user.id, { verified: true });
        await this.connection
            .getRepository(ctx, NativeAuthenticationMethod)
            .update({ user: { id: user.id } }, { passwordHash: `woo:${reference}`, verificationToken: null });
        customer.user = user;
        await repo.save(customer);
        await this.connection.getRepository(ctx, WooLegacyAuth).save(
            new WooLegacyAuth({
                reference,
                customerId: Number(customer.id),
                sourceId: Number(source.id),
                secret: encryptSecret(
                    row._password_hash,
                    this.helper.keyring(),
                    `woo-password:${customer.id}`,
                ),
                expiresAt: new Date(Date.now() + 365 * 86400_000),
            }),
        );
    }
    private async coupon(ctx: RequestContext, source: WooSource, run: WooRun, row: WooRecord) {
        const unsupported =
            source.settings.currency !== 'BDT' ||
            !['percent', 'fixed_cart'].includes(row.discount_type) ||
            row.individual_use ||
            row.exclude_sale_items ||
            row.free_shipping ||
            arrays(row.meta_data).length ||
            [
                'product_ids',
                'excluded_product_ids',
                'product_categories',
                'excluded_product_categories',
                'email_restrictions',
            ].some(k => row[k]?.length) ||
            Number(row.maximum_amount) > 0 ||
            row.limit_usage_to_x_items;
        // A coupon that has been used keeps working with the uses it has left: WooCommerce's
        // `usage_count` is subtracted from its limit, because Vendure counts only orders placed
        // here. (Refusing every used coupon left out most real ones.) One that is used up comes
        // over disabled, for the merchant to see.
        const used = Number.isSafeInteger(row.usage_count) && row.usage_count > 0 ? row.usage_count : 0;
        const limit = Number.isSafeInteger(row.usage_limit) && row.usage_limit > 0 ? row.usage_limit : null;
        const remaining = limit === null ? null : Math.max(0, limit - used);
        if (remaining === 0)
            await this.mapper.issue(ctx, run, 'coupons', String(row.id), 'COUPON_USED_UP_IMPORTED_DISABLED');
        // Each customer's earlier uses can't be carried over (WooCommerce keeps them per email).
        if (used && row.usage_limit_per_user)
            await this.mapper.issue(
                ctx,
                run,
                'coupons',
                String(row.id),
                'COUPON_PER_CUSTOMER_HISTORY_NOT_KEPT',
            );
        if (unsupported) {
            const mapped = await this.mapper.mapping(ctx, source, 'coupons', String(row.id));
            if (mapped?.targetId) {
                const disabled = await this.promotions.updatePromotion(ctx, {
                    id: Number(mapped.targetId),
                    enabled: false,
                });
                if (isGraphQlErrorResult(disabled)) throw new Error('COUPON_DISABLE_FAILED');
            }
            await this.mapper.issue(ctx, run, 'coupons', String(row.id), 'COUPON_CONSTRAINT_REQUIRES_REVIEW');
            return;
        }
        const key = String(row.id);
        const mapped = await this.mapper.mapping(ctx, source, 'coupons', key);
        const amount = row.discount_type === 'percent' ? Number(row.amount) : catalogPrice(row.amount);
        if (!Number.isFinite(amount) || amount <= 0 || (row.discount_type === 'percent' && amount > 100))
            throw new Error('INVALID_COUPON_AMOUNT');
        const input = {
            enabled: remaining !== 0,
            couponCode: text(row.code, 100),
            name: text(row.code, 100),
            perCustomerUsageLimit: row.usage_limit_per_user || undefined,
            usageLimit: remaining || undefined,
            endsAt: gmt(row.date_expires_gmt),
            conditions:
                Number(row.minimum_amount) > 0
                    ? [
                          {
                              code: 'minimum_order_amount',
                              arguments: [
                                  { name: 'amount', value: String(catalogPrice(row.minimum_amount)) },
                                  { name: 'taxInclusive', value: 'true' },
                              ],
                          },
                      ]
                    : [],
            actions: [
                {
                    code:
                        row.discount_type === 'percent'
                            ? 'order_percentage_discount'
                            : 'order_fixed_discount',
                    arguments: [{ name: 'discount', value: String(amount) }],
                },
            ],
            translations: [
                {
                    languageCode: LanguageCode.en,
                    name: text(row.code, 100),
                    description: text(row.description, 1000),
                },
                {
                    languageCode: LanguageCode.bn,
                    name: text(row.code, 100),
                    description: text(row.description, 1000),
                },
            ],
        };
        const result = mapped?.targetId
            ? await this.promotions.updatePromotion(ctx, { id: Number(mapped.targetId), ...input })
            : await this.promotions.createPromotion(ctx, input);
        if (isGraphQlErrorResult(result)) throw new Error('COUPON_IMPORT_FAILED');
        await this.mapper.remember(ctx, source, 'coupons', key, result.id, row);
    }
    /**
     * After the last record: a redirect for every old product and category address (both
     * transports), plus, from the helper plugin, attachment pages, WordPress pages and the rules
     * of the Redirection plugin.
     *
     * Targets are built from the slugs as stored here, written the way the storefront writes
     * links (`encodeSlug`). A rule that can't be saved (one of our own addresses, a loop) is an
     * issue to review; it never fails the import. Rules staff saved by hand are left alone.
     */
    async finalize(ctx: RequestContext, source: WooSource, run: WooRun) {
        const sourceId = Number(source.id);
        const mappings = this.connection.getRepository(ctx, WooMapping);
        const categories = await mappings.findBy({ sourceId, kind: 'categories' });
        const products = await mappings.findBy({ sourceId, kind: 'products' });
        // Attachment pages (image pages) only come from the helper plugin.
        const attachments = new Map<string, string[]>();
        for (const extra of await this.connection
            .getRepository(ctx, WooExtra)
            .findBy({ sourceId, kind: 'urls' })) {
            const row = extra.data as WooRecord;
            const urls = Array.isArray(row.attachments) ? row.attachments : [];
            attachments.set(
                `${row.kind}:${row.id}`,
                urls.filter((url: unknown): url is string => typeof url === 'string'),
            );
        }
        for (const mapping of [...categories, ...products]) {
            if (!mapping.targetId || mapping.metadata.skipped) continue;
            const kind = categories.includes(mapping) ? 'categories' : 'products';
            const target =
                kind === 'products'
                    ? `/product/${encodeSlug(String(mapping.metadata.slug))}/`
                    : this.categoryPath(mapping, categories);
            if (!target) {
                await this.mapper.issue(ctx, run, kind, mapping.sourceKey, 'CATEGORY_CYCLE');
                continue;
            }
            const old = [
                mapping.metadata.sourcePath,
                ...(attachments.get(`${kind}:${mapping.sourceKey}`) ?? []),
            ];
            for (const url of old) {
                const path = typeof url === 'string' ? pathOf(url, source.url) : null;
                if (path) await this.importRule(ctx, run, sourceId, kind, mapping.sourceKey, path, target);
            }
            if (kind === 'products') {
                const id = mapping.sourceKey;
                await this.importRule(ctx, run, sourceId, kind, id, `/?p=${id}`, target);
                const slug = String(mapping.metadata.sourceSlug ?? '');
                if (slug) await this.importRule(ctx, run, sourceId, kind, id, `/?product=${slug}`, target);
            }
        }
        const settings = await this.connection
            .getRepository(ctx, WooExtra)
            .findBy({ sourceId, kind: 'settings' });
        for (const setting of settings) {
            for (const rule of arrays((setting.data as WooRecord).redirects)) {
                // A WordPress page goes to our page with the same address when there is one (or a
                // policy page), else to the home page. Rules from the Redirection plugin keep
                // their own target.
                const target = rule.page ? await this.pageTarget(ctx, rule.page.slug) : rule.target;
                await this.importRule(
                    ctx,
                    run,
                    sourceId,
                    'settings',
                    '1',
                    rule.path,
                    target,
                    rule.status ?? 301,
                );
            }
        }
    }

    /** Saves one imported rule, or records an issue when it's refused. */
    private async importRule(
        ctx: RequestContext,
        run: WooRun,
        sourceId: number,
        kind: string,
        sourceKey: string,
        path: string,
        target: string | null,
        status = 301,
    ) {
        try {
            await this.redirects.importRule(ctx, sourceId, path, target, status);
        } catch {
            await this.mapper.issue(ctx, run, kind, sourceKey, 'REDIRECT_RULE_REQUIRES_REVIEW');
        }
    }

    /** `/product-category/<parent>/<child>/`, as the storefront nests it; null for a cycle. */
    private categoryPath(mapping: WooMapping, categories: WooMapping[]): string | null {
        const parts: string[] = [];
        const seen = new Set<string>();
        let current: WooMapping | undefined = mapping;
        while (current) {
            if (seen.has(current.sourceKey)) return null;
            seen.add(current.sourceKey);
            // A parent that wasn't imported ends the path (finalize put the category at the top).
            if (current !== mapping && !current.targetId) break;
            parts.unshift(encodeSlug(String(current.metadata.slug)));
            const parent: string = String(current.metadata.parent);
            current = categories.find(c => c.sourceKey === parent);
        }
        return `/product-category/${parts.join('/')}/`;
    }

    /** Our page for an old WordPress page slug: a page or policy with the same slug, or home. */
    private async pageTarget(ctx: RequestContext, rawSlug: unknown): Promise<string> {
        const slug = wooSlug(rawSlug);
        if (!slug) return '/';
        const composed = slug.normalize('NFC');
        if (Object.values(POLICY_SLUGS).includes(composed)) return `/${composed}/`;
        const page = await this.connection.getRepository(ctx, BdPageTranslation).findOne({
            where: { slug },
            relations: { page: true },
        });
        return page?.page.enabled ? `/${encodeSlug(page.slug)}/` : '/';
    }
}
