import {
    billTotal,
    cleanText,
    costAfterReceive,
    costAfterReturn,
    dhakaDateKey,
    formatPurchaseNumber,
    isWholeTaka,
    overReceiveNeedsNote,
    parseBdPhone,
    parseCalendarDay,
    parsePurchaseDraft,
    PURCHASE_LIMITS,
    type PurchaseMoney,
    type PurchaseStatus,
    purchaseOwed,
    type SettingsFieldError,
    statusAfterReceive,
    supplierBalance,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Asset,
    ConfigService,
    type ID,
    ProductVariant,
    RequestContext,
    StockLocation,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, type Repository } from 'typeorm';
import { z } from 'zod';
import { assetUrl } from '../bd-catalog/asset-url';
import { StockService } from '../bd-catalog/stock.service';
import { StoreSettingsService } from '../bd-core';
import '../bd-cost/types';
import { insertTransaction } from '../bd-accounts/ledger';
import { PURCHASE_SEQUENCE, RETURN_SEQUENCE } from './constants';
import {
    BdPurchase,
    BdPurchaseLine,
    BdPurchaseReturn,
    BdPurchaseReturnLine,
    BdSupplier,
    BdSupplierPayment,
} from './entities';
import { PurchaseSettingsService } from './purchase-settings.service';

function fail(key: string): never {
    throw new UserInputError(`message.bd-purchases.${key}`);
}

const supplierSchema = z.object({
    name: z
        .string()
        .transform(value => cleanText(value))
        .pipe(z.string().min(1, 'required').max(PURCHASE_LIMITS.name, 'tooLong')),
    phone: z.string().transform(value => cleanText(value)),
    address: z
        .string()
        .transform(value => cleanText(value, { multiline: true }))
        .pipe(z.string().max(PURCHASE_LIMITS.address, 'tooLong')),
    note: z
        .string()
        .transform(value => cleanText(value, { multiline: true }))
        .pipe(z.string().max(PURCHASE_LIMITS.note, 'tooLong')),
});

const movementSchema = z.object({
    note: z
        .string()
        .optional()
        .transform(value => cleanText(value ?? '').slice(0, 500)),
    lines: z
        .array(
            z.object({
                lineId: z.string().trim().min(1).max(40),
                quantity: z.number().int().min(0).max(PURCHASE_LIMITS.qty),
            }),
        )
        .min(1)
        .max(PURCHASE_LIMITS.lines),
});

const paymentSchema = z.object({
    supplierId: z.string().trim().min(1).max(40),
    amount: z
        .number()
        .int()
        .min(1)
        .max(PURCHASE_LIMITS.maxMoney)
        .refine(value => isWholeTaka(value)),
    paidOn: z.string().refine(value => parseCalendarDay(value) !== null),
    note: z
        .string()
        .optional()
        .transform(value => cleanText(value ?? '').slice(0, 500)),
    accountId: z
        .string()
        .trim()
        .max(40)
        .nullable()
        .optional()
        .transform(value => (value ? value : null)),
});

type FieldResult<T> = { value: T; errors: [] } | { value: null; errors: SettingsFieldError[] };

/** Suppliers, purchases, receiving stock, returns and payments (phase 52). */
@Injectable()
export class PurchaseService {
    constructor(
        private connection: TransactionalConnection,
        private stock: StockService,
        private settings: PurchaseSettingsService,
        private store: StoreSettingsService,
        private config: ConfigService,
    ) {}

    async suppliers(ctx: RequestContext, options: { search?: string | null; skip?: number | null; take?: number | null }) {
        const take = Math.min(Math.max(options.take ?? 25, 1), 100);
        const skip = Math.max(options.skip ?? 0, 0);
        const qb = this.repo(ctx, BdSupplier).createQueryBuilder('supplier').orderBy('supplier.name', 'ASC');
        const search = cleanText(options.search ?? '');
        if (search) qb.andWhere('supplier.name ILIKE :search', { search: `%${search}%` });
        const [rows, totalItems] = await qb.skip(skip).take(take).getManyAndCount();
        const balances = await this.balancesFor(ctx, rows.map(row => row.id));
        const counts = await this.purchaseCounts(ctx, rows.map(row => row.id));
        return {
            totalItems,
            items: rows.map(row => ({
                id: row.id,
                name: row.name,
                phone: row.phone,
                balance: balances.get(String(row.id)) ?? 0,
                purchaseCount: counts.get(String(row.id)) ?? 0,
            })),
        };
    }

