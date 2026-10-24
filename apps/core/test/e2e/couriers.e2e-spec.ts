import { defaultCourierSettings } from '@ecommbd/shared';
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearPathaoTokens, CourierService } from '../../src/plugins/couriers';
import { prepareCheckout, TRANSITION } from '../support/checkout';
import { MockCouriers, PATHAO_CREDENTIALS, STEADFAST_CREDENTIALS } from '../support/mock-couriers';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3073;
const mock = new MockCouriers(4073);
const config = createTestConfig(
    PORT,
    {},
    {
        courierBaseUrls: { steadfast: `${mock.url}/steadfast`, pathao: `${mock.url}/pathao` },
    },
);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const core = `http://localhost:${PORT}`;
const BADDA = 'BD3026M03';

const SETUP = gql`
    query {
        bdCourierSetup {
            keyringConfigured
            pathaoCities
            webhooks {
                courier
                url
                secret
            }
            credentials {
                courier
                mode
                complete
            }
        }
    }
`;
const UPDATE = gql`
    mutation ($input: JSON!) {
        updateBdCourierSettings(input: $input) {
            errors {
                path
                code
            }
        }
    }
`;
const SAVE = gql`
    mutation ($courier: String!, $mode: String!, $input: JSON!) {
        saveBdCourierCredentials(courier: $courier, mode: $mode, input: $input) {
            credentials {
                complete
            }
            errors {
                path
            }
        }
    }
`;
const TEST = gql`
    mutation ($courier: String!, $mode: String!) {
        testBdCourierConnection(courier: $courier, mode: $mode) {
            ok
            message
        }
    }
`;
const BOOKING_FIELDS = `
    id status courier consignmentId trackingCode trackingUrl codAmount outcome courierStatus errorCode errorMessage
`;
const BOOK = gql`
    mutation ($orderId: ID!, $courier: String) {
        bookBdCourier(orderId: $orderId, courier: $courier) {
            ... on BdCourierBooking { ${BOOKING_FIELDS} }
            ... on BdCourierError { reason message detail }
        }
    }
`;
const BOOK_MANY = gql`
    mutation ($orderIds: [ID!]!, $courier: String) {
        bookBdCouriers(orderIds: $orderIds, courier: $courier)
    }
`;
const BOOKING = gql`
    query ($orderId: ID!) {
        bdCourierBooking(orderId: $orderId) { ${BOOKING_FIELDS} }
    }
`;
const MANUAL = gql`
    mutation ($orderId: ID!, $courierName: String!, $trackingCode: String!) {
        markBdCourierBooked(orderId: $orderId, courierName: $courierName, trackingCode: $trackingCode) {
            ... on BdCourierBooking { ${BOOKING_FIELDS} }
            ... on BdCourierError { reason }
        }
    }
`;
const CANCEL_BOOKING = gql`
    mutation ($orderId: ID!) {
        cancelBdCourierBooking(orderId: $orderId) {
            ... on BdCourierBooking { ${BOOKING_FIELDS} }
            ... on BdCourierError { reason }
        }
    }
`;
const SYNC = gql`
    mutation {
        syncBdPathaoLocations {
            cities
            zones
        }
    }
`;
const UNMAPPED = gql`
    query {
        bdUnmappedAddresses {
            districtId
            thanaId
            thanaName
            orderIds
        }
    }
`;
const MAP = gql`
    mutation ($districtId: String!, $thanaId: String!, $cityId: Int!, $zoneId: Int!) {
        setBdPathaoMapping(districtId: $districtId, thanaId: $thanaId, cityId: $cityId, zoneId: $zoneId)
    }
`;
const COUNTS = gql`
    query {
        bdCourierCounts {
            inTransit
            deliveredToday
            returnedThisWeek
        }
    }
`;
const ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            state
            customFields {
                orderNumber
                trackingToken
            }
            bd {
                status
                codDue
                paidAmount
            }
            payments {
                method
                state
            }
            fulfillments {
                method
                trackingCode
                state
            }
        }
    }
`;
const action = (name: string, inputType: string) => gql`
    mutation ($input: ${inputType}!) {
        ${name}(input: $input) {
            ... on Order { id state }
            ... on BdOrderActionError { reason message }
        }
    }
`;
const CONFIRM = action('confirmBdOrder', 'BdConfirmOrderInput');
const PACK = action('packBdOrder', 'BdOrderActionInput');
const CANCEL = action('cancelBdOrder', 'BdCancelOrderInput');
const PRINT = gql`
    query ($ids: [ID!]!) {
        bdPrintData(orderIds: $ids, document: "sticker") {
            orders {
                courierConsignment
            }
        }
    }
`;
const TRACK = gql`
    query ($token: String!) {
        bdTrackOrderByToken(token: $token) {
            status
            courierTrackingUrl
        }
    }
