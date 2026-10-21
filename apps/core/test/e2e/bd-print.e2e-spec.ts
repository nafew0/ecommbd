import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADD_ITEM, placePhoneOrder, SET_CUSTOMER } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3057;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;

const PRINT_DATA = gql`
    query ($ids: [ID!]!, $document: String!) {
        bdPrintData(orderIds: $ids, document: $document) {
            document
            orders {
                id
                orderNumber
                placedAt
                customerName
                phone
                alternatePhone
                streetLine1
                area
                districtId
                thanaId
                note
                lines {
                    name
                    sku
                    quantity
                    unitPrice
                    linePrice
                }
                subtotal
                discount
                delivery
                total
                paid
                codDue
                paymentType
                paymentMethods
                printedAt
                courierConsignment
            }
            store {
                name {
                    bn
                    en
                }
                phones
                returnPolicy {
                    en
                }
            }
            settings
        }
    }
`;

const MARK = gql`
    mutation ($ids: [ID!]!, $document: String!) {
        markBdOrdersPrinted(orderIds: $ids, document: $document)
    }
`;

let phoneCounter = 0;
const nextPhone = () => `0191${String(++phoneCounter).padStart(7, '0')}`;

async function newOrder(input: { variantId?: string; quantity?: number; note?: string } = {}) {
    return placePhoneOrder(shopClient, { phone: nextPhone(), area: 'Mirpur 10', ...input });
}

async function staffClient(email: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        {
            roles(options: { take: 50 }) {
                items {
                    id
                    code
                }
            }
        }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
    await adminClient.query(
        gql`
            mutation ($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                firstName: roleCode,
                lastName: 'Staff',
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

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('print data', () => {
    it('gives an invoice everything it shows: number, customer, address, items and money', async () => {
        const order = await newOrder({ quantity: 2, note: 'বিকেলে দিন' });
        const { bdPrintData } = await adminClient.query(PRINT_DATA, { ids: [order.id], document: 'invoice' });
        const printed = bdPrintData.orders[0];
        expect(printed).toMatchObject({
            orderNumber: '1001',
            customerName: 'রহিম উদ্দিন',
            phone: '+8801910000001',
            area: 'Mirpur 10',
            districtId: 'BD3026',
            thanaId: 'BD3026M26',
            note: 'বিকেলে দিন',
            lines: [
                {
                    name: 'Cotton Panjabi',
                    sku: 'PANJABI-1',
                    quantity: 2,
                    unitPrice: 125000,
                    linePrice: 250000,
                },
            ],
            subtotal: 250000,
            discount: 0,
            delivery: 6000,
            total: 256000,
            paid: 0,
            codDue: 256000,
            paymentType: 'cod',
            paymentMethods: [],
            printedAt: null,
            courierConsignment: null,
        });
        expect(bdPrintData.settings).toMatchObject({
            invoice: { size: 'a4' },
            sticker: { size: '4x6' },
            language: 'bn',
        });
        expect(bdPrintData.store.returnPolicy.en).toMatch(/^Please check your order/);
    });

    it('never sends prices for a packing slip', async () => {
        const order = await newOrder();
        const { bdPrintData } = await adminClient.query(PRINT_DATA, { ids: [order.id], document: 'slip' });
        const slip = bdPrintData.orders[0];
        expect(slip.lines[0]).toMatchObject({ quantity: 1, unitPrice: null, linePrice: null });
        expect([slip.subtotal, slip.total, slip.paid, slip.codDue, slip.delivery]).toEqual([
            null,
            null,
            null,
            null,
            null,
        ]);
    });

    it('shows money received and the COD due after a payment', async () => {
        const order = await newOrder();
        const { order: withPayments } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        payments {
                            id
                        }
                    }
                }
            `,
            { id: order.id },
        );
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    settlePayment(id: $id) {
                        ... on Payment {
                            state
                        }
                    }
                }
            `,
            { id: withPayments.payments[0].id },
        );
        const { bdPrintData } = await adminClient.query(PRINT_DATA, { ids: [order.id], document: 'sticker' });
        expect(bdPrintData.orders[0]).toMatchObject({
            paid: 131000,
            codDue: 0,
            paymentType: 'prepaid',
            paymentMethods: ['Test payment'],
        });
    });

    it('keeps the order asked for, and leaves out carts', async () => {
        const first = await newOrder();
        const second = await newOrder();
        await shopClient.asAnonymousUser();
        const { addItemToOrder: cart } = await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_CUSTOMER, { input: { name: 'Cart', phone: nextPhone() } });
        const { bdPrintData } = await adminClient.query(PRINT_DATA, {
            ids: [second.id, cart.id, first.id],
            document: 'invoice',
        });
        expect(bdPrintData.orders.map((order: { id: string }) => order.id)).toEqual([second.id, first.id]);
    });

    it('prints 1 to 100 orders at a time, and only known documents', async () => {
        const ids = Array.from({ length: 101 }, (_, index) => `T_${index + 1}`);
        await expect(adminClient.query(PRINT_DATA, { ids, document: 'invoice' })).rejects.toThrow(
            'Print 1 to 100 orders at a time.',
        );
        await expect(adminClient.query(PRINT_DATA, { ids: [], document: 'invoice' })).rejects.toThrow(
            'Print 1 to 100 orders at a time.',
        );
        await expect(
            adminClient.query(PRINT_DATA, { ids: ['T_1'], document: 'poster' }, { languageCode: 'bn' }),
        ).rejects.toThrow('ইনভয়েস, প্যাকিং স্লিপ, রিসিট বা স্টিকার বেছে নিন।');
    });

    it('is never cached (Cache-Control: no-store)', async () => {
        const order = await newOrder();
        const response = await fetch(adminUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${adminClient.getAuthToken()}`,
            },
            body: JSON.stringify({
                query: `query { bdPrintData(orderIds: ["${order.id}"], document: "invoice") { document } }`,
            }),
        });
        expect(response.headers.get('cache-control')).toBe('no-store');
    });
});