    async supplier(ctx: RequestContext, id: ID) {
        const row = await this.repo(ctx, BdSupplier).findOne({ where: { id } });
        if (!row) return null;
        const [detail] = await this.supplierViews(ctx, [row]);
        return detail ?? null;
    }

    async saveSupplier(ctx: RequestContext, id: ID | null, input: unknown): Promise<FieldResult<NonNullable<Awaited<ReturnType<PurchaseService['supplier']>>>>> {
        const parsed = supplierSchema.safeParse(input);
        if (!parsed.success) {
            return {
                value: null,
                errors: parsed.error.issues.map(issue => ({
                    path: issue.path.join('.') || 'name',
                    code: issue.message === 'required' || issue.message === 'tooLong' ? issue.message : 'invalid',
                })),
            };
        }
        const phone = this.phone(parsed.data.phone);
        if (phone === undefined) return { value: null, errors: [{ path: 'phone', code: 'invalid' }] };
        const saved = await this.connection.withTransaction(ctx, async tx => {
            const repo = this.repo(tx, BdSupplier);
            const row = id ? await repo.findOne({ where: { id } }) : new BdSupplier({ address: '', note: '' });
            if (!row) fail('not-found');
            row.name = parsed.data.name;
            row.phone = phone;
            row.address = parsed.data.address;
            row.note = parsed.data.note;
            return repo.save(row);
        });
        const detail = await this.supplier(ctx, saved.id);
        return { value: detail, errors: [] };
    }

    async purchases(
        ctx: RequestContext,
        options: { search?: string | null; status?: string | null; supplierId?: ID | null; skip?: number | null; take?: number | null },
    ) {
        const take = Math.min(Math.max(options.take ?? 25, 1), 100);
        const skip = Math.max(options.skip ?? 0, 0);
        const qb = this.repo(ctx, BdPurchase)
            .createQueryBuilder('purchase')
            .orderBy('purchase.purchasedOn', 'DESC')
            .addOrderBy('purchase.id', 'DESC');
        if (options.status) qb.andWhere('purchase.status = :status', { status: options.status });
        if (options.supplierId) qb.andWhere('purchase.supplierId = :supplierId', { supplierId: options.supplierId });
        const search = cleanText(options.search ?? '');
        if (search) {
            qb.andWhere(
                `purchase.number ILIKE :search OR purchase."supplierId" IN (
                    SELECT id FROM bd_supplier WHERE name ILIKE :search
                )`,
                { search: `%${search}%` },
            );
        }
        const [rows, totalItems] = await qb.skip(skip).take(take).getManyAndCount();
        const items = await this.purchaseRows(ctx, rows);
        return { totalItems, items };
    }

    async purchase(ctx: RequestContext, id: ID) {
        const row = await this.repo(ctx, BdPurchase).findOne({ where: { id } });
        if (!row) return null;
        return this.purchaseView(ctx, row);
    }