`;
const ADD_PAYMENT = gql`
    mutation {
        addPaymentToOrder(input: { method: "bd-cod", metadata: {} }) {
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const db = () => server.app.get(TransactionalConnection).rawConnection;
const n = (id: string) => Number(String(id).replace(/^T_/, ''));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const orderById = async (id: string) => (await adminClient.query(ORDER, { id })).order;

let phoneSuffix = 5000;
/** A COD order to Mirpur (or elsewhere), placed; confirmed and packed unless asked not to. */
async function placedOrder(
    options: { thanaId?: string; districtId?: string; phone?: string; pack?: boolean } = {},
) {
    await shopClient.asAnonymousUser();
    phoneSuffix += 1;
    await prepareCheckout(shopClient, {
        phone: options.phone ?? `0171400${phoneSuffix}`,
        districtId: options.districtId,
        thanaId: options.thanaId,
    });
    await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
    const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT);
    expect(addPaymentToOrder.state).toBe('PaymentAuthorized');
    const id = addPaymentToOrder.id as string;
    await adminClient.query(CONFIRM, { input: { orderId: id } });
    if (options.pack !== false) await adminClient.query(PACK, { input: { orderId: id } });
    return id;
}

const book = (orderId: string, courier?: string) =>
    adminClient.query(BOOK, { orderId, courier }).then(result => result.bookBdCourier);

async function webhookSecret(courier: string) {
    const { bdCourierSetup } = await adminClient.query(SETUP);
    return bdCourierSetup.webhooks.find((item: { courier: string }) => item.courier === courier)
        .secret as string;
}

async function steadfastHook(body: Record<string, unknown>, token?: string) {
    const secret = await webhookSecret('steadfast');
    return fetch(`${core}/bd-courier/webhook/steadfast/${secret}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? secret}` },
        body: JSON.stringify(body),
    });
}

