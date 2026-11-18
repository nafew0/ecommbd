import {
    dhakaDateKey,
    dhakaDayKeys,
    endOfDhakaDay,
    fromDhaka,
    plMovement,
    previousDhakaRange,
    profitAndLoss,
    type PlExpense,
    type PlMovement,
    type PlPiece,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { Order, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { In } from 'typeorm';
import { CostService } from '../bd-cost/cost.service';
import { BdExpense, BdExpenseHead } from './entities';

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
/** The order dashboard refuses a range longer than this (order-list.service.ts). */
const MAX_DASHBOARD_DAYS = 366;

export interface ProfitReport {
    dateFrom: string;
    dateTo: string;
    previousFrom: string;
    previousTo: string;
    sales: PlPiece;
    productCost: PlPiece;
    deliveryAndCod: PlPiece;
    gatewayFees: PlPiece;
    expensesByHead: Array<{ code: string; name: string; amount: number }>;
    expenseTotal: number;
    profit: PlPiece;
    previousProfit: PlPiece;
    days: Array<{ date: string; sales: number | null; profit: number | null }>;
    notes: Array<{ orderCode: string; saleDate: string; returnDate: string }>;
}

interface HistoryEvent {
    orderId: string;
    at: number;
    to: string;
    day: string;
}

/**
 * Profit and loss for a Dhaka date range (phase 53). Phase 41's report list is not built,
 * so this report is its own screen. The numbers are phase 51's `orderProfit`, recognized on
 * the delivery day and reversed on a later return day. Transfers are not included.
 */
@Injectable()
export class ReportService {
    constructor(
        private connection: TransactionalConnection,
        private costs: CostService,
    ) {}

    async profitAndLoss(ctx: RequestContext, dateFrom: string, dateTo: string): Promise<ProfitReport> {
        const days = assertDhakaRange(dateFrom, dateTo);
        const previous = previousDhakaRange(dateFrom, dateTo);
        if (!previous) throw new UserInputError('message.bd-accounts.invalid-date');
        const previousDays = assertDhakaRange(previous.dateFrom, previous.dateTo);
        const windowFrom = previousDays[0]!;
        const windowTo = days[days.length - 1]!;
        const movements = await this.movements(ctx, windowFrom, windowTo);
        const expenses = await this.expenses(ctx, windowFrom, windowTo);
        const current = profitAndLoss({ days, movements, expenses });
        const before = profitAndLoss({ days: previousDays, movements, expenses });
        const heads = await this.connection.getRepository(ctx, BdExpenseHead).find();
        const bn = ctx.languageCode === 'bn';
        const nameOf = new Map(heads.map(head => [head.code, bn ? head.nameBn : head.nameEn]));
        return {
            dateFrom,
            dateTo,
            previousFrom: previous.dateFrom,
            previousTo: previous.dateTo,
            sales: current.sales,
            productCost: current.productCost,
            deliveryAndCod: current.deliveryAndCod,
            gatewayFees: current.gatewayFees,
            expensesByHead: current.expensesByHead.map(row => ({
                code: row.headCode,
                name: nameOf.get(row.headCode) ?? row.headCode,
                amount: row.amount,
            })),
            expenseTotal: current.expenseTotal,
            profit: current.profit,
            previousProfit: before.profit,
            days: current.days,
            notes: current.notes,
        };
    }

    private async movements(ctx: RequestContext, windowFrom: string, windowTo: string): Promise<PlMovement[]> {
        const grouped = await this.history();
        const wanted = [...grouped.values()].filter(events => {
            const sale = recognize(events);
            if (!sale) return false;
            const back = events.find(event => event.to === 'Returned' && event.at > sale.at);
            return inWindow(sale.day, windowFrom, windowTo) || (back != null && inWindow(back.day, windowFrom, windowTo));
        });
        const movements: PlMovement[] = [];
        if (!wanted.length) return movements;
        const orders = await this.connection.getRepository(ctx, Order).find({
            where: { id: In(wanted.map(events => events[0]!.orderId)) },
        });
        const codes = new Map(orders.map(order => [String(order.id), order.code]));
        for (const events of wanted) {
            const sale = recognize(events);
            if (!sale) continue;
            if (!codes.has(sale.orderId)) continue;
            const back = events.find(event => event.to === 'Returned' && event.at > sale.at);
            const mode = events.some(event => event.to === 'Delivered') ? 'delivered' : 'partial';
            const profit = await this.costs.recognized(ctx, sale.orderId, mode);
            movements.push(
                plMovement(profit, {
                    orderCode: codes.get(sale.orderId) ?? sale.orderId,
                    saleDate: sale.day,
                    returnDate: back?.day ?? null,
                }),
            );
        }
        return movements;
    }

    /** Delivery and return transitions. The payload key `to` is what the order e2e reads. */
    private async history(): Promise<Map<string, HistoryEvent[]>> {
        const rows: Array<{ orderId: string | number; at: Date | string; data: unknown }> = await this.connection
            .rawConnection.query(
                `SELECT h."orderId" AS "orderId", h."createdAt" AS "at", h.data AS "data"
                 FROM history_entry h
                 WHERE h.discriminator = 'OrderHistoryEntry'
                   AND h.type = 'ORDER_STATE_TRANSITION'
                   AND (h.data::jsonb->>'to') IN ('Delivered', 'PartiallyDelivered', 'Returned')`,
            );
        const grouped = new Map<string, HistoryEvent[]>();
        for (const row of rows) {
            const to = historyTo(row.data);
            if (!to) continue;
            const at = row.at instanceof Date ? row.at : new Date(row.at);
            if (Number.isNaN(at.getTime())) continue;
            const orderId = String(row.orderId);
            const list = grouped.get(orderId) ?? [];
            list.push({ orderId, at: at.getTime(), to, day: dhakaDateKey(at) });
            grouped.set(orderId, list);
        }
        for (const list of grouped.values()) list.sort((a, b) => a.at - b.at);
        return grouped;
    }

    private async expenses(ctx: RequestContext, windowFrom: string, windowTo: string): Promise<PlExpense[]> {
        const rows = await this.connection
            .getRepository(ctx, BdExpense)
            .createQueryBuilder('expense')
            .where('expense.day >= :from AND expense.day <= :to', { from: windowFrom, to: windowTo })
            .getMany();
        const heads = await this.connection.getRepository(ctx, BdExpenseHead).find();
        const codes = new Map(heads.map(head => [Number(head.id), head.code]));
        return rows.map(row => ({
            date: row.day,
            headCode: codes.get(row.headId) ?? '',
            amount: row.amount,
        }));
    }
}

function recognize(events: HistoryEvent[]): HistoryEvent | undefined {
    return events.find(event => event.to === 'Delivered') ?? events.find(event => event.to === 'PartiallyDelivered');
}

function inWindow(day: string, from: string, to: string): boolean {
    return day >= from && day <= to;
}

function historyTo(data: unknown): string | null {
    const parsed = typeof data === 'string' ? parseJson(data) : data;
    if (!parsed || typeof parsed !== 'object' || !('to' in parsed)) return null;
    const to = (parsed as { to?: unknown }).to;
    return to === 'Delivered' || to === 'PartiallyDelivered' || to === 'Returned' ? to : null;
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

/**
 * The same day bounds as `OrderListService.dashboard` in bd-orders/order-list.service.ts.
 * `dhakaDayStart` is private there, so it is copied. Dhaka has no daylight saving time.
 */
function assertDhakaRange(dateFrom: string, dateTo: string): string[] {
    const keys = dhakaDayKeys(dateFrom, dateTo);
    if (!keys) throw new UserInputError('message.bd-accounts.invalid-date');
    const start = dhakaDayStart(dateFrom);
    const end = endOfDhakaDay(dhakaDayStart(dateTo));
    const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (dayCount < 1 || dayCount > MAX_DASHBOARD_DAYS || dayCount !== keys.length) {
        throw new UserInputError('message.bd-accounts.invalid-date');
    }
    return Array.from({ length: dayCount }, (_, index) =>
        new Date(start.getTime() + index * DAY_MS + DHAKA_OFFSET_MS).toISOString().slice(0, 10),
    );
}

function dhakaDayStart(date: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new UserInputError('message.bd-accounts.invalid-date');
    return fromDhaka(Number(match[1]), Number(match[2]), Number(match[3]));
}