    async savePurchase(ctx: RequestContext, id: ID | null, input: unknown) {
        const parsed = parsePurchaseDraft(input);
        if (!parsed.ok) return { value: null, errors: parsed.errors };
        const draft = parsed.value;
        const saved = await this.connection.withTransaction(ctx, async tx => {
            const supplier = await this.repo(tx, BdSupplier).findOne({ where: { id: this.raw(draft.supplierId) } });
            if (!supplier) fail('not-found');
            const variantIds = draft.lines.map(line => String(this.raw(line.variantId)));
            await this.requireVariants(tx, variantIds);
            const billAssetId = draft.billAssetId ? this.raw(draft.billAssetId) : null;
            if (billAssetId) {
                const asset = await this.repo(tx, Asset).findOne({ where: { id: billAssetId } });
                if (!asset) return null;
            }
            let stockLocationId: ID | null = null;
            if (draft.branchId) {
                const location = await this.connection.findOneInChannel(
                    tx,
                    StockLocation,
                    this.raw(draft.branchId),
                    tx.channelId,
                );
                if (!location) fail('not-found');
                stockLocationId = location.id;
            }
            const repo = this.repo(tx, BdPurchase);
            const purchase = id ? await repo.findOne({ where: { id } }) : null;
            if (id && !purchase) fail('not-found');
            if (purchase && purchase.status !== 'draft') fail('not-draft');
            const row =
                purchase ??
                new BdPurchase({
                    number: await this.nextNumber(tx, PURCHASE_SEQUENCE, (await this.settings.get(tx)).purchasePrefix),
                    status: 'draft',
                    receiveNote: '',
                });
            row.supplierId = supplier.id;
            row.purchasedOn = draft.purchasedOn;
            row.note = draft.note;
            row.delivery = draft.delivery;
            row.otherCharge = draft.other;
            row.discount = draft.discount;
            row.paid = draft.paid;
            row.billAssetId = billAssetId;
            row.stockLocationId = stockLocationId;
            const savedPurchase = await repo.save(row);
            const lineRepo = this.repo(tx, BdPurchaseLine);
            if (purchase) await lineRepo.delete({ purchaseId: savedPurchase.id });
            await lineRepo.save(
                draft.lines.map(
                    line =>
                        new BdPurchaseLine({
                            purchaseId: savedPurchase.id,
                            productVariantId: this.raw(line.variantId),
                            quantity: line.quantity,
                            received: 0,
                            returned: 0,
                            unitCost: line.unitCost,
                            priorUnitCost: null,
                            priorKnown: false,
                        }),
                ),
            );
            return savedPurchase;
        });
        if (!saved) return { value: null, errors: [{ path: 'billAssetId', code: 'invalid' }] };
        return { value: await this.purchase(ctx, saved.id), errors: [] };
    }

    async remove(ctx: RequestContext, id: ID): Promise<boolean> {
        await this.connection.withTransaction(ctx, async tx => {
            const purchase = await this.repo(tx, BdPurchase).findOne({ where: { id } });
            if (!purchase) fail('not-found');
            const lines = await this.lines(tx, [purchase.id]);
            if (lines.some(line => line.received > 0)) fail('delete-received');
            await this.repo(tx, BdPurchaseLine).delete({ purchaseId: purchase.id });
            await this.repo(tx, BdPurchase).delete(purchase.id);
        });
        return true;
    }

    async markOrdered(ctx: RequestContext, id: ID) {
        const purchase = await this.connection.withTransaction(ctx, async tx => {
            const row = await this.repo(tx, BdPurchase).findOne({ where: { id } });
            if (!row) fail('not-found');
            if (row.status !== 'draft') fail('not-draft');
            const lines = await this.lines(tx, [row.id]);
            if (lines.length === 0) fail('nothing');
            row.status = 'ordered';
            return this.repo(tx, BdPurchase).save(row);
        });
        return this.purchaseView(ctx, purchase);
    }

