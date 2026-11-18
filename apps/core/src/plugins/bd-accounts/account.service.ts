import {
    ACCOUNT_KINDS,
    accountBalance,
    cleanText,
    csvDocument,
    isWholeTaka,
    parseCalendarDay,
    type SettingsFieldError,
    takaToMinor,
    TX_SOURCES,
    type TxSource,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Asset,
    ConfigService,
    type ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import { z } from 'zod';
import { csvLabels } from './i18n';
import { insertTransaction } from './ledger';
import { BdAccount, BdExpense, BdExpenseHead, BdTransaction } from './entities';

function fail(key: string): never {
    throw new UserInputError(`message.bd-accounts.${key}`);
}

const MAX_MONEY = takaToMinor(1_00_00_000);
const money = z
    .number()
    .int()
    .min(100, 'invalid')
    .max(MAX_MONEY, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');
const opening = z
    .number()
    .int()
    .min(0, 'invalid')
    .max(MAX_MONEY, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');
const day = z.string().refine(value => parseCalendarDay(value) !== null, 'invalid');
const label = z
    .string()
    .transform(value => cleanText(value))
    .pipe(z.string().min(1, 'required').max(80, 'tooLong'));
const note = z
    .string()
    .optional()
    .transform(value => cleanText(value ?? '', { multiline: true }).slice(0, 1000));

const accountSchema = z.object({
    name: label,
    kind: z.enum(ACCOUNT_KINDS),
    openingBalance: opening,
});
const expenseSchema = z.object({
    day,
    headId: z.string().trim().min(1, 'required').max(40, 'tooLong'),
    amount: money,
    accountId: z.string().trim().min(1, 'required').max(40, 'tooLong'),
    note,
    receiptAssetId: z.string().trim().max(40).nullable().optional(),
});
const headSchema = z.object({
    nameBn: label,
    nameEn: label,
});
const transferSchema = z.object({
    fromAccountId: z.string().trim().min(1).max(40),
    toAccountId: z.string().trim().min(1).max(40),
    amount: money,
    day,
    note,
});
const manualSchema = z.object({
    accountId: z.string().trim().min(1).max(40),
    direction: z.enum(['in', 'out']),
    amount: money,
    day,
    note,
});

type Saved<T> = { value: T; errors: [] } | { value: null; errors: SettingsFieldError[] };

export interface AccountView {
    id: ID;
    kind: string;
    name: string;
    openingBalance: number;
    balance: number;
}

export interface TransactionView {
    id: ID;
    accountId: ID;
    accountName: string;
    direction: string;
    amount: number;
    date: string;
    source: string;
    sourceId: string | null;
    note: string;
    transferId: string | null;
}

export interface ExpenseView {
    id: ID;
    date: string;
    headId: ID;
    headCode: string;
    headName: string;
    amount: number;
    accountId: ID;
    accountName: string;
    note: string;
    receiptAssetId: ID | null;
}

/** Accounts, the ledger, expenses and expense heads (phase 53). */
@Injectable()
export class AccountService {
    constructor(
        private connection: TransactionalConnection,
        private config: ConfigService,
    ) {}

    async accounts(
        ctx: RequestContext,
        options: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        const take = Math.min(Math.max(options.take ?? 25, 1), 100);
        const skip = Math.max(options.skip ?? 0, 0);
        const qb = this.connection.getRepository(ctx, BdAccount).createQueryBuilder('account').orderBy('account.name', 'ASC');
        const search = cleanText(options.search ?? '');
        if (search) qb.andWhere('account.name ILIKE :search', { search: `%${search}%` });
        const [rows, totalItems] = await qb.skip(skip).take(take).getManyAndCount();
        const balances = await this.nets(ctx, rows.map(row => row.id));
        return {
            totalItems,
            items: rows.map(row => this.accountView(row, balances.get(String(row.id)) ?? 0)),
        };
    }

    async account(ctx: RequestContext, id: ID): Promise<AccountView | null> {
        const row = await this.connection.getRepository(ctx, BdAccount).findOne({ where: { id: this.raw(id) } });
        if (!row) return null;
        const balances = await this.nets(ctx, [row.id]);
        return this.accountView(row, balances.get(String(row.id)) ?? 0);
    }

    async saveAccount(ctx: RequestContext, id: ID | null, input: unknown): Promise<Saved<AccountView>> {
        const parsed = accountSchema.safeParse(input);
        if (!parsed.success) return { value: null, errors: fieldErrors(parsed.error.issues) };
        const repo = this.connection.getRepository(ctx, BdAccount);
        const row = id
            ? await repo.findOne({ where: { id: this.raw(id) } })
            : new BdAccount();
        if (!row) fail('not-found');
        row.name = parsed.data.name;
        row.kind = parsed.data.kind;
        row.openingBalance = parsed.data.openingBalance;
        const saved = await repo.save(row);
        const balances = await this.nets(ctx, [saved.id]);
        return { value: this.accountView(saved, balances.get(String(saved.id)) ?? 0), errors: [] };
    }

    async transactions(
        ctx: RequestContext,
        options: {
            accountId?: ID | null;
            source?: string | null;
            dateFrom?: string | null;
            dateTo?: string | null;
            skip?: number | null;
            take?: number | null;
        },
    ) {
        const take = Math.min(Math.max(options.take ?? 25, 1), 100);
        const skip = Math.max(options.skip ?? 0, 0);
        const qb = this.filtered(ctx, options).orderBy('tx.day', 'DESC').addOrderBy('tx.id', 'DESC');
        const [rows, totalItems] = await qb.skip(skip).take(take).getManyAndCount();
        const names = await this.accountNames(ctx, rows.map(row => row.accountId));
        return { totalItems, items: rows.map(row => this.txView(row, names)) };
    }

    async transactionsCsv(
        ctx: RequestContext,
        options: { accountId?: ID | null; source?: string | null; dateFrom?: string | null; dateTo?: string | null },
    ): Promise<string> {
        const rows = await this.filtered(ctx, options).orderBy('tx.day', 'ASC').addOrderBy('tx.id', 'ASC').take(5001).getMany();
        if (rows.length > 5000) fail('too-many');
        const names = await this.accountNames(ctx, rows.map(row => row.accountId));
        const language = ctx.languageCode === 'bn' ? 'bn' : 'en';
        const labels = csvLabels[language];
        return csvDocument(
            [...labels.headers],
            rows.map(row => [
                row.day,
                names.get(row.accountId) ?? '',
                row.direction === 'in' ? labels.in : labels.out,
                String(row.amount / 100),
                labels.source[row.source as TxSource] ?? row.source,
                row.note,
            ]),
        );
    }

    async heads(ctx: RequestContext) {
        const rows = await this.connection.getRepository(ctx, BdExpenseHead).find({ order: { id: 'ASC' } });
        return rows.map(row => ({ id: row.id, code: row.code, nameBn: row.nameBn, nameEn: row.nameEn }));
    }

    async saveHead(ctx: RequestContext, id: ID | null, input: unknown): Promise<Saved<{ id: ID; code: string; nameBn: string; nameEn: string }>> {
        const parsed = headSchema.safeParse(input);
        if (!parsed.success) return { value: null, errors: fieldErrors(parsed.error.issues) };
        const repo = this.connection.getRepository(ctx, BdExpenseHead);
        if (id) {
            const row = await repo.findOne({ where: { id: this.raw(id) } });
            if (!row) fail('not-found');
            row.nameBn = parsed.data.nameBn;
            row.nameEn = parsed.data.nameEn;
            const saved = await repo.save(row);
            return { value: saved, errors: [] };
        }
        const taken = new Set((await repo.find()).map(row => row.code));
        const saved = await repo.save(
            new BdExpenseHead({
                code: headCode(parsed.data.nameEn, taken),
                nameBn: parsed.data.nameBn,
                nameEn: parsed.data.nameEn,
            }),
        );
        return { value: saved, errors: [] };
    }

    async expenses(
        ctx: RequestContext,
        options: { headId?: ID | null; dateFrom?: string | null; dateTo?: string | null; skip?: number | null; take?: number | null },
    ) {
        const take = Math.min(Math.max(options.take ?? 25, 1), 100);
        const skip = Math.max(options.skip ?? 0, 0);
        const qb = this.connection
            .getRepository(ctx, BdExpense)
            .createQueryBuilder('expense')
            .orderBy('expense.day', 'DESC')
            .addOrderBy('expense.id', 'DESC');
        this.applyDates(qb, 'expense.day', options.dateFrom, options.dateTo);
        if (options.headId) qb.andWhere('expense.headId = :headId', { headId: this.raw(options.headId) });
        const [rows, totalItems] = await qb.skip(skip).take(take).getManyAndCount();
        return { totalItems, items: await this.expenseViews(ctx, rows) };
    }

    async expense(ctx: RequestContext, id: ID): Promise<ExpenseView | null> {
        const row = await this.connection.getRepository(ctx, BdExpense).findOne({ where: { id: this.raw(id) } });
        if (!row) return null;
        const [view] = await this.expenseViews(ctx, [row]);
        return view ?? null;
    }

    async saveExpense(ctx: RequestContext, id: ID | null, input: unknown): Promise<Saved<ExpenseView>> {
        const parsed = expenseSchema.safeParse(input);
        if (!parsed.success) return { value: null, errors: fieldErrors(parsed.error.issues) };
        const headId = this.raw(parsed.data.headId);
        const accountId = this.raw(parsed.data.accountId);
        const head = await this.connection.getRepository(ctx, BdExpenseHead).findOne({ where: { id: headId } });
        if (!head) return { value: null, errors: [{ path: 'headId', code: 'notFound' }] };
        const account = await this.connection.getRepository(ctx, BdAccount).findOne({ where: { id: accountId } });
        if (!account) return { value: null, errors: [{ path: 'accountId', code: 'notFound' }] };
        const receipt = await this.receipt(ctx, parsed.data.receiptAssetId);
        if (receipt === undefined) return { value: null, errors: [{ path: 'receiptAssetId', code: 'notFound' }] };
        const saved = await this.connection.withTransaction(ctx, async tx => {
            const repo = this.connection.getRepository(tx, BdExpense);
            const row = id ? await repo.findOne({ where: { id: this.raw(id) } }) : new BdExpense();
            if (!row) fail('not-found');
            row.day = parsed.data.day;
            row.headId = headId;
            row.amount = parsed.data.amount;
            row.accountId = accountId;
            row.note = parsed.data.note;
            row.receiptAssetId = receipt;
            const expense = await repo.save(row);
            await insertTransaction(tx, this.connection, {
                accountId,
                direction: 'out',
                amount: parsed.data.amount,
                day: parsed.data.day,
                source: 'expense',
                sourceId: String(expense.id),
                note: parsed.data.note,
                idempotencyKey: `expense:${expense.id}`,
                upsert: true,
            });
            return expense;
        });
        const [view] = await this.expenseViews(ctx, [saved]);
        return { value: view!, errors: [] };
    }

    async transfer(ctx: RequestContext, input: unknown): Promise<TransactionView[]> {
        const parsed = transferSchema.safeParse(input);
        if (!parsed.success) fail('not-found');
        const fromId = this.raw(parsed.data.fromAccountId);
        const toId = this.raw(parsed.data.toAccountId);
        if (fromId === toId) fail('same-account');
        const transferId = randomUUID().slice(0, 40);
        await this.connection.withTransaction(ctx, async tx => {
            await insertTransaction(tx, this.connection, {
                accountId: fromId,
                direction: 'out',
                amount: parsed.data.amount,
                day: parsed.data.day,
                source: 'transfer',
                note: parsed.data.note,
                transferId,
                idempotencyKey: `transfer:${transferId}:out`,
            });
            await insertTransaction(tx, this.connection, {
                accountId: toId,
                direction: 'in',
                amount: parsed.data.amount,
                day: parsed.data.day,
                source: 'transfer',
                note: parsed.data.note,
                transferId,
                idempotencyKey: `transfer:${transferId}:in`,
            });
        });
        const rows = await this.connection.getRepository(ctx, BdTransaction).find({ where: { transferId } });
        const names = await this.accountNames(ctx, rows.map(row => row.accountId));
        return rows.map(row => this.txView(row, names));
    }

    async manual(ctx: RequestContext, input: unknown): Promise<TransactionView> {
        const parsed = manualSchema.safeParse(input);
        if (!parsed.success) fail('not-found');
        const accountId = this.raw(parsed.data.accountId);
        const key = `manual:${randomUUID()}`;
        await insertTransaction(ctx, this.connection, {
            accountId,
            direction: parsed.data.direction,
            amount: parsed.data.amount,
            day: parsed.data.day,
            source: 'manual',
            note: parsed.data.note,
            idempotencyKey: key,
        });
        const row = await this.connection.getRepository(ctx, BdTransaction).findOne({ where: { idempotencyKey: key } });
        if (!row) fail('not-found');
        const names = await this.accountNames(ctx, [row.accountId]);
        return this.txView(row, names);
    }

    private filtered(
        ctx: RequestContext,
        options: { accountId?: ID | null; source?: string | null; dateFrom?: string | null; dateTo?: string | null },
    ) {
        const qb = this.connection.getRepository(ctx, BdTransaction).createQueryBuilder('tx');
        if (options.accountId) qb.andWhere('tx.accountId = :accountId', { accountId: this.raw(options.accountId) });
        if (options.source) {
            if (!(TX_SOURCES as readonly string[]).includes(options.source)) fail('not-found');
            qb.andWhere('tx.source = :source', { source: options.source });
        }
        this.applyDates(qb, 'tx.day', options.dateFrom, options.dateTo);
        return qb;
    }

    private applyDates(
        qb: { andWhere(sql: string, params: Record<string, string>): unknown },
        column: string,
        dateFrom?: string | null,
        dateTo?: string | null,
    ) {
        if (!dateFrom && !dateTo) return;
        if (!dateFrom || !dateTo || !parseCalendarDay(dateFrom) || !parseCalendarDay(dateTo) || dateFrom > dateTo) {
            fail('invalid-date');
        }
        qb.andWhere(`${column} >= :dateFrom AND ${column} <= :dateTo`, { dateFrom, dateTo });
    }

    private async nets(ctx: RequestContext, ids: ID[]): Promise<Map<string, number>> {
        const map = new Map<string, number>();
        if (!ids.length) return map;
        const rows = await this.connection
            .getRepository(ctx, BdTransaction)
            .createQueryBuilder('tx')
            .select('tx.accountId', 'accountId')
            .addSelect(`SUM(CASE WHEN tx.direction = 'in' THEN tx.amount ELSE -tx.amount END)`, 'net')
            .where('tx.accountId IN (:...ids)', { ids })
            .groupBy('tx.accountId')
            .getRawMany<{ accountId: string; net: string }>();
        for (const row of rows) map.set(String(row.accountId), Number(row.net));
        return map;
    }

    private accountView(row: BdAccount, net: number): AccountView {
        return {
            id: row.id,
            kind: row.kind,
            name: row.name,
            openingBalance: row.openingBalance,
            balance: accountBalance(row.openingBalance, net),
        };
    }

    private async accountNames(ctx: RequestContext, ids: number[]): Promise<Map<number, string>> {
        const unique = [...new Set(ids)];
        const map = new Map<number, string>();
        if (!unique.length) return map;
        const rows = await this.connection.getRepository(ctx, BdAccount).find({ where: { id: In(unique) } });
        for (const row of rows) map.set(Number(row.id), row.name);
        return map;
    }

    private txView(row: BdTransaction, names: Map<number, string>): TransactionView {
        return {
            id: row.id,
            accountId: row.accountId,
            accountName: names.get(row.accountId) ?? '',
            direction: row.direction,
            amount: row.amount,
            date: row.day,
            source: row.source,
            sourceId: row.sourceId,
            note: row.note,
            transferId: row.transferId,
        };
    }

    private async expenseViews(ctx: RequestContext, rows: BdExpense[]): Promise<ExpenseView[]> {
        const heads = await this.connection.getRepository(ctx, BdExpenseHead).find();
        const names = await this.accountNames(ctx, rows.map(row => row.accountId));
        const byHead = new Map(heads.map(head => [Number(head.id), head]));
        const bn = ctx.languageCode === 'bn';
        return rows.map(row => {
            const head = byHead.get(row.headId);
            return {
                id: row.id,
                date: row.day,
                headId: row.headId,
                headCode: head?.code ?? '',
                headName: head ? (bn ? head.nameBn : head.nameEn) : '',
                amount: row.amount,
                accountId: row.accountId,
                accountName: names.get(row.accountId) ?? '',
                note: row.note,
                receiptAssetId: row.receiptAssetId,
            };
        });
    }

    /** Null when no photo was sent. `undefined` when the id does not match an asset. */
    private async receipt(ctx: RequestContext, id: string | null | undefined): Promise<number | null | undefined> {
        if (!id) return null;
        const assetId = this.raw(id);
        const asset = await this.connection.getRepository(ctx, Asset).findOne({ where: { id: assetId } });
        return asset ? assetId : undefined;
    }

    /** A positive integer, an encoded id, or a test id (`T_1`). */
    raw(id: ID): number {
        const value = String(id);
        const direct = Number(value);
        if (Number.isInteger(direct) && direct > 0 && String(direct) === value) return direct;
        const decoded = this.config.entityIdStrategy.decodeId(value);
        if (typeof decoded === 'number' && decoded > 0) return decoded;
        const stripped = Number(value.replace(/^T_/, ''));
        if (Number.isInteger(stripped) && stripped > 0) return stripped;
        fail('not-found');
    }
}

const FIELD_CODES = new Set<string>(['required', 'tooLong', 'tooMany', 'invalid', 'notFound']);

function fieldErrors(issues: z.core.$ZodIssue[]): SettingsFieldError[] {
    return issues.map(issue => ({
        path: issue.path.join('.') || 'form',
        code: (FIELD_CODES.has(issue.message) ? issue.message : 'invalid') as SettingsFieldError['code'],
    }));
}

function headCode(nameEn: string, taken: Set<string>): string {
    const base = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'head';
    let code = base;
    let n = 2;
    while (taken.has(code)) {
        code = `${base.slice(0, 22)}${n}`;
        n += 1;
    }
    return code;
}
