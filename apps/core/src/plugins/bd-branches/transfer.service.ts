import { formatTransferNumber, parseReceiveTransfer, parseSendTransfer, type SettingsFieldError } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    type ID,
    ProductVariant,
    RequestContext,
    StockLevelService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';
import { StockService } from '../bd-catalog';
import { BranchService } from './branch.service';
import { BranchSettingsService } from './branch-settings.service';
import { TRANSFER_SEQUENCE } from './constants';
import { BdStockTransfer, BdStockTransferLine } from './entities';
import { rawId } from './ids';

function fail(key: string): never {
    throw new UserInputError(`message.bd-branches.${key}`);
}

export interface TransferView {
    id: ID;
    number: string;
    fromId: ID;
    toId: ID;
    fromName: string;
    toName: string;
    status: string;
    note: string;
    sentAt: Date;
    lines: Array<{
        id: ID;
        variantId: ID;
        name: string;
        sku: string;
        quantity: number;
        received: number;
        inTransit: number;
    }>;
}

/** Send stock from one branch to another. It stays in transit until the other branch receives it. */
@Injectable()
export class TransferService {
    constructor(
        private connection: TransactionalConnection,
        private branches: BranchService,
        private settings: BranchSettingsService,
        private stock: StockService,
        private stockLevels: StockLevelService,
        private config: ConfigService,
    ) {}

    async list(ctx: RequestContext): Promise<TransferView[]> {
        const rows = await this.connection.getRepository(ctx, BdStockTransfer).find({
            order: { sentAt: 'DESC', id: 'DESC' },
            take: 100,
        });
        return Promise.all(rows.map(row => this.view(ctx, row)));
    }

    async one(ctx: RequestContext, id: ID): Promise<TransferView | null> {
        const row = await this.connection.getRepository(ctx, BdStockTransfer).findOne({ where: { id } });
        return row ? this.view(ctx, row) : null;
    }

    async send(
        ctx: RequestContext,
        input: unknown,
    ): Promise<{ transfer: TransferView | null; errors: SettingsFieldError[] }> {
        const parsed = parseSendTransfer(input);
        if (!parsed.ok) return { transfer: null, errors: parsed.errors };
        const draft = parsed.value;
        const fromId = rawId(this.config, draft.fromId);
        const toId = rawId(this.config, draft.toId);
        if (fromId == null || toId == null) fail('not-found');
        if (fromId === toId) fail('same-branch');
        const quantities = new Map<number, number>();
        for (const line of draft.lines) {
            const variantId = rawId(this.config, line.variantId);
            if (variantId == null) fail('variant');
            quantities.set(variantId, (quantities.get(variantId) ?? 0) + line.quantity);
        }
        const saved = await this.connection.withTransaction(ctx, async tx => {
            await this.branches.requireLocations(tx, [fromId, toId]);
            await this.branches.requireVariants(tx, [...quantities.keys()]);
            const variantIds = [...quantities.keys()].sort((a, b) => a - b);
            await this.stockLevels.lockStockLevelsForVariants(tx, variantIds, { includeUntrackedVariants: true });
            for (const [variantId, quantity] of quantities) {
                const level = await this.stock.levelAt(tx, variantId, fromId);
                if (level.stockOnHand < quantity) fail('not-enough');
                if (level.stockOnHand - level.stockAllocated < quantity) fail('promised');
            }
            const number = await this.nextNumber(tx);
            const transfer = await this.connection.getRepository(tx, BdStockTransfer).save(
                new BdStockTransfer({
                    number,
                    fromLocationId: fromId,
                    toLocationId: toId,
                    status: 'sent',
                    note: draft.note,
                    sentAt: new Date(),
                }),
            );
            const lines: BdStockTransferLine[] = [];
            for (const [variantId, quantity] of quantities) {
                await this.stock.adjust(tx, {
                    variantId,
                    change: -quantity,
                    reason: 'other',
                    note: number,
                    stockLocationId: fromId,
                    keepPromised: true,
                });
                lines.push(
                    new BdStockTransferLine({
                        transferId: transfer.id,
                        productVariantId: variantId,
                        quantity,
                        received: 0,
                    }),
                );
            }
            await this.connection.getRepository(tx, BdStockTransferLine).save(lines);
            return transfer;
        });
        return { transfer: await this.view(ctx, saved), errors: [] };
    }