    async receive(ctx: RequestContext, id: ID, input: unknown) {
        const parsed = movementSchema.safeParse(input);
        if (!parsed.success) fail('nothing');
        const adds = new Map(parsed.data.lines.map(line => [String(this.raw(line.lineId)), line.quantity]));
        if (![...adds.values()].some(quantity => quantity > 0)) fail('nothing');
        const purchase = await this.connection.withTransaction(ctx, async tx => {
            // Locked so two clicks at once can't both read the same received count.
            const row = await this.repo(tx, BdPurchase).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
            if (!row) fail('not-found');
            if (row.status === 'draft') fail('not-ordered');
            const lines = await this.lines(tx, [row.id]);
            const known = new Set(lines.map(line => String(line.id)));
            if ([...adds.keys()].some(lineId => !known.has(lineId))) fail('not-found');
            if (
                overReceiveNeedsNote(
                    lines.map(line => ({
                        quantity: line.quantity,
                        received: line.received,
                        add: adds.get(String(line.id)) ?? 0,
                    })),
                    parsed.data.note,
                )
            ) {
                fail('over-receive');
            }
            const method = (await this.settings.get(tx)).costMethod;
            const costs = new Map<string, number | null>();
            for (const line of lines) {
                const add = adds.get(String(line.id)) ?? 0;
                if (add <= 0) continue;
                const variantId = line.productVariantId;
                if (!costs.has(String(variantId))) costs.set(String(variantId), await this.readCost(tx, variantId));
                if (!line.priorKnown) {
                    line.priorUnitCost = costs.get(String(variantId)) ?? null;
                    line.priorKnown = true;
                }
                const stockBefore = await this.stock.totalOnHand(tx, variantId);
                await this.stock.adjust(tx, {
                    variantId,
                    change: add,
                    reason: 'purchase',
                    note: row.number,
                    stockLocationId: row.stockLocationId,
                });
                const next = costAfterReceive({
                    stock: stockBefore,
                    cost: costs.get(String(variantId)) ?? null,
                    qty: add,
                    unitCost: line.unitCost,
                    method,
                });
                await this.writeCost(tx, variantId, next);
                costs.set(String(variantId), next);
                line.received += add;
                await this.repo(tx, BdPurchaseLine).save(line);
            }
            if (parsed.data.note) row.receiveNote = parsed.data.note;
            row.status = statusAfterReceive(lines, row.status as PurchaseStatus);
            return this.repo(tx, BdPurchase).save(row);
        });
        return this.purchaseView(ctx, purchase);
    }

    async returnGoods(ctx: RequestContext, id: ID, input: unknown) {
        const parsed = movementSchema.safeParse(input);
        if (!parsed.success) fail('nothing');
        const qtyOf = new Map(parsed.data.lines.map(line => [String(this.raw(line.lineId)), line.quantity]));
        if (![...qtyOf.values()].some(quantity => quantity > 0)) fail('nothing');
        const purchase = await this.connection.withTransaction(ctx, async tx => {
            const row = await this.repo(tx, BdPurchase).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
            if (!row) fail('not-found');
            const lines = await this.lines(tx, [row.id]);
            const method = (await this.settings.get(tx)).costMethod;
            const costs = new Map<string, number | null>();
            const returning: BdPurchaseLine[] = [];
            for (const line of lines) {
                const qty = qtyOf.get(String(line.id)) ?? 0;
                if (qty <= 0) continue;
                if (qty > line.received - line.returned) fail('return-too-many');
                returning.push(line);
            }
            if (returning.length === 0) fail('nothing');
            const record = await this.repo(tx, BdPurchaseReturn).save(
                new BdPurchaseReturn({
                    purchaseId: row.id,
                    supplierId: row.supplierId,
                    number: await this.nextNumber(tx, RETURN_SEQUENCE, (await this.settings.get(tx)).returnPrefix),
                    returnedOn: dhakaDateKey(new Date()),
                    note: parsed.data.note,
                }),
            );
            for (const line of returning) {
                const qty = qtyOf.get(String(line.id)) ?? 0;
                const variantId = line.productVariantId;
                if (!costs.has(String(variantId))) costs.set(String(variantId), await this.readCost(tx, variantId));
                const stockBefore = await this.stock.totalOnHand(tx, variantId);
                await this.stock.adjust(tx, {
                    variantId,
                    change: -qty,
                    reason: 'purchaseReturn',
                    note: record.number,
                    stockLocationId: row.stockLocationId,
                });
                const remaining = line.received - line.returned - qty;
                const next = costAfterReturn({
                    stock: stockBefore,
                    cost: costs.get(String(variantId)) ?? null,
                    qty,
                    unitCost: line.unitCost,
                    method,
                    priorCost: line.priorUnitCost,
                    priorKnown: line.priorKnown,
                    remaining,
                });
                await this.writeCost(tx, variantId, next);
                costs.set(String(variantId), next);
                line.returned += qty;
                await this.repo(tx, BdPurchaseLine).save(line);
                await this.repo(tx, BdPurchaseReturnLine).save(
                    new BdPurchaseReturnLine({
                        returnId: record.id,
                        purchaseLineId: line.id,
                        quantity: qty,
                        unitCost: line.unitCost,
                    }),
                );
            }
            return row;
        });
        return this.purchaseView(ctx, purchase);
    }

