import { findDistrict, findThana, zoneOf } from '@ecommbd/bd-geo';
import {
    formatBdPhone,
    formatBranchAddress,
    parseBdPhone,
    parseBranchInput,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { DeletionResult } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    type ID,
    LanguageCode,
    Order,
    OrderLine,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    StockLocation,
    StockLocationService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';
import { BdStockTransfer } from './entities';
import { BranchSettingsService } from './branch-settings.service';

function fail(key: string): never {
    throw new UserInputError(`message.bd-branches.${key}`);
}

export interface BranchView {
    id: ID;
    name: string;
    phone: string | null;
    districtId: string;
    thanaId: string;
    districtName: string;
    thanaName: string;
    addressLine: string;
    note: string;
    sellsOnline: boolean;
}

/** Branches are Vendure stock locations. This service does not keep a second stock table. */
@Injectable()
export class BranchService {
    constructor(
        private connection: TransactionalConnection,
        private locations: StockLocationService,
        private settings: BranchSettingsService,
        private requestCache: RequestContextCacheService,
        private config: ConfigService,
    ) {}

    async list(ctx: RequestContext): Promise<BranchView[]> {
        return (await this.channelLocations(ctx)).map(location => this.view(ctx, location));
    }

    async one(ctx: RequestContext, id: ID): Promise<BranchView | null> {
        const location = await this.locations.findOne(ctx, id);
        return location ? this.view(ctx, location) : null;
    }

    async usage(ctx: RequestContext): Promise<{ count: number }> {
        const { totalItems } = await this.locations.findAll(ctx, { take: 1 });
        return { count: totalItems };
    }

    async save(
        ctx: RequestContext,
        id: ID | null,
        input: unknown,
    ): Promise<{ branch: BranchView | null; errors: SettingsFieldError[] }> {
        const parsed = parseBranchInput(input);
        if (!parsed.ok) return { branch: null, errors: parsed.errors };
        const value = parsed.value;
        const errors: SettingsFieldError[] = [];
        let phone: string | null = null;
        if (value.phone) {
            const parsedPhone = parseBdPhone(value.phone);
            if (!parsedPhone.ok) errors.push({ path: 'phone', code: 'invalidPhone' });
            else phone = parsedPhone.phone.e164;
        }
        if (!value.districtId || !findDistrict(value.districtId)) {
            errors.push({ path: 'districtId', code: 'required' });
        }
        const thana = value.thanaId ? findThana(value.thanaId) : undefined;
        if (!thana || thana.districtId !== value.districtId) errors.push({ path: 'thanaId', code: 'invalid' });
        if (errors.length > 0) return { branch: null, errors };
        const customFields = {
            phone,
            districtId: value.districtId,
            thanaId: value.thanaId,
            addressLine: value.addressLine,
            note: value.note,
            sellsOnline: value.sellsOnline,
        };
        const saved = id
            ? await this.locations.update(ctx, { id, name: value.name, customFields })
            : await this.locations.create(ctx, { name: value.name, description: '', customFields });
        return { branch: this.view(ctx, saved), errors: [] };
    }

    /** Refuses a branch that still holds stock, has held stock, or is the last one. Stock is not moved. */
    async remove(ctx: RequestContext, id: ID): Promise<boolean> {
        const location = await this.locations.findOne(ctx, id);
        if (!location) fail('not-found');
        const { totalItems } = await this.locations.findAll(ctx, { take: 1 });
        if (totalItems <= 1) fail('last');
        const [held] = (await this.connection.getRepository(ctx, StockLocation).query(
            `SELECT COALESCE(SUM("stockOnHand"), 0)::int AS "onHand",
                    COALESCE(SUM("stockAllocated"), 0)::int AS allocated
             FROM stock_level WHERE "stockLocationId" = $1`,
            [location.id],
        )) as Array<{ onHand: number | string; allocated: number | string }>;
        if (Number(held?.onHand ?? 0) > 0 || Number(held?.allocated ?? 0) > 0) fail('has-stock');
        const [history] = (await this.connection.getRepository(ctx, StockLocation).query(
            `SELECT COUNT(*)::int AS rows FROM stock_movement WHERE "stockLocationId" = $1`,
            [location.id],
        )) as Array<{ rows: number | string }>;
        if (Number(history?.rows ?? 0) > 0) fail('has-history');
        const open = await this.connection
            .getRepository(ctx, BdStockTransfer)
            .createQueryBuilder('transfer')
            .where('(transfer.fromLocationId = :id OR transfer.toLocationId = :id)', { id: location.id })
            .andWhere('transfer.status IN (:...statuses)', { statuses: ['sent', 'partial'] })
            .getCount();
        if (open > 0) fail('open-transfer');
        await this.connection
            .getRepository(ctx, StockLocation)
            .query(`DELETE FROM stock_level WHERE "stockLocationId" = $1 AND "stockOnHand" = 0 AND "stockAllocated" = 0`, [
                location.id,
            ]);
        await this.settings.clearLocation(ctx, location.id);
        const deleted = await this.locations.delete(ctx, { id: location.id });
        if (deleted.result !== DeletionResult.DELETED) fail('last');
        return true;
    }

    /**
     * The branch an order should ship from: the zone's default, else the oldest branch that
     * sells online, else the original location. Does not read shippingBranchId (not saved yet
     * while stock is being allocated).
     */
    shippingBranchId(ctx: RequestContext, order: Order): Promise<ID> {
        return this.requestCache.get(ctx, `bd-branch:ship:${order.id}`, () => this.resolveShippingBranch(ctx, order));
    }

    async shippingBranchIdForLine(ctx: RequestContext, line: OrderLine): Promise<ID> {
        const orderId = (line as OrderLine & { orderId?: ID }).orderId ?? line.order?.id;
        if (!orderId) return (await this.locations.defaultStockLocation(ctx)).id;
        return this.requestCache.get(ctx, `bd-branch:ship:${orderId}`, async () => {
            const order = await this.connection.getRepository(ctx, Order).findOne({ where: { id: orderId } });
            if (!order) return (await this.locations.defaultStockLocation(ctx)).id;
            return this.resolveShippingBranch(ctx, order);
        });
    }

    /** True when any reserved unit is not at the branch that should ship the order. */
    async transferNeeded(ctx: RequestContext, orderId: ID, branchId: ID): Promise<boolean> {
        const rows = (await this.connection.getRepository(ctx, Order).query(
            `SELECT sm."stockLocationId" AS "locationId", SUM(sm.quantity)::int AS quantity
             FROM stock_movement sm
             INNER JOIN order_line ol ON ol.id = sm."orderLineId"
             WHERE ol."orderId" = $1 AND sm.type = 'ALLOCATION'
             GROUP BY sm."stockLocationId"`,
            [orderId],
        )) as Array<{ locationId: ID; quantity: number | string }>;
        return rows.some(row => Number(row.quantity) > 0 && String(row.locationId) !== String(branchId));
    }

    async orderBranch(
        ctx: RequestContext,
        orderId: ID,
    ): Promise<{ branchId: ID | null; name: string; transferNeeded: boolean } | null> {
        const order = await this.connection.getRepository(ctx, Order).findOne({ where: { id: orderId } });
        if (!order) return null;
        const branchId = order.customFields.shippingBranchId ?? (await this.shippingBranchId(ctx, order));
        const location = branchId ? await this.locations.findOne(ctx, branchId) : undefined;
        return {
            branchId: branchId ?? null,
            name: location?.name ?? '',
            transferNeeded: order.customFields.transferNeeded ?? false,
        };
    }

    /** Stock of each variation at each branch. Read-only: the product form still edits the original location. */
    async productBranchStock(ctx: RequestContext, productId: ID) {
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { product: { id: productId } },
            withDeleted: true,
        });
        const locations = await this.channelLocations(ctx);
        if (variants.length === 0) return [];
        const ids = variants.map(variant => variant.id);
        const levels = (await this.connection.getRepository(ctx, ProductVariant).query(
            `SELECT "productVariantId" AS "variantId", "stockLocationId" AS "locationId", "stockOnHand"
             FROM stock_level WHERE "productVariantId" IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`,
            ids,
        )) as Array<{ variantId: ID; locationId: ID; stockOnHand: number | string }>;
        return variants.map(variant => ({
            variantId: variant.id,
            branches: locations.map(location => ({
                branchId: location.id,
                name: location.name,
                sellsOnline: location.customFields.sellsOnline === true,
                stockOnHand: Number(
                    levels.find(
                        level =>
                            String(level.variantId) === String(variant.id) &&
                            String(level.locationId) === String(location.id),
                    )?.stockOnHand ?? 0,
                ),
            })),
        }));
    }

    /** The address written onto a booking. Courier HTTP bodies are not changed. */
    async pickupFor(
        ctx: RequestContext,
        courier: 'steadfast' | 'pathao' | null,
        order: Order,
    ): Promise<{ branchId: ID; address: string }> {
        const settings = await this.settings.get(ctx);
        const locations = await this.channelLocations(ctx);
        const preferred = courier ? settings.pickupBranch[courier] : '';
        const fromSetting = preferred
            ? locations.find(location => String(location.id) === String(preferred))
            : undefined;
        const shippingId = order.customFields.shippingBranchId ?? (await this.shippingBranchId(ctx, order));
        const location =
            fromSetting ??
            locations.find(item => String(item.id) === String(shippingId)) ??
            locations.find(item => item.customFields.sellsOnline) ??
            locations[0] ??
            (await this.locations.defaultStockLocation(ctx));
        return { branchId: location.id, address: this.addressOf(ctx, location) };
    }

    async requireLocations(ctx: RequestContext, ids: ID[]): Promise<StockLocation[]> {
        const found = await Promise.all(ids.map(id => this.locations.findOne(ctx, id)));
        if (found.some(location => !location)) fail('not-found');
        return found as StockLocation[];
    }

    async requireVariants(ctx: RequestContext, ids: ID[]): Promise<void> {
        const rows = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(ids) },
            withDeleted: true,
        });
        if (rows.length !== new Set(ids.map(id => String(id))).size) fail('variant');
    }

    private async resolveShippingBranch(ctx: RequestContext, order: Order): Promise<ID> {
        const fields = (order.shippingAddress?.customFields ?? {}) as { districtId?: string; thanaId?: string };
        const thana = findThana(String(fields.thanaId ?? ''));
        const zone = thana?.zone ?? zoneOf(String(fields.districtId ?? ''), fields.thanaId) ?? 'outside_dhaka';
        const settings = await this.settings.get(ctx);
        const locations = await this.channelLocations(ctx);
        const zoneId = settings.zoneBranch[zone];
        const zoned = zoneId ? locations.find(location => String(location.id) === String(zoneId)) : undefined;
        if (zoned) return zoned.id;
        const online = locations.find(location => location.customFields.sellsOnline);
        if (online) return online.id;
        return (await this.locations.defaultStockLocation(ctx)).id;
    }

    private async channelLocations(ctx: RequestContext): Promise<StockLocation[]> {
        const { items } = await this.locations.findAll(ctx, { take: 100 });
        return [...items].sort(
            (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || Number(a.id) - Number(b.id),
        );
    }

    private view(ctx: RequestContext, location: StockLocation): BranchView {
        const fields = location.customFields;
        const language = ctx.languageCode === LanguageCode.bn ? 'bn' : 'en';
        const district = fields.districtId ? findDistrict(fields.districtId) : undefined;
        const thana = fields.thanaId ? findThana(fields.thanaId) : undefined;
        return {
            id: location.id,
            name: location.name,
            phone: fields.phone ?? null,
            districtId: fields.districtId ?? '',
            thanaId: fields.thanaId ?? '',
            districtName: district?.[language] ?? '',
            thanaName: thana?.[language] ?? '',
            addressLine: fields.addressLine ?? '',
            note: fields.note ?? '',
            sellsOnline: fields.sellsOnline === true,
        };
    }

    private addressOf(ctx: RequestContext, location: StockLocation): string {
        const view = this.view(ctx, location);
        return formatBranchAddress({
            name: view.name,
            addressLine: view.addressLine,
            thana: view.thanaName,
            district: view.districtName,
            phone: view.phone ? formatBdPhone(view.phone) : '',
        });
    }
}