async function pathaoHook(
    body: Record<string, unknown>,
    signature?: string,
    extra: Record<string, string> = {},
) {
    const secret = await webhookSecret('pathao');
    return fetch(`${core}/bd-courier/webhook/pathao/${secret}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pathao-signature': signature ?? secret, ...extra },
        body: JSON.stringify(body),
    });
}

beforeAll(async () => {
    await mock.start();
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    await adminClient.query(SAVE, { courier: 'steadfast', mode: 'live', input: STEADFAST_CREDENTIALS });
    await adminClient.query(SAVE, { courier: 'pathao', mode: 'sandbox', input: PATHAO_CREDENTIALS });
}, 120_000);

afterAll(async () => {
    await server.destroy();
    await mock.stop();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    const settings = defaultCourierSettings();
    await adminClient.query(UPDATE, {
        input: {
            ...settings,
            steadfast: { enabled: true },
            pathao: { ...settings.pathao, enabled: true, storeId: '555' },
            defaultByZone: { ...settings.defaultByZone, dhaka_city: 'steadfast' },
        },
    });
    mock.refusePhones.clear();
    clearPathaoTokens();
});

describe('setup', () => {
    it('keeps credentials write-only, tests them, and gives each courier a webhook address', async () => {
        const { bdCourierSetup } = await adminClient.query(SETUP);
        expect(bdCourierSetup.keyringConfigured).toBe(true);
        expect(bdCourierSetup.credentials).toEqual(
            expect.arrayContaining([
                { courier: 'steadfast', mode: 'live', complete: true },
                { courier: 'pathao', mode: 'sandbox', complete: true },
            ]),
        );
        const hook = bdCourierSetup.webhooks.find(
            (item: { courier: string }) => item.courier === 'steadfast',
        );
        expect(hook.url).toMatch(
            /^https:\/\/shop\.example\.com\/bd-courier\/webhook\/steadfast\/[a-f0-9]{48}$/,
        );
        expect(
            (await adminClient.query(TEST, { courier: 'steadfast', mode: 'live' })).testBdCourierConnection
                .ok,
        ).toBe(true);
        expect(
            (await adminClient.query(TEST, { courier: 'pathao', mode: 'sandbox' })).testBdCourierConnection
                .ok,
        ).toBe(true);
        expect(
            (await adminClient.query(TEST, { courier: 'pathao', mode: 'live' })).testBdCourierConnection.ok,
        ).toBe(false);
    });
});

describe('Steadfast', () => {
    it('books a packed order once, puts the consignment on the sticker, and settles COD when delivered', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        expect(booking).toMatchObject({
            status: 'booked',
            courier: 'steadfast',
            outcome: 'booked',
            codAmount: 131000,
        });
        const parcel = mock.byInvoice((await orderById(id)).customFields.orderNumber)!;
        // Only what delivery needs, COD in whole taka.
        expect(parcel.body).toMatchObject({
            cod_amount: 1310,
            recipient_phone: expect.stringMatching(/^01\d{9}$/),
        });
        expect(Object.keys(parcel.body).sort()).toEqual(
            [
                'cod_amount',
                'delivery_type',
                'invoice',
                'item_description',
                'note',
                'recipient_address',
                'recipient_name',
                'recipient_phone',
                'total_lot',
            ].sort(),
        );
        // A second click books nothing new.
        expect((await book(id)).id).toBe(booking.id);
        expect(mock.parcels.size).toBeGreaterThan(0);
        expect([...mock.parcels.values()].filter(item => item.invoice === parcel.invoice)).toHaveLength(1);

        const { bdPrintData } = await adminClient.query(PRINT, { ids: [id] });
        expect(bdPrintData.orders[0].courierConsignment).toBe(booking.consignmentId);
        // A booked order can't be cancelled until the booking is.
        const cancelled = (
            await adminClient.query(CANCEL, { input: { orderId: id, reason: 'customerCancelled' } })
        ).cancelBdOrder;
        expect(cancelled.reason).toBeDefined();

        expect(
            (
                await steadfastHook({
                    notification_type: 'delivery_status',
                    consignment_id: Number(booking.consignmentId),
                    status: 'pending',
                })
            ).status,
        ).toBe(202);
        let order = await orderById(id);
        expect(order.state).toBe('Shipped');
        expect(order.fulfillments).toMatchObject([
            { method: 'Steadfast', trackingCode: booking.consignmentId, state: 'Shipped' },
        ]);

        await steadfastHook({
            notification_type: 'delivery_status',
            consignment_id: Number(booking.consignmentId),
            status: 'delivered',
        });
        await wait(300);
        order = await orderById(id);
        expect(order).toMatchObject({ state: 'Delivered', bd: { codDue: 0, paidAmount: 131000 } });
        expect(order.payments).toMatchObject([{ method: 'bd-cod', state: 'Settled' }]);
        const tracked = (await shopClient.query(TRACK, { token: order.customFields.trackingToken }))
            .bdTrackOrderByToken;
        expect(tracked.courierTrackingUrl).toBe(`https://steadfast.com.bd/t/SF${booking.consignmentId}`);
        expect((await adminClient.query(COUNTS)).bdCourierCounts.deliveredToday).toBeGreaterThanOrEqual(1);
    });

    it('refuses wrong webhook secrets, ignores unknown parcels and never moves backwards', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        expect((await steadfastHook({ consignment_id: 1, status: 'delivered' }, 'wrong')).status).toBe(401);
        expect((await steadfastHook({ consignment_id: 999999, status: 'delivered' })).status).toBe(202);
        await steadfastHook({
            consignment_id: Number(booking.consignmentId),
            status: 'delivered',
            updated_at: '2026-10-24 12:00:00',
        });
        // An older "in transit" arriving late changes nothing.
        await steadfastHook({
            consignment_id: Number(booking.consignmentId),
            status: 'pending',
            updated_at: '2026-10-24 10:00:00',
        });
        // "Hold" is only a note.
        await steadfastHook({ consignment_id: Number(booking.consignmentId), status: 'hold' });
        expect((await adminClient.query(BOOKING, { orderId: id })).bdCourierBooking).toMatchObject({
            outcome: 'delivered',
        });
        expect((await orderById(id)).state).toBe('Delivered');
    });

    it('catches up by polling when no webhook arrives, and handles a return', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        mock.parcels.get(`steadfast:${booking.consignmentId}`)!.status = 'cancelled';
        await db().query(
            `UPDATE bd_courier_booking SET "nextPollAt" = now() - interval '1 minute' WHERE "orderId" = $1`,
            [n(id)],
        );
        expect(await server.app.get(CourierService).poll()).toBeGreaterThanOrEqual(1);
        expect((await orderById(id)).state).toBe('Returned');
        expect((await adminClient.query(COUNTS)).bdCourierCounts.returnedThisWeek).toBeGreaterThanOrEqual(1);
    });

    it('books 3 orders in one action; a refused one says why and the rest stay booked', async () => {
        const ids = [await placedOrder(), await placedOrder(), await placedOrder({ phone: '01714099999' })];
        mock.refusePhones.add('01714099999');
        expect((await adminClient.query(BOOK_MANY, { orderIds: ids })).bookBdCouriers).toBe(3);
        for (let tries = 0; tries < 50; tries++) {
            const states = await Promise.all(
                ids.map(
                    async id => (await adminClient.query(BOOKING, { orderId: id })).bdCourierBooking?.status,
                ),
            );
            if (states.every(state => state === 'booked' || state === 'failed')) break;
            await wait(200);
        }
        const bookings = await Promise.all(
            ids.map(async id => (await adminClient.query(BOOKING, { orderId: id })).bdCourierBooking),
        );
        expect(bookings.map(item => item.status)).toEqual(['booked', 'booked', 'failed']);
        expect(bookings[2]).toMatchObject({
            errorCode: 'COURIER_REFUSED',
            errorMessage: expect.stringContaining('phone'),
        });
    });

    it('books a confirmed order by packing it first, and cancels a booking only before pickup', async () => {
        const id = await placedOrder({ pack: false });
        const booking = await book(id);
        expect(booking.status).toBe('booked');
        expect((await orderById(id)).state).toBe('Packed');
        expect((await adminClient.query(CANCEL_BOOKING, { orderId: id })).cancelBdCourierBooking.status).toBe(
            'cancelled',
        );
        const again = await book(id);
        await steadfastHook({ consignment_id: Number(again.consignmentId), status: 'pending' });
        expect((await adminClient.query(CANCEL_BOOKING, { orderId: id })).cancelBdCourierBooking.reason).toBe(
            'ALREADY_PICKED_UP',
        );
    });

    it('takes a manual booking when the courier is down', async () => {
        const id = await placedOrder();
        const manual = (
            await adminClient.query(MANUAL, { orderId: id, courierName: 'RedX', trackingCode: 'RX12345' })
        ).markBdCourierBooked;
        expect(manual).toMatchObject({ status: 'manual', consignmentId: 'RX12345', trackingUrl: null });
        expect((await book(id)).id).toBe(manual.id);
        const { bdPrintData } = await adminClient.query(PRINT, { ids: [id] });
        expect(bdPrintData.orders[0].courierConsignment).toBe('RX12345');
    });
});

