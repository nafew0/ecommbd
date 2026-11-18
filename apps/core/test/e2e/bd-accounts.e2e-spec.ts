import { TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placePhoneOrder, prepareCheckout, TRANSITION } from '../support/checkout';
import { addMigrationOnlyObjects, createTestConfig, testInitialData, testProductsCsvPath } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3093;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;
const tk = (taka: number) => taka * 100;

const SET_COST = gql`
    mutation ($id: ID!, $cost: Int) {
        updateProductVariants(input: [{ id: $id, customFields: { unitCost: $cost } }]) { id }
    }
`;
const COST_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdCostSettings(input: $input) { errors { path code } }
    }
`;
const PROFIT = gql`
    query ($id: ID!) {
        bdOrderProfit(orderId: $id) {
            sellingPrice { amount known }
            discount { amount known }
            deliveryCharged { amount known }
            codFeeCharged { amount known }
            productCost { amount known }
            courierCharge { amount known }
            codCharge { amount known }
            gatewayFee { amount known }
            profit { amount known }
        }
    }
`;
const REPORT = gql`
    query ($dateFrom: String!, $dateTo: String!) {
        bdProfitAndLoss(dateFrom: $dateFrom, dateTo: $dateTo) {
            sales { known amount }
            productCost { known amount }
            deliveryAndCod { known amount }
            gatewayFees { known amount }
            expenseTotal
            profit { known amount }
            previousProfit { known amount }
            expensesByHead { code amount }
            notes { orderCode saleDate returnDate }
        }
    }
`;
const SAVE_ACCOUNT = gql`
    mutation ($input: JSON!) {
        saveBdAccount(input: $input) { errors { path code } account { id name balance } }
    }
`;
const SAVE_EXPENSE = gql`
    mutation ($input: JSON!) {
        saveBdExpense(input: $input) { errors { path code } expense { id headCode amount } }
    }