    async receive(ctx: RequestContext, id: ID, input: unknown): Promise<TransferView> {
        const parsed = parseReceiveTransfer(input);
        if (!parsed.ok) fail('nothing');
        const adds = new Map<string, number>();
        for (const line of parsed.value.lines) {
            const lineId = rawId(this.config, line.lineId);
            if (lineId == null) fail('not-found');
            adds.set(String(lineId), line.quantity);
        }
        if (![...adds.values()].some(quantity => quantity > 0)) fail('nothing');
        const saved = await this.connection.withTransaction(ctx, async tx => {
            const transfer = await this.connection.getRepository(tx, BdStockTransfer).findOne({ where: { id } });
            if (!transfer) fail('not-found');
            if (transfer.status === 'received') fail('too-many');
            const lines = await this.lines(tx, transfer.id);
            const known = new Set(lines.map(line => String(line.id)));
            if ([...adds.keys()].some(lineId => !known.has(lineId))) fail('not-found');
            const moving = lines.filter(line => (adds.get(String(line.id)) ?? 0) > 0);
            await this.stockLevels.lockStockLevelsForVariants(
                tx,
                moving.map(line => line.productVariantId).sort((a, b) => Number(a) - Number(b)),
                { includeUntrackedVariants: true },
            );
            for (const line of lines) {
                const add = adds.get(String(line.id)) ?? 0;
                if (add <= 0) continue;
                if (add > line.quantity - line.received) fail('too-many');
                await this.stock.adjust(tx, {
                    variantId: line.productVariantId,
                    change: add,
                    reason: 'other',
                    note: transfer.number,
                    stockLocationId: transfer.toLocationId,
                });
                line.received += add;
                await this.connection.getRepository(tx, BdStockTransferLine).save(line);
            }
            const fresh = await this.lines(tx, transfer.id);
            transfer.status = fresh.every(line => line.received >= line.quantity) ? 'received' : 'partial';
            return this.connection.getRepository(tx, BdStockTransfer).save(transfer);
        });
        return this.view(ctx, saved);
    }

    private lines(ctx: RequestContext, transferId: ID) {
        return this.connection.getRepository(ctx, BdStockTransferLine).find({
            where: { transferId },
            order: { id: 'ASC' },
        });
    }

    private async nextNumber(ctx: RequestContext): Promise<string> {
        const prefix = (await this.settings.get(ctx)).transferPrefix;
        const [row] = (await this.connection.getRepository(ctx, BdStockTransfer).query(
            `SELECT nextval('"${TRANSFER_SEQUENCE}"') AS value`,
        )) as Array<{ value: string }>;
        return formatTransferNumber(prefix, Number(row!.value));
    }

    private async view(ctx: RequestContext, transfer: BdStockTransfer): Promise<TransferView> {
        const lines = await this.lines(ctx, transfer.id);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(lines.map(line => line.productVariantId)) },
            relations: { translations: true },
            withDeleted: true,
        });
        const variantOf = new Map(variants.map(variant => [String(variant.id), variant]));
        const nameOf = async (id: ID) => (await this.branches.one(ctx, id))?.name ?? '';
        return {
            id: transfer.id,
            number: transfer.number,
            fromId: transfer.fromLocationId,
            toId: transfer.toLocationId,
            fromName: await nameOf(transfer.fromLocationId),
            toName: await nameOf(transfer.toLocationId),
            status: transfer.status,
            note: transfer.note,
            sentAt: transfer.sentAt,
            lines: lines.map(line => {
                const variant = variantOf.get(String(line.productVariantId));
                const name =
                    variant?.translations.find(row => row.languageCode === ctx.languageCode)?.name ??
                    variant?.translations[0]?.name ??
                    variant?.sku ??
                    '';
                return {
                    id: line.id,
                    variantId: line.productVariantId,
                    name,
                    sku: variant?.sku ?? '',
                    quantity: line.quantity,
                    received: line.received,
                    inTransit: line.quantity - line.received,
                };
            }),
        };
    }
}