describe('Pathao', () => {
    it('places addresses by name, queues the unmapped ones, and books once mapped', async () => {
        expect((await adminClient.query(SYNC)).syncBdPathaoLocations).toEqual({ cities: 2, zones: 4 });
        const mirpur = await placedOrder();
        const booked = await book(mirpur, 'pathao');
        expect(booked).toMatchObject({
            status: 'booked',
            courier: 'pathao',
            consignmentId: expect.stringMatching(/^DL/),
        });
        expect(mock.byInvoice((await orderById(mirpur)).customFields.orderNumber)!.body).toMatchObject({
            store_id: 555,
            recipient_city: 1,
            recipient_zone: 11,
            amount_to_collect: 1310,
            item_weight: 0.5,
        });

        const badda = await placedOrder({ thanaId: BADDA });
        expect((await book(badda, 'pathao')).reason).toBe('UNMAPPED_ADDRESS');
        const { bdUnmappedAddresses } = await adminClient.query(UNMAPPED);
        expect(bdUnmappedAddresses).toEqual([
            expect.objectContaining({ districtId: 'BD3026', thanaId: BADDA, orderIds: [badda] }),
        ]);
        expect(
            (await adminClient.query(MAP, { districtId: 'BD3026', thanaId: BADDA, cityId: 1, zoneId: 13 }))
                .setBdPathaoMapping,
        ).toBe(true);
        expect((await adminClient.query(UNMAPPED)).bdUnmappedAddresses).toEqual([]);
        expect((await book(badda, 'pathao')).status).toBe('booked');
    });

    it('answers the webhook handshake, checks the signature, and follows statuses', async () => {
        const handshake = await pathaoHook({ event: 'webhook_integration' }, 'anything', {
            'x-pathao-merchant-webhook-integration-secret': 'challenge-123',
        });
        expect(handshake.status).toBe(202);
        expect(handshake.headers.get('x-pathao-merchant-webhook-integration-secret')).toBe('challenge-123');

        const id = await placedOrder();
        const booking = await book(id, 'pathao');
        expect(
            (await pathaoHook({ event: 'order.picked', consignment_id: booking.consignmentId }, 'wrong'))
                .status,
        ).toBe(401);
        await pathaoHook({ event: 'order.picked', consignment_id: booking.consignmentId });
        expect((await orderById(id)).state).toBe('Shipped');
        await pathaoHook({ event: 'order.delivered', consignment_id: booking.consignmentId });
        await wait(300);
        expect((await orderById(id)).state).toBe('Delivered');
    });

    it('gets a new token when Pathao says the old one expired', async () => {
        const id = await placedOrder();
        await book(id, 'pathao');
        const before = mock.tokensIssued;
        mock.expirePathaoToken = true;
        const second = await placedOrder();
        expect((await book(second, 'pathao')).status).toBe('booked');
        expect(mock.tokensIssued).toBe(before + 1);
    });
});

describe('permissions', () => {
    it('refuses booking to anyone without BookCourier', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(BOOK, { orderId: '1' })).rejects.toThrow();
        await expect(adminClient.query(SETUP)).rejects.toThrow();
    });
});