`;

let phone = 1711092000;
const nextPhone = () => `+880${phone++}`;

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const saved = await adminClient.query(COST_SETTINGS, {
        input: { courierFlat: 0, codCharge: { type: 'flat', flat: 0, percent: null }, gatewayFeePercent: 0 },
    });
    expect(saved.updateBdCostSettings.errors).toEqual([]);
    await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

async function sql(text: string, parameters: unknown[] = []) {
    return server.app.get(TransactionalConnection).rawConnection.query(text, parameters) as Promise<
        Array<Record<string, unknown>>
    >;
}

async function place(quantity = 1) {
    return placePhoneOrder(shopClient, { phone: nextPhone(), area: 'Mirpur 10', quantity });
}

async function profitOf(id: string) {
    return (await adminClient.query(PROFIT, { id })).bdOrderProfit as {
        sellingPrice: { amount: number; known: boolean };
        discount: { amount: number; known: boolean };
        deliveryCharged: { amount: number; known: boolean };
        codFeeCharged: { amount: number; known: boolean };
        productCost: { amount: number; known: boolean };
        courierCharge: { amount: number; known: boolean };
        codCharge: { amount: number; known: boolean };
        gatewayFee: { amount: number; known: boolean };
        profit: { amount: number | null; known: boolean };
    };
}

async function report(dateFrom: string, dateTo: string) {
    return (await adminClient.query(REPORT, { dateFrom, dateTo })).bdProfitAndLoss as {
        sales: { known: boolean; amount: number | null };
        productCost: { known: boolean; amount: number | null };
        deliveryAndCod: { known: boolean; amount: number | null };
        gatewayFees: { known: boolean; amount: number | null };
        expenseTotal: number;
        profit: { known: boolean; amount: number | null };
        previousProfit: { known: boolean; amount: number | null };
        expensesByHead: Array<{ code: string; amount: number }>;
        notes: Array<{ orderCode: string; saleDate: string; returnDate: string }>;
    };
}

async function rawOrder(id: string) {
    const { order } = await adminClient.query(
        gql`query ($id: ID!) { order(id: $id) { id code lines { id } } }`,
        { id },
    );
    const rows = await sql(`SELECT id FROM "order" WHERE code = $1`, [order.code]);
    return { id: order.id as string, code: order.code as string, lineId: order.lines[0].id as string, rawId: Number(rows[0]!.id) };
}

async function step(id: string, name: string) {
    const result = await adminClient.query(
        gql`
            mutation ($id: ID!) {
                ${name}(input: { orderId: $id }) {
                    ... on Order { bd { status } }
                    ... on BdOrderActionError { reason message }
                }
            }
        `,
        { id },
    );
    const payload = result[name];
    if (payload.reason) throw new Error(`${name}: ${payload.reason} ${payload.message}`);
}

async function deliver(id: string) {
    await step(id, 'confirmBdOrder');
    await step(id, 'packBdOrder');
    await step(id, 'markBdOrderShipped');
    await step(id, 'markBdOrderDelivered');
}

async function deliverSome(lineId: string, quantity: number) {
    const added = await adminClient.query(
        gql`
            mutation ($lineId: ID!, $quantity: Int!) {
                addFulfillmentToOrder(input: {
                    lines: [{ orderLineId: $lineId, quantity: $quantity }]
                    handler: { code: "manual-fulfillment", arguments: [
                        { name: "method", value: "Manual" }
                        { name: "trackingCode", value: "partial" }
                    ] }
                }) {
                    ... on Fulfillment { id }
                    ... on ErrorResult { errorCode message }
                }
            }
        `,
        { lineId, quantity },
    );
    const fulfillment = added.addFulfillmentToOrder;
    if (fulfillment.message) throw new Error(fulfillment.message);
    for (const state of ['Shipped', 'Delivered']) {
        const moved = await adminClient.query(
            gql`
                mutation ($id: ID!, $state: String!) {
                    transitionFulfillmentToState(id: $id, state: $state) {
                        ... on Fulfillment { state }
                        ... on FulfillmentStateTransitionError { transitionError }
                    }
                }
            `,
            { id: fulfillment.id, state },
        );
        if (moved.transitionFulfillmentToState.transitionError) {
            throw new Error(moved.transitionFulfillmentToState.transitionError);
        }
    }
}

async function backdate(rawId: number, to: string, at: string) {
    const updated = await sql(
        `UPDATE history_entry SET "createdAt" = $1, "updatedAt" = $1
         WHERE "orderId" = $2 AND type = 'ORDER_STATE_TRANSITION' AND (data::jsonb->>'to') = $3`,
        [at, rawId, to],
    );
    return updated;
}

async function account(name: string, opening = 0) {
    const saved = await adminClient.query(SAVE_ACCOUNT, {
        input: { name, kind: 'cash', openingBalance: opening },
    });
    expect(saved.saveBdAccount.errors).toEqual([]);
    return saved.saveBdAccount.account as { id: string; balance: number };
}

async function head(code: string) {
    const { bdExpenseHeads } = await adminClient.query(gql`
        { bdExpenseHeads { id code } }
    `);
    const found = bdExpenseHeads.find((row: { code: string }) => row.code === code);
    if (!found) throw new Error(`missing head ${code}`);
    return found.id as string;
}

describe('profit and loss for a month', () => {
    it('matches the notebook: delivered sales minus cost, charges and expenses', async () => {
        const placed = await place();
        await deliver(placed.id);
        const profit = await profitOf(placed.id);
        expect(profit.profit.known).toBe(true);
        expect(profit.productCost).toMatchObject({ known: true, amount: tk(400) });
        const row = await rawOrder(placed.id);
        await backdate(row.rawId, 'Delivered', '2026-08-15 06:00:00');

        const cash = await account('ক্যাশ', tk(1000));
        const rent = await adminClient.query(SAVE_EXPENSE, {
            input: { day: '2026-08-20', headId: await head('rent'), amount: tk(100), accountId: cash.id, note: '' },
        });
        expect(rent.saveBdExpense.errors).toEqual([]);
        const ads = await adminClient.query(SAVE_EXPENSE, {
            input: { day: '2026-08-21', headId: await head('ads'), amount: tk(50), accountId: cash.id, note: 'ফেসবুক' },
        });
        expect(ads.saveBdExpense.expense.headCode).toBe('ads');

        const august = await report('2026-08-01', '2026-08-31');
        const sales =
            profit.sellingPrice.amount -
            profit.discount.amount +
            profit.deliveryCharged.amount +
            profit.codFeeCharged.amount;
        expect(august.sales).toEqual({ known: true, amount: sales });
        expect(august.productCost).toEqual({ known: true, amount: profit.productCost.amount });
        expect(august.deliveryAndCod).toEqual({
            known: true,
            amount: profit.courierCharge.amount + profit.codCharge.amount,
        });
        expect(august.gatewayFees).toEqual({ known: true, amount: profit.gatewayFee.amount });
        expect(august.expenseTotal).toBe(tk(150));
        expect(august.expensesByHead).toEqual(
            expect.arrayContaining([
                { code: 'rent', amount: tk(100) },
                { code: 'ads', amount: tk(50) },
            ]),
        );
        expect(august.profit).toEqual({ known: true, amount: profit.profit.amount! - tk(150) });
        expect(august.previousProfit).toEqual({ known: true, amount: 0 });
        expect(august.notes).toEqual([]);

        const bank = await account('ব্যাংক', tk(500));
        const before = august.profit.amount;
        await adminClient.query(
            gql`mutation ($input: JSON!) { transferBdMoney(input: $input) { id } }`,
            { input: { fromAccountId: cash.id, toAccountId: bank.id, amount: tk(20), day: '2026-11-18', note: '' } },
        );
        expect((await report('2026-08-01', '2026-08-31')).profit.amount).toBe(before);
        const { bdAccount } = await adminClient.query(gql`query ($id: ID!) { bdAccount(id: $id) { balance } }`, {
            id: cash.id,
        });
        // Opening 1000, rent 100, ads 50, transfer 20 out.
        expect(bdAccount.balance).toBe(tk(1000) - tk(150) - tk(20));
    });

    it('counts a return in the month it happens, and leaves the closed month as it was', async () => {
        const placed = await place(2);
        await step(placed.id, 'confirmBdOrder');
        await step(placed.id, 'packBdOrder');
        const row = await rawOrder(placed.id);
        await deliverSome(row.lineId, 1);
        const sale = await profitOf(placed.id);
        expect(sale.profit.known).toBe(true);
        expect(sale.profit.amount).not.toBe(0);
        await backdate(row.rawId, 'PartiallyDelivered', '2026-06-10 06:00:00');
        await step(placed.id, 'markBdOrderReturned');
        await backdate(row.rawId, 'Returned', '2026-09-04 06:00:00');

        const june = await report('2026-06-01', '2026-06-30');
        expect(june.profit).toEqual({ known: true, amount: sale.profit.amount });
        expect(june.notes).toEqual([]);

        const september = await report('2026-09-01', '2026-09-30');
        const sold =
            sale.sellingPrice.amount - sale.discount.amount + sale.deliveryCharged.amount + sale.codFeeCharged.amount;
        // The return gives back the sale and the goods; the courier and COD charges were still paid.
        expect(september.sales.amount).toBe(-sold);
        expect(september.productCost.amount).toBe(-(sale.productCost.amount ?? 0));
        expect(september.profit).toEqual({ known: true, amount: -(sold - (sale.productCost.amount ?? 0)) });
        expect(september.notes).toEqual([
            { orderCode: row.code, saleDate: '2026-06-10', returnDate: '2026-09-04' },
        ]);
    });

    it('counts the courier charge of an order that came back undelivered, on the return day', async () => {
        const settings = (courierFlat: number) =>
            adminClient.query(COST_SETTINGS, {
                input: { courierFlat, codCharge: { type: 'flat', flat: 0, percent: null }, gatewayFeePercent: 0 },
            });
        await settings(tk(70));
        try {
            const placed = await place();
            await step(placed.id, 'confirmBdOrder');
            await step(placed.id, 'packBdOrder');
            await step(placed.id, 'markBdOrderShipped');
            await step(placed.id, 'markBdOrderReturned');
            const row = await rawOrder(placed.id);
            await backdate(row.rawId, 'Returned', '2026-04-12 06:00:00');

            const april = await report('2026-04-01', '2026-04-30');
            expect(april.sales).toEqual({ known: true, amount: 0 });
            expect(april.productCost).toEqual({ known: true, amount: 0 });
            expect(april.deliveryAndCod).toEqual({ known: true, amount: tk(70) });
            expect(april.profit).toEqual({ known: true, amount: -tk(70) });
        } finally {
            await settings(0);
        }
    });

    it('shows unknown, never ৳0, when a delivered order has no cost', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: null });
        try {
            const placed = await place();
            await deliver(placed.id);
            const row = await rawOrder(placed.id);
            await backdate(row.rawId, 'Delivered', '2026-05-02 06:00:00');
            const may = await report('2026-05-01', '2026-05-03');
            expect(may.profit).toEqual({ known: false, amount: null });
            expect(may.productCost.known).toBe(false);
            expect(JSON.stringify(may.profit)).not.toContain('"amount":0');
        } finally {
            await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
        }
    });
});

describe('the ledger', () => {
    it('posts a settled cash-on-delivery payment into the mapped account, once', async () => {
        const drawer = await account('সিওডি ক্যাশ');
        await adminClient.query(
            gql`mutation ($input: JSON!) { updateBdAccountSettings(input: $input) { errors { path } } }`,
            {
                input: {
                    codAccountId: drawer.id,
                    gatewayAccountId: null,
                    bkashAccountId: null,
                    nagadAccountId: null,
                    rocketAccountId: null,
                },
            },
        );
        await shopClient.asAnonymousUser();
        await prepareCheckout(shopClient, { phone: nextPhone(), area: 'Mirpur 10' });
        const moved = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
        expect(moved.transitionOrderToState.state).toBe('ArrangingPayment');
        const paid = await shopClient.query(
            gql`
                mutation ($input: PaymentInput!) {
                    addPaymentToOrder(input: $input) {
                        ... on Order { id code payments { method state } }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input: { method: 'bd-cod', metadata: {} } },
        );
        if (paid.addPaymentToOrder.errorCode) throw new Error(paid.addPaymentToOrder.message);
        const orderId = paid.addPaymentToOrder.id as string;
        await deliver(orderId);
        let found = false;
        for (let attempt = 0; attempt < 40 && !found; attempt++) {
            const { bdTransactions } = await adminClient.query(
                gql`query ($id: ID!) { bdTransactions(accountId: $id, source: "order", take: 10) { totalItems } }`,
                { id: drawer.id },
            );
            found = bdTransactions.totalItems >= 1;
            if (!found) await new Promise(resolve => setTimeout(resolve, 250));
        }
        expect(found).toBe(true);
        const rows = await sql(
            `SELECT COUNT(*)::int AS count FROM bd_transaction WHERE "idempotencyKey" LIKE 'payment:%' AND "accountId" = $1`,
            [Number(String(drawer.id).replace(/^T_/, ''))],
        );
        expect(Number(rows[0]!.count)).toBe(1);
    });

    it('takes a supplier payment out of the chosen account, and not when none is chosen', async () => {
        const drawer = await account('সাপ্লায়ার ক্যাশ', tk(800));
        const supplier = await adminClient.query(
            gql`mutation ($input: JSON!) { createBdSupplier(input: $input) { supplier { id } errors { path } } }`,
            { input: { name: 'করিম', phone: '', address: '', note: '' } },
        );
        await adminClient.query(
            gql`mutation ($input: JSON!) { recordBdSupplierPayment(input: $input) { id } }`,
            {
                input: {
                    supplierId: supplier.createBdSupplier.supplier.id,
                    amount: tk(80),
                    paidOn: '2026-08-22',
                    note: '',
                    accountId: drawer.id,
                },
            },
        );
        const { bdAccount } = await adminClient.query(gql`query ($id: ID!) { bdAccount(id: $id) { balance } }`, {
            id: drawer.id,
        });
        expect(bdAccount.balance).toBe(tk(720));
        const listed = await adminClient.query(
            gql`query ($id: ID!) { bdTransactions(accountId: $id, source: "purchase") { totalItems } }`,
            { id: drawer.id },
        );
        expect(listed.bdTransactions.totalItems).toBe(1);

        const other = await adminClient.query(
            gql`mutation ($input: JSON!) { createBdSupplier(input: $input) { supplier { id } } }`,
            { input: { name: 'জামাল', phone: '', address: '', note: '' } },
        );
        await adminClient.query(
            gql`mutation ($input: JSON!) { recordBdSupplierPayment(input: $input) { id } }`,
            {
                input: {
                    supplierId: other.createBdSupplier.supplier.id,
                    amount: tk(10),
                    paidOn: '2026-08-22',
                    note: '',
                },
            },
        );
        const again = await adminClient.query(gql`query ($id: ID!) { bdAccount(id: $id) { balance } }`, {
            id: drawer.id,
        });
        expect(again.bdAccount.balance).toBe(tk(720));
    });

    it('exports the filtered ledger and refuses a transfer into the same account', async () => {
        const drawer = await account('এক্সপোর্ট');
        await adminClient.query(
            gql`mutation ($input: JSON!) { recordBdManualEntry(input: $input) { id } }`,
            { input: { accountId: drawer.id, direction: 'in', amount: tk(5), day: '2026-04-01', note: '=cmd' } },
        );
        const { bdTransactionsCsv } = await adminClient.query(
            gql`query ($id: ID!) { bdTransactionsCsv(accountId: $id, dateFrom: "2026-04-01", dateTo: "2026-04-01") }`,
            { id: drawer.id },
        );
        expect(String(bdTransactionsCsv).startsWith('\uFEFF')).toBe(true);
        expect(String(bdTransactionsCsv)).toContain(`'=cmd`);
        await expect(
            adminClient.query(gql`mutation ($input: JSON!) { transferBdMoney(input: $input) { id } }`, {
                input: { fromAccountId: drawer.id, toAccountId: drawer.id, amount: tk(1), day: '2026-04-02', note: '' },
            }),
        ).rejects.toThrow(/account|অ্যাকাউন্ট/i);
        await expect(adminClient.query(REPORT, { dateFrom: '2026-13-01', dateTo: '2026-13-02' })).rejects.toThrow();
    });
});