    async pay(ctx: RequestContext, input: unknown) {
        const parsed = paymentSchema.safeParse(input);
        if (!parsed.success) fail('nothing');
        const supplierId = await this.connection.withTransaction(ctx, async tx => {
            const supplier = await this.repo(tx, BdSupplier).findOne({
                where: { id: this.raw(parsed.data.supplierId) },
            });
            if (!supplier) fail('not-found');
            const accountId = parsed.data.accountId ? this.raw(parsed.data.accountId) : null;
            const payment = await this.repo(tx, BdSupplierPayment).save(
                new BdSupplierPayment({
                    supplierId: supplier.id,
                    amount: parsed.data.amount,
                    paidOn: parsed.data.paidOn,
                    note: parsed.data.note,
                    accountId,
                }),
            );
            if (accountId != null) {
                await insertTransaction(tx, this.connection, {
                    accountId,
                    direction: 'out',
                    amount: parsed.data.amount,
                    day: parsed.data.paidOn,
                    source: 'purchase',
                    sourceId: String(payment.id),
                    note: parsed.data.note,
                    idempotencyKey: `purchase:${payment.id}`,
                });
            }
            return supplier.id;
        });
        return this.supplier(ctx, supplierId);
    }

    async print(ctx: RequestContext, id: ID, document: string) {
        if (document !== 'order' && document !== 'receipt') fail('nothing');
        const purchase = await this.purchase(ctx, id);
        if (!purchase) fail('not-found');
        const store = await this.store.get(ctx);
        return {
            document,
            number: purchase.number,
            purchasedOn: purchase.purchasedOn,
            status: purchase.status,
            note: purchase.note,
            receiveNote: purchase.receiveNote,
            supplier: {
                name: purchase.supplierName,
                phone: purchase.supplierPhone,
                address: purchase.supplierAddress,
            },
            storeName: store.profile.storeName,
            lines: purchase.lines.map(line => ({
                name: line.name,
                sku: line.sku,
                quantity: document === 'receipt' ? line.received : line.quantity,
                unitCost: line.unitCost,
            })),
            delivery: purchase.delivery,
            other: purchase.other,
            discount: purchase.discount,
            paid: purchase.paid,
            total: purchase.total,
            owed: purchase.owed,
        };
    }

    /**
     * JSON inputs keep the id the admin was given. Tests prefix it with `T_`. A plain number
     * (the real server, or a GraphQL `ID` argument) is already the database id.
     */
    private raw(id: ID): number {
        const value = String(id);
        const direct = Number(value);
        if (Number.isInteger(direct) && direct > 0 && String(direct) === value) return direct;
        const decoded = this.config.entityIdStrategy.decodeId(value);
        if (typeof decoded === 'number' && decoded > 0) return decoded;
        const stripped = Number(value.replace(/^T_/, ''));
        if (Number.isInteger(stripped) && stripped > 0) return stripped;
        fail('not-found');
    }

    private phone(value: string): string | null | undefined {
        if (!value) return null;
        const parsed = parseBdPhone(value);
        return parsed.ok ? parsed.phone.e164 : undefined;
    }

    private async requireVariants(ctx: RequestContext, ids: string[]) {
        const found = await this.repo(ctx, ProductVariant).find({ where: { id: In(ids) }, withDeleted: true });
        if (found.length !== new Set(ids.map(String)).size) fail('variant-missing');
    }

    private async readCost(ctx: RequestContext, variantId: ID): Promise<number | null> {
        const variant = await this.repo(ctx, ProductVariant).findOne({
            where: { id: variantId },
            withDeleted: true,
        });
        if (!variant) fail('variant-missing');
        return variant.customFields.unitCost ?? null;
    }

    private async writeCost(ctx: RequestContext, variantId: ID, cost: number) {
        await this.repo(ctx, ProductVariant).query(
            `UPDATE product_variant SET "customFieldsUnitcost" = $1 WHERE id = $2`,
            [cost, variantId],
        );
    }