describe('printed marks', () => {
    it('remembers each document separately; the receipt counts as the invoice', async () => {
        const order = await newOrder();
        expect(await adminClient.query(MARK, { ids: [order.id], document: 'sticker' })).toEqual({
            markBdOrdersPrinted: 1,
        });
        const sticker = (await adminClient.query(PRINT_DATA, { ids: [order.id], document: 'sticker' }))
            .bdPrintData;
        expect(sticker.orders[0].printedAt).not.toBeNull();
        const invoice = (await adminClient.query(PRINT_DATA, { ids: [order.id], document: 'invoice' }))
            .bdPrintData;
        expect(invoice.orders[0].printedAt).toBeNull();
        await adminClient.query(MARK, { ids: [order.id], document: 'receipt' });
        const { order: info } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        bdPrint {
                            invoicePrintedAt
                            slipPrintedAt
                            stickerPrintedAt
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(info.bdPrint.invoicePrintedAt).not.toBeNull();
        expect(info.bdPrint.slipPrintedAt).toBeNull();
        expect(info.bdPrint.stickerPrintedAt).not.toBeNull();
    });
});

describe('permissions and settings', () => {
    it('lets packers and order staff print, but not marketing', async () => {
        const order = await newOrder();
        const packer = await staffClient('packer@example.com', 'packer');
        const marketing = await staffClient('marketing@example.com', 'marketing');
        const slip = await packer.query(PRINT_DATA, { ids: [order.id], document: 'slip' });
        expect(slip.bdPrintData.orders).toHaveLength(1);
        await expect(marketing.query(PRINT_DATA, { ids: [order.id], document: 'invoice' })).rejects.toThrow(
            /not currently authorized/,
        );
        await expect(marketing.query(MARK, { ids: [order.id], document: 'invoice' })).rejects.toThrow(
            /not currently authorized/,
        );
    });

    it('validates and saves the print settings (UpdateStoreSettings)', async () => {
        const UPDATE = gql`
            mutation ($input: JSON!) {
                updateBdPrintSettings(input: $input) {
                    settings
                    errors {
                        path
                        code
                    }
                }
            }
        `;
        const { bdPrintSettings } = await adminClient.query(gql`
            {
                bdPrintSettings
            }
        `);
        const bad = await adminClient.query(UPDATE, {
            input: { ...bdPrintSettings, sticker: { ...bdPrintSettings.sticker, size: '5x7' } },
        });
        expect(bad.updateBdPrintSettings.errors).toEqual([{ path: 'sticker.size', code: 'invalid' }]);
        const good = await adminClient.query(UPDATE, {
            input: { ...bdPrintSettings, language: 'both', footerText: { bn: ' ধন্যবাদ ', en: 'Thank you' } },
        });
        expect(good.updateBdPrintSettings.settings).toMatchObject({
            language: 'both',
            footerText: { bn: 'ধন্যবাদ', en: 'Thank you' },
        });
    });
});
