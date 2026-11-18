import { describe, expect, it } from 'vitest';
import {
    accountBalance,
    ACCOUNT_KINDS,
    csvDocument,
    DEFAULT_EXPENSE_HEADS,
    defaultAccountSettings,
    dhakaDayKeys,
    parseAccountSettings,
    plMovement,
    previousDhakaRange,
    profitAndLoss,
    type PlExpense,
    type PlMovement,
} from './accounts';
import type { MoneyPart, OrderProfit } from './cost';

const money = (amount: number | null, known = amount != null): MoneyPart => ({
    amount,
    known,
    source: 'order',
    detail: null,
});

function orderProfit(over: Partial<OrderProfit> = {}): OrderProfit {
    return {
        sellingPrice: money(50000),
        discount: money(0),
        deliveryCharged: money(6000),
        codFeeCharged: money(0),
        productCost: money(20000),
        courierCharge: money(0),
        codCharge: money(0),
        gatewayFee: money(0),
        profit: money(36000),
        belowCost: false,
        lines: [],
        ...over,
    };
}

const sale = (over: Partial<PlMovement> = {}): PlMovement => ({
    orderCode: 'MF-1001',
    saleDate: '2026-10-15',
    returnDate: null,
    sales: 56000,
    productCost: 20000,
    deliveryAndCod: 0,
    gatewayFee: 0,
    ...over,
});

describe('account settings and balance', () => {
    it('lists the four kinds and the seven default heads', () => {
        expect(ACCOUNT_KINDS).toEqual(['cash', 'bank', 'wallet', 'courier']);
        expect(DEFAULT_EXPENSE_HEADS.map(head => head.code)).toEqual([
            'rent',
            'salary',
            'ads',
            'packaging',
            'delivery',
            'utilities',
            'other',
        ]);
        expect(defaultAccountSettings()).toEqual({
            codAccountId: null,
            gatewayAccountId: null,
            bkashAccountId: null,
            nagadAccountId: null,
            rocketAccountId: null,
        });
    });

    it('keeps an empty account id as not set, and refuses a broken value', () => {
        const saved = parseAccountSettings({
            codAccountId: 'T_4',
            gatewayAccountId: '',
            bkashAccountId: null,
            nagadAccountId: '  ',
            rocketAccountId: 'T_9',
        });
        expect(saved).toEqual({
            ok: true,
            settings: {
                codAccountId: 'T_4',
                gatewayAccountId: null,
                bkashAccountId: null,
                nagadAccountId: null,
                rocketAccountId: 'T_9',
            },
        });
        const refused = parseAccountSettings({ codAccountId: 'x'.repeat(41) });
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.errors.length).toBeGreaterThan(0);
    });

    it('adds movements to the opening balance, and allows a negative result', () => {
        expect(accountBalance(10000, 2500)).toBe(12500);
        expect(accountBalance(1000, -4000)).toBe(-3000);
    });
});