describe('ManageAccounts', () => {
    it('gives it to the owner only, and refuses everyone else', async () => {
        const { roles } = await adminClient.query(gql`
            { roles(options: { take: 20 }) { items { code permissions } } }
        `);
        const of = (code: string) =>
            roles.items.find((role: { code: string }) => role.code === code).permissions as string[];
        expect(of('owner')).toContain('ManageAccounts');
        for (const code of ['manager', 'order-staff', 'packer', 'marketing']) {
            expect(of(code)).not.toContain('ManageAccounts');
        }
        const staff = await staffClient('orders.accounts@example.com', 'order-staff');
        await expect(staff.query(gql`{ bdAccounts { totalItems } }`)).rejects.toThrow(/authorized/i);
        await expect(staff.query(REPORT, { dateFrom: '2026-08-01', dateTo: '2026-08-31' })).rejects.toThrow(/authorized/i);
    });
});

async function staffClient(email: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        { roles(options: { take: 20 }) { items { id code } } }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
    await adminClient.query(
        gql`
            mutation ($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) { id }
            }
        `,
        {
            input: {
                firstName: 'Staff',
                lastName: 'Accounts',
                emailAddress: email,
                password: 'staff-password-123',
                roleIds: [role.id],
            },
        },
    );
    const client = new SimpleGraphQLClient(config, adminUrl);
    await client.asUserWithCredentials(email, 'staff-password-123');
    return client;
}
