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
import { encryptSecret, isPlaceholderEmail } from '@ecommbd/shared';
import { randomBytes } from 'node:crypto';
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
            if (mapping?.targetId && row._seo) {
                const translations = [LanguageCode.bn, LanguageCode.en].map(languageCode => ({
                    languageCode,
                    customFields: {
                        seoTitle: text(row._seo.title, 255),
                        seoDescription: text(row._seo.description, 2000),
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
            row.limit_usage_to_x_items ||
            row.usage_count > 0;
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
            enabled: true,
            couponCode: text(row.code, 100),
            name: text(row.code, 100),
            perCustomerUsageLimit: row.usage_limit_per_user || undefined,
            usageLimit: row.usage_limit || undefined,
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
    async finalize(ctx: RequestContext, source: WooSource, run: WooRun) {
        if (source.settings.transport !== 'helper') return;
        const categories = await this.connection
            .getRepository(ctx, WooMapping)
            .findBy({ sourceId: Number(source.id), kind: 'categories' });
        const encode = (value: unknown) => encodeURIComponent(String(value).normalize('NFC').toLowerCase());
        const urls = await this.connection
            .getRepository(ctx, WooExtra)
            .findBy({ sourceId: Number(source.id), kind: 'urls' });
        for (const extra of urls) {
            const row = extra.data as WooRecord;
            const mapping = await this.mapper.mapping(ctx, source, row.kind, String(row.id));
            if (!mapping?.targetId) continue;
            let target = `/product/${encode(mapping.metadata.slug)}/`;
            if (row.kind === 'categories') {
                const parts: string[] = [];
                let current: WooMapping | undefined = mapping;
                const seen = new Set<string>();
                while (current) {
                    if (seen.has(current.sourceKey)) throw new Error('CATEGORY_CYCLE');
                    seen.add(current.sourceKey);
                    parts.unshift(encode(current.metadata.slug));
                    current = categories.find(c => c.sourceKey === String(current!.metadata.parent));
                }
                target = `/product-category/${parts.join('/')}/`;
            }
            for (const url of [row.url, ...(row.attachments ?? [])]) {
                const path = pathOf(url, source.url);
                if (path && path !== target) await this.redirects.save(ctx, Number(source.id), path, target);
            }
            if (row.kind === 'products') {
                await this.redirects.save(ctx, Number(source.id), `/?p=${row.id}`, target);
                await this.redirects.save(
                    ctx,
                    Number(source.id),
                    `/?product=${mapping.metadata.slug}`,
                    target,
                );
            }
        }
        const settings = await this.connection
            .getRepository(ctx, WooExtra)
            .findBy({ sourceId: Number(source.id), kind: 'settings' });
        for (const setting of settings) {
            const row = setting.data as WooRecord;
            for (const rule of arrays(row.redirects)) {
                try {
                    await this.redirects.save(
                        ctx,
                        Number(source.id),
                        rule.path,
                        rule.target,
                        rule.status ?? 301,
                    );
                } catch {
                    await this.mapper.issue(ctx, run, 'settings', '1', 'REDIRECT_RULE_REQUIRES_REVIEW');
                }
            }
        }
    }
}