    private async nextNumber(ctx: RequestContext, sequence: string, prefix: string): Promise<string> {
        const [row] = (await this.repo(ctx, BdPurchase).query(
            `SELECT nextval('"${sequence}"') AS value`,
        )) as Array<{ value: string }>;
        return formatPurchaseNumber(prefix, Number(row!.value));
    }

    private lines(ctx: RequestContext, purchaseIds: ID[]) {
        return this.repo(ctx, BdPurchaseLine).find({ where: { purchaseId: In(purchaseIds) }, order: { id: 'ASC' } });
    }

    private money(purchase: BdPurchase, lines: BdPurchaseLine[]): PurchaseMoney {
        return {
            status: purchase.status as PurchaseStatus,
            lines: lines.map(line => ({
                quantity: line.quantity,
                received: line.received,
                unitCost: line.unitCost,
            })),
            delivery: purchase.delivery,
            other: purchase.otherCharge,
            discount: purchase.discount,
            paid: purchase.paid,
        };
    }

    private async purchaseRows(ctx: RequestContext, purchases: BdPurchase[]) {
        const lines = await this.lines(ctx, purchases.map(row => row.id));
        const suppliers = await this.repo(ctx, BdSupplier).find({
            where: { id: In(purchases.map(row => row.supplierId)) },
        });
        const nameOf = new Map(suppliers.map(row => [String(row.id), row.name]));
        return purchases.map(row => {
            const own = lines.filter(line => String(line.purchaseId) === String(row.id));
            const money = this.money(row, own);
            return {
                id: row.id,
                number: row.number,
                supplierId: row.supplierId,
                supplierName: nameOf.get(String(row.supplierId)) ?? '',
                purchasedOn: row.purchasedOn,
                status: row.status,
                total: billTotal(money),
                owed: purchaseOwed(money),
            };
        });
    }

    private async purchaseView(ctx: RequestContext, purchase: BdPurchase) {
        const lines = await this.lines(ctx, [purchase.id]);
        const supplier = await this.repo(ctx, BdSupplier).findOne({ where: { id: purchase.supplierId } });
        const variants = await this.repo(ctx, ProductVariant).find({
            where: { id: In(lines.map(line => line.productVariantId)) },
            relations: { translations: true },
            withDeleted: true,
        });
        const variantOf = new Map(variants.map(row => [String(row.id), row]));
        const returns = await this.repo(ctx, BdPurchaseReturn).find({
            where: { purchaseId: purchase.id },
            order: { id: 'ASC' },
        });
        const returnLines = returns.length
            ? await this.repo(ctx, BdPurchaseReturnLine).find({ where: { returnId: In(returns.map(row => row.id)) } })
            : [];
        const asset = purchase.billAssetId
            ? await this.repo(ctx, Asset).findOne({ where: { id: purchase.billAssetId } })
            : null;
        const branch = purchase.stockLocationId
            ? await this.repo(ctx, StockLocation).findOne({ where: { id: purchase.stockLocationId } })
            : null;
        const money = this.money(purchase, lines);
        const nameOf = (variant: ProductVariant | undefined) =>
            variant?.translations.find(row => row.languageCode === ctx.languageCode)?.name ??
            variant?.translations[0]?.name ??
            variant?.sku ??
            '';
        return {
            id: purchase.id,
            number: purchase.number,
            supplierId: purchase.supplierId,
            supplierName: supplier?.name ?? '',
            supplierPhone: supplier?.phone ?? null,
            supplierAddress: supplier?.address ?? '',
            purchasedOn: purchase.purchasedOn,
            status: purchase.status,
            note: purchase.note,
            receiveNote: purchase.receiveNote,
            delivery: purchase.delivery,
            other: purchase.otherCharge,
            discount: purchase.discount,
            paid: purchase.paid,
            billAssetId: purchase.billAssetId,
            billPreview: assetUrl(this.config, ctx, asset?.preview),
            total: billTotal(money),
            owed: purchaseOwed(money),
            branchId: purchase.stockLocationId,
            branchName: branch?.name ?? '',
            lines: lines.map(line => {
                const variant = variantOf.get(String(line.productVariantId));
                return {
                    id: line.id,
                    variantId: line.productVariantId,
                    name: nameOf(variant),
                    sku: variant?.sku ?? '',
                    quantity: line.quantity,
                    received: line.received,
                    returned: line.returned,
                    unitCost: line.unitCost,
                };
            }),
            returns: returns.map(row => ({
                id: row.id,
                number: row.number,
                returnedOn: row.returnedOn,
                note: row.note,
                lines: returnLines
                    .filter(line => String(line.returnId) === String(row.id))
                    .map(line => ({
                        purchaseLineId: line.purchaseLineId,
                        quantity: line.quantity,
                        unitCost: line.unitCost,
                    })),
            })),
        };
    }