describe('Dhaka ranges', () => {
    it('lists each day, and the previous period of the same length', () => {
        expect(dhakaDayKeys('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
        expect(dhakaDayKeys('2026-10-15', '2026-10-15')).toEqual(['2026-10-15']);
        expect(previousDhakaRange('2026-10-01', '2026-10-31')).toEqual({
            dateFrom: '2026-08-31',
            dateTo: '2026-09-30',
        });
        expect(previousDhakaRange('2026-10-15', '2026-10-15')).toEqual({
            dateFrom: '2026-10-14',
            dateTo: '2026-10-14',
        });
    });

    it('refuses a day that is not real, a backwards range, and more than 366 days', () => {
        expect(dhakaDayKeys('2026-02-31', '2026-03-01')).toBeNull();
        expect(dhakaDayKeys('15-10-2026', '2026-10-16')).toBeNull();
        expect(dhakaDayKeys('2026-10-16', '2026-10-15')).toBeNull();
        expect(dhakaDayKeys('2025-01-01', '2026-01-02')).toBeNull();
        expect(dhakaDayKeys('2025-01-01', '2026-01-01')).toHaveLength(366);
        expect(previousDhakaRange('nope', '2026-10-01')).toBeNull();
    });
});

describe('profit and loss', () => {
    const days = ['2026-10-01', '2026-10-15', '2026-10-20'];

    it('turns a delivered order into sales, cost and charges', () => {
        const movement = plMovement(orderProfit(), {
            orderCode: 'MF-1001',
            saleDate: '2026-10-15',
            returnDate: null,
        });
        expect(movement.sales).toBe(56000);
        expect(movement.productCost).toBe(20000);
        expect(movement.deliveryAndCod).toBe(0);
        expect(movement.gatewayFee).toBe(0);

        const unknown = plMovement(
            orderProfit({ productCost: money(null, false), courierCharge: { amount: null, known: true, source: 'order', detail: null } }),
            { orderCode: 'MF-1002', saleDate: '2026-10-15', returnDate: null },
        );
        expect(unknown.productCost).toBeNull();
        expect(unknown.deliveryAndCod).toBeNull();
        expect(unknown.sales).toBe(56000);

        const broken = plMovement(orderProfit({ sellingPrice: money(null, false) }), {
            orderCode: 'MF-1003',
            saleDate: '2026-10-15',
            returnDate: null,
        });
        expect(broken.sales).toBeNull();
    });

    it('matches the notebook: sales − cost − charges − expenses', () => {
        const expenses: PlExpense[] = [
            { date: '2026-10-20', headCode: 'rent', amount: 10000 },
            { date: '2026-10-20', headCode: 'ads', amount: 5000 },
            { date: '2026-11-01', headCode: 'rent', amount: 99999 },
        ];
        const report = profitAndLoss({ days, movements: [sale()], expenses });
        expect(report.sales).toEqual({ known: true, amount: 56000 });
        expect(report.productCost).toEqual({ known: true, amount: 20000 });
        expect(report.deliveryAndCod).toEqual({ known: true, amount: 0 });
        expect(report.gatewayFees).toEqual({ known: true, amount: 0 });
        expect(report.expenseTotal).toBe(15000);
        expect(report.expensesByHead).toEqual([
            { headCode: 'rent', amount: 10000 },
            { headCode: 'ads', amount: 5000 },
        ]);
        expect(report.profit).toEqual({ known: true, amount: 21000 });
        expect(report.days.find(day => day.date === '2026-10-15')).toEqual({
            date: '2026-10-15',
            sales: 56000,
            profit: 36000,
        });
        expect(report.days.find(day => day.date === '2026-10-01')).toEqual({
            date: '2026-10-01',
            sales: 0,
            profit: 0,
        });
        expect(report.notes).toEqual([]);
    });

    it('puts a later return in the month it happens, and leaves the closed month alone', () => {
        const october = profitAndLoss({
            days,
            movements: [sale({ returnDate: '2026-11-05' })],
            expenses: [],
        });
        expect(october.profit.amount).toBe(36000);
        expect(october.notes).toEqual([]);

        const november = profitAndLoss({
            days: ['2026-11-01', '2026-11-05'],
            movements: [sale({ returnDate: '2026-11-05' })],
            expenses: [],
        });
        expect(november.sales.amount).toBe(-56000);
        expect(november.productCost.amount).toBe(-20000);
        expect(november.profit.amount).toBe(-36000);
        expect(november.notes).toEqual([
            { orderCode: 'MF-1001', saleDate: '2026-10-15', returnDate: '2026-11-05' },
        ]);

        const both = profitAndLoss({
            days: ['2026-10-15', '2026-11-05'],
            movements: [sale({ returnDate: '2026-11-05' })],
            expenses: [],
        });
        expect(both.profit.amount).toBe(0);
        expect(both.notes).toEqual([]);
    });

    it('keeps the courier, COD and gateway charges when an order comes back', () => {
        const report = profitAndLoss({
            days: ['2026-10-15', '2026-11-05'],
            movements: [sale({ deliveryAndCod: 8000, gatewayFee: 500, returnDate: '2026-11-05' })],
            expenses: [],
        });
        expect(report.sales.amount).toBe(0);
        expect(report.productCost.amount).toBe(0);
        expect(report.deliveryAndCod.amount).toBe(8000);
        expect(report.gatewayFees.amount).toBe(500);
        expect(report.profit.amount).toBe(-8500);
    });

    it('counts an order that came back undelivered as its charges only', () => {
        const report = profitAndLoss({
            days,
            movements: [sale({ saleDate: '2026-10-20', sales: 0, productCost: 0, deliveryAndCod: 7000 })],
            expenses: [],
        });
        expect(report.sales.amount).toBe(0);
        expect(report.profit.amount).toBe(-7000);
    });

    it('keeps an unknown cost unknown, never zero, and sorts extra heads after the defaults', () => {
        const report = profitAndLoss({
            days,
            movements: [sale({ productCost: null, gatewayFee: 100 })],
            expenses: [
                { date: '2026-10-20', headCode: 'zebra', amount: 200 },
                { date: '2026-10-20', headCode: 'alpha', amount: 100 },
                { date: '2026-10-15', headCode: 'rent', amount: 300 },
            ],
        });
        expect(report.productCost).toEqual({ known: false, amount: null });
        expect(report.profit).toEqual({ known: false, amount: null });
        expect(report.gatewayFees).toEqual({ known: true, amount: 100 });
        expect(report.days.find(day => day.date === '2026-10-15')!.profit).toBeNull();
        expect(report.expensesByHead.map(row => row.headCode)).toEqual(['rent', 'alpha', 'zebra']);
        expect(JSON.stringify(report.profit)).not.toContain('"amount":0');
    });

    it('is unchanged by a range with no orders', () => {
        const report = profitAndLoss({ days: ['2026-10-01'], movements: [], expenses: [] });
        expect(report.profit).toEqual({ known: true, amount: 0 });
        expect(report.expensesByHead).toEqual([]);
    });
});

describe('csv', () => {
    it('writes a BOM and stops a spreadsheet treating a cell as a formula', () => {
        const csv = csvDocument(
            ['Date', 'Note'],
            [
                ['2026-10-15', 'rent'],
                ['2026-10-16', '=cmd'],
                ['2026-10-17', '+1'],
                ['2026-10-18', '-1'],
                ['2026-10-19', '@sum'],
                ['2026-10-20', '\thidden'],
                ['2026-10-21', 'a, "b"'],
                ['2026-10-22', 'line\nbreak'],
            ],
        );
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain('2026-10-15,rent');
        expect(csv).toContain(`"'=cmd"`);
        expect(csv).toContain(`"'+1"`);
        expect(csv).toContain(`"'-1"`);
        expect(csv).toContain(`"'@sum"`);
        expect(csv).toContain(`"'\thidden"`);
        expect(csv).toContain('"a, ""b"""');
        expect(csv).toContain('"line\nbreak"');
    });
});