    private async supplierViews(ctx: RequestContext, suppliers: BdSupplier[]) {
        const ids = suppliers.map(row => row.id);
        const purchases = await this.repo(ctx, BdPurchase).find({
            where: { supplierId: In(ids) },
            order: { purchasedOn: 'DESC', id: 'DESC' },
        });
        const rows = await this.purchaseRows(ctx, purchases);
        const payments = await this.repo(ctx, BdSupplierPayment).find({
            where: { supplierId: In(ids) },
            order: { paidOn: 'DESC', id: 'DESC' },
        });
        const balances = await this.balancesFor(ctx, ids);
        return suppliers.map(row => ({
            id: row.id,
            name: row.name,
            phone: row.phone,
            address: row.address,
            note: row.note,
            balance: balances.get(String(row.id)) ?? 0,
            purchases: rows.filter(item => String(item.supplierId) === String(row.id)),
            payments: payments
                .filter(item => String(item.supplierId) === String(row.id))
                .map(item => ({ id: item.id, amount: item.amount, paidOn: item.paidOn, note: item.note })),
        }));
    }

    private async balancesFor(ctx: RequestContext, supplierIds: ID[]) {
        const totals = new Map<string, number>();
        if (supplierIds.length === 0) return totals;
        const purchases = await this.repo(ctx, BdPurchase).find({ where: { supplierId: In(supplierIds) } });
        const lines = await this.lines(ctx, purchases.map(row => row.id));
        const returns = await this.repo(ctx, BdPurchaseReturn).find({ where: { supplierId: In(supplierIds) } });
        const returnLines = returns.length
            ? await this.repo(ctx, BdPurchaseReturnLine).find({ where: { returnId: In(returns.map(row => row.id)) } })
            : [];
        const payments = await this.repo(ctx, BdSupplierPayment).find({ where: { supplierId: In(supplierIds) } });
        for (const id of supplierIds) {
            const own = purchases.filter(row => String(row.supplierId) === String(id));
            const ownReturns = returns.filter(row => String(row.supplierId) === String(id));
            const returnIds = new Set(ownReturns.map(row => String(row.id)));
            totals.set(
                String(id),
                supplierBalance({
                    purchases: own.map(row =>
                        this.money(
                            row,
                            lines.filter(line => String(line.purchaseId) === String(row.id)),
                        ),
                    ),
                    returns: returnLines
                        .filter(line => returnIds.has(String(line.returnId)))
                        .map(line => ({ quantity: line.quantity, unitCost: line.unitCost })),
                    payments: payments
                        .filter(row => String(row.supplierId) === String(id))
                        .reduce((sum, row) => sum + row.amount, 0),
                }),
            );
        }
        return totals;
    }

    private async purchaseCounts(ctx: RequestContext, supplierIds: ID[]) {
        const counts = new Map<string, number>();
        if (supplierIds.length === 0) return counts;
        const rows = (await this.repo(ctx, BdPurchase).query(
            `SELECT "supplierId" AS id, COUNT(*)::int AS count FROM bd_purchase
             WHERE "supplierId" = ANY($1) GROUP BY "supplierId"`,
            [supplierIds],
        )) as Array<{ id: string; count: number }>;
        for (const row of rows) counts.set(String(row.id), Number(row.count));
        return counts;
    }

    private repo<T extends object>(ctx: RequestContext, entity: new (...args: never[]) => T): Repository<T> {
        return this.connection.getRepository(ctx, entity);
    }
}
