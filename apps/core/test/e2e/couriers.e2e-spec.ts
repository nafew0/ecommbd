import { defaultCourierSettings, defaultPaymentSettings } from '@ecommbd/shared';
import { TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPathaoTokens, CourierService } from '../../src/plugins/couriers';
import { CourierClients } from '../../src/plugins/couriers/courier-clients.service';
import { CourierSettingsService } from '../../src/plugins/couriers/courier-settings.service';
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
    id status courier courierName invoice consignmentId trackingCode trackingUrl codAmount newCodAmount
    outcome courierStatus errorCode errorMessage waitingForCourier
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
const BOOKINGS = gql`
    query ($orderIds: [ID!]!) {
        bdCourierBookings(orderIds: $orderIds) { orderId ${BOOKING_FIELDS} }
    }
`;
const RESOLVE = gql`
    mutation ($orderId: ID!, $consignmentId: String) {
        resolveBdCourierBooking(orderId: $orderId, consignmentId: $consignmentId) {
            ... on BdCourierBooking { ${BOOKING_FIELDS} }
            ... on BdCourierError { reason }
        }
    }
`;
const CONFIRM_COD = gql`
    mutation ($orderId: ID!) {
        confirmBdCourierCodUpdated(orderId: $orderId) {
            ... on BdCourierBooking { ${BOOKING_FIELDS} }
            ... on BdCourierError { reason }
        }
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
const SHIP = action('markBdOrderShipped', 'BdOrderActionInput');
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
const PAY = gql`
    mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ... on Order {
                id
                state
                payments {
                    id
                    method
                    state
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const VERIFY = gql`
    mutation ($input: BdVerifyPaymentInput!) {
        verifyBdPayment(input: $input) {
            ... on Payment {
                id
                state
            }
        }
    }
`;
const PAYMENT_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdPaymentSettings(input: $input) {
            errors {
                path
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
    options: {
        thanaId?: string;
        districtId?: string;
        phone?: string;
        pack?: boolean;
        confirm?: boolean;
    } = {},
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
    if (options.confirm === false) return id;
    await adminClient.query(CONFIRM, { input: { orderId: id } });
    if (options.pack !== false) await adminClient.query(PACK, { input: { orderId: id } });
    return id;
}

const bookingOf = async (id: string) => (await adminClient.query(BOOKING, { orderId: id })).bdCourierBooking;
const orderNumber = async (id: string) => (await orderById(id)).customFields.orderNumber as string;
const parcelsFor = (invoice: string) => [...mock.parcels.values()].filter(item => item.invoice === invoice);

/** Waits (up to ~10 s) until `check` passes. */
async function until(check: () => Promise<boolean>, tries = 50) {
    for (let i = 0; i < tries; i++) {
        if (await check()) return;
        await wait(200);
    }
    throw new Error('Timed out waiting');
}

/** Makes every booking of the order due for the polling task, then runs it. */
async function pollNow(id: string) {
    await db().query(
        `UPDATE bd_courier_booking SET "nextPollAt" = now() - interval '1 minute' WHERE "orderId" = $1 AND "nextPollAt" IS NOT NULL`,
        [n(id)],
    );
    return server.app.get(CourierService).poll();
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
    mock.createTrouble.length = 0;
    mock.invoiceLookupDown = false;
    clearPathaoTokens();
});

describe('setup', () => {
    it('never makes a webhook secret from a public request', async () => {
        // Before staff open the courier settings there is no secret: a webhook is refused, and
        // asking doesn't make one.
        const response = await fetch(`${core}/bd-courier/webhook/steadfast/guess`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer guess' },
            body: JSON.stringify({ consignment_id: 1, status: 'delivered' }),
        });
        expect(response.status).toBe(401);
        const settings = server.app.get(CourierSettingsService);
        const ctx = await server.app.get(CourierService).background();
        expect(await settings.webhookSecret(ctx, 'steadfast')).toBeNull();
    });

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
        // In the staff member's language.
        const live = await adminClient.query(
            TEST,
            { courier: 'pathao', mode: 'live' },
            { languageCode: 'bn' },
        );
        expect(live.testBdCourierConnection).toEqual({
            ok: false,
            message: 'আগে এই মোডের সব তথ্য সেভ করুন।',
        });
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
            invoice: await orderNumber(id),
        });
        const parcel = mock.byInvoice(await orderNumber(id))!;
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
        expect(parcelsFor(parcel.invoice)).toHaveLength(1);

        const { bdPrintData } = await adminClient.query(PRINT, { ids: [id] });
        expect(bdPrintData.orders[0].courierConsignment).toBe(booking.consignmentId);
        // A booked order can't be cancelled until the booking is.
        const cancelled = (
            await adminClient.query(CANCEL, { input: { orderId: id, reason: 'customerCancelled' } })
        ).cancelBdOrder;
        expect(cancelled.reason).toBeDefined();

        // Steadfast's "pending" ("not delivered or cancelled yet") isn't a pickup: still Packed.
        expect(
            (
                await steadfastHook({
                    notification_type: 'delivery_status',
                    consignment_id: Number(booking.consignmentId),
                    status: 'pending',
                })
            ).status,
        ).toBe(202);
        expect((await orderById(id)).state).toBe('Packed');
        expect(await bookingOf(id)).toMatchObject({ outcome: 'booked', courierStatus: 'pending' });

        await steadfastHook({
            notification_type: 'delivery_status',
            consignment_id: Number(booking.consignmentId),
            status: 'delivered',
        });
        await wait(300);
        const order = await orderById(id);
        // The missed pickup is filled in on the way to Delivered.
        expect(order).toMatchObject({ state: 'Delivered', bd: { codDue: 0, paidAmount: 131000 } });
        expect(order.fulfillments).toMatchObject([
            { method: 'Steadfast', trackingCode: booking.consignmentId },
        ]);
        expect(order.payments).toMatchObject([{ method: 'bd-cod', state: 'Settled' }]);
        const tracked = (await shopClient.query(TRACK, { token: order.customFields.trackingToken }))
            .bdTrackOrderByToken;
        expect(tracked.courierTrackingUrl).toBe(`https://steadfast.com.bd/t/SF${booking.consignmentId}`);
        expect((await adminClient.query(COUNTS)).bdCourierCounts.deliveredToday).toBeGreaterThanOrEqual(1);
    });

    it('refuses wrong webhook secrets, ignores unknown parcels and never moves backwards', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        const secret = await webhookSecret('steadfast');
        // A wrong Bearer token, or a wrong secret in the path with the right token.
        expect((await steadfastHook({ consignment_id: 1, status: 'delivered' }, 'wrong')).status).toBe(401);
        const wrongPath = await fetch(`${core}/bd-courier/webhook/steadfast/${'0'.repeat(48)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify({ consignment_id: Number(booking.consignmentId), status: 'delivered' }),
        });
        expect(wrongPath.status).toBe(401);
        expect((await fetch(`${core}/bd-courier/webhook/redx/${secret}`, { method: 'POST' })).status).toBe(
            404,
        );
        expect((await bookingOf(id)).outcome).toBe('booked');

        expect((await steadfastHook({ consignment_id: 999999, status: 'delivered' })).status).toBe(202);
        await steadfastHook({
            consignment_id: Number(booking.consignmentId),
            status: 'delivered',
            updated_at: '2026-10-24 12:00:00',
        });
        // An older status arriving late changes nothing.
        await steadfastHook({
            consignment_id: Number(booking.consignmentId),
            status: 'pending',
            updated_at: '2026-10-24 10:00:00',
        });
        // "Hold" is only a note.
        await steadfastHook({ consignment_id: Number(booking.consignmentId), status: 'hold' });
        expect(await bookingOf(id)).toMatchObject({ outcome: 'delivered' });
        expect((await orderById(id)).state).toBe('Delivered');
    });

    it('reads "cancelled" before pickup as a cancelled booking: the order stays Packed', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        mock.parcels.get(`steadfast:${booking.consignmentId}`)!.status = 'cancelled';
        expect(await pollNow(id)).toBeGreaterThanOrEqual(1);
        expect(await bookingOf(id)).toMatchObject({ status: 'cancelled', outcome: 'cancelled' });
        expect((await orderById(id)).state).toBe('Packed');
        // Free to book again.
        expect((await book(id)).status).toBe('booked');
    });

    it('reads "cancelled" after the order was shipped as a return', async () => {
        const id = await placedOrder();
        const booking = await book(id);
        expect((await adminClient.query(SHIP, { input: { orderId: id } })).markBdOrderShipped.state).toBe(
            'Shipped',
        );
        await steadfastHook({ consignment_id: Number(booking.consignmentId), status: 'cancelled' });
        await wait(300);
        expect(await bookingOf(id)).toMatchObject({ outcome: 'returned' });
        expect((await orderById(id)).state).toBe('Returned');
        expect((await adminClient.query(COUNTS)).bdCourierCounts.returnedThisWeek).toBeGreaterThanOrEqual(1);
    });

    it('books 3 orders in one action; a refused one says why and the rest stay booked', async () => {
        const ids = [await placedOrder(), await placedOrder(), await placedOrder({ phone: '01714099999' })];
        mock.refusePhones.add('01714099999');
        expect((await adminClient.query(BOOK_MANY, { orderIds: ids })).bookBdCouriers).toBe(3);
        await until(async () => {
            const { bdCourierBookings } = await adminClient.query(BOOKINGS, { orderIds: ids });
            return (
                bdCourierBookings.length === 3 &&
                bdCourierBookings.every((item: { status: string }) =>
                    ['booked', 'failed'].includes(item.status),
                )
            );
        });
        const bookings = await Promise.all(ids.map(bookingOf));
        expect(bookings.map(item => item.status)).toEqual(['booked', 'booked', 'failed']);
        expect(bookings[2]).toMatchObject({
            errorCode: 'COURIER_REFUSED',
            errorMessage: expect.stringContaining('phone'),
        });
    });

    it('books 50 orders in the background, and shows why one that isn’t ready wasn’t booked', async () => {
        const ids: string[] = [];
        for (let i = 0; i < 50; i++) ids.push(await placedOrder());
        // Placed but never confirmed: not ready to book.
        const notReady = await placedOrder({ confirm: false });
        const all = [...ids, notReady];
        const before = mock.createCalls;
        expect((await adminClient.query(BOOK_MANY, { orderIds: all })).bookBdCouriers).toBe(51);
        await until(async () => {
            const { bdCourierBookings } = await adminClient.query(BOOKINGS, { orderIds: all });
            return (
                bdCourierBookings.length === 51 &&
                bdCourierBookings.every((item: { status: string }) => item.status !== 'booking')
            );
        }, 300);
        const { bdCourierBookings } = await adminClient.query(BOOKINGS, { orderIds: all });
        const byOrder = new Map(
            bdCourierBookings.map((item: { orderId: string; status: string }) => [item.orderId, item]),
        );
        expect(ids.every(id => (byOrder.get(id) as { status: string }).status === 'booked')).toBe(true);
        expect(byOrder.get(notReady)).toMatchObject({
            status: 'failed',
            errorCode: 'NOT_READY',
            invoice: await orderNumber(notReady),
        });
        // One courier call per order, never two.
        expect(mock.createCalls - before).toBe(50);
        for (const id of ids.slice(0, 5)) expect(parcelsFor(await orderNumber(id))).toHaveLength(1);
    }, 180_000);

    it('books a confirmed order by packing it first, and cancels a booking only before pickup', async () => {
        const id = await placedOrder({ pack: false });
        const booking = await book(id);
        expect(booking.status).toBe('booked');
        expect((await orderById(id)).state).toBe('Packed');
        expect((await adminClient.query(CANCEL_BOOKING, { orderId: id })).cancelBdCourierBooking.status).toBe(
            'cancelled',
        );
        await book(id);
        // Steadfast never says "picked up": an order staff marked shipped counts as picked up.
        await adminClient.query(SHIP, { input: { orderId: id } });
        expect((await adminClient.query(CANCEL_BOOKING, { orderId: id })).cancelBdCourierBooking.reason).toBe(
            'ALREADY_PICKED_UP',
        );
    });

    it('takes a manual booking with any courier name, in English or Bangla', async () => {
        const id = await placedOrder();
        const manual = (
            await adminClient.query(MANUAL, {
                orderId: id,
                courierName: 'Sundarban Courier',
                trackingCode: 'SB12345',
            })
        ).markBdCourierBooked;
        expect(manual).toMatchObject({
            status: 'manual',
            courier: 'manual',
            courierName: 'Sundarban Courier',
            consignmentId: 'SB12345',
            trackingUrl: null,
        });
        expect((await book(id)).id).toBe(manual.id);
        const { bdPrintData } = await adminClient.query(PRINT, { ids: [id] });
        expect(bdPrintData.orders[0].courierConsignment).toBe('SB12345');

        const bangla = await placedOrder();
        const name = 'সুন্দরবন কুরিয়ার সার্ভিস লিমিটেড, কারওয়ান বাজার শাখা';
        const second = (
            await adminClient.query(MANUAL, { orderId: bangla, courierName: name, trackingCode: 'SB-77' })
        ).markBdCourierBooked;
        expect(second).toMatchObject({ status: 'manual', courier: 'manual' });
        // Kept whole up to 40 characters.
        expect(second.courierName).toBe([...name].slice(0, 40).join(''));
        expect((await orderById(bangla)).state).toBe('Packed');
    });
});

describe('no clear answer from the courier', () => {
    it('keeps a booking whose answer was lost, finds the parcel by invoice and never books it twice', async () => {
        const id = await placedOrder();
        const invoice = await orderNumber(id);
        const before = mock.createCalls;
        // Steadfast makes the parcel, then the connection drops (like a timeout).
        mock.createTrouble.push('drop');
        expect((await book(id)).reason).toBe('COURIER_UNAVAILABLE');
        expect(await bookingOf(id)).toMatchObject({
            status: 'unconfirmed',
            errorCode: 'COURIER_UNAVAILABLE',
        });
        expect(parcelsFor(invoice)).toHaveLength(1);
        // Still live: the order can't be cancelled or booked by hand meanwhile.
        expect(
            (await adminClient.query(MANUAL, { orderId: id, courierName: 'RedX', trackingCode: 'RX1' }))
                .markBdCourierBooked.reason,
        ).toBe('ALREADY_BOOKED');

        // "Try again": Steadfast is asked by invoice first, has it, and the booking is linked.
        const again = await book(id);
        expect(again).toMatchObject({ status: 'booked', courierStatus: 'in_review', consignmentId: null });
        expect(mock.createCalls - before).toBe(1);
        expect(parcelsFor(invoice)).toHaveLength(1);

        // Steadfast's webhook carries the consignment ID and our invoice: the booking learns its ID.
        const parcel = parcelsFor(invoice)[0]!;
        await steadfastHook({
            consignment_id: Number(parcel.consignmentId),
            invoice,
            tracking_code: `SF${parcel.consignmentId}`,
            status: 'delivered',
        });
        await wait(300);
        expect(await bookingOf(id)).toMatchObject({
            consignmentId: parcel.consignmentId,
            trackingCode: `SF${parcel.consignmentId}`,
            outcome: 'delivered',
        });
        expect((await orderById(id)).state).toBe('Delivered');
    });

    it('tries a 5xx-after-create booking again by itself, and waits while the lookup fails', async () => {
        const id = await placedOrder();
        const invoice = await orderNumber(id);
        mock.createTrouble.push('error500');
        expect((await book(id)).reason).toBe('COURIER_UNAVAILABLE');
        mock.invoiceLookupDown = true;
        await pollNow(id);
        expect(await bookingOf(id)).toMatchObject({ status: 'unconfirmed' });
        mock.invoiceLookupDown = false;
        await pollNow(id);
        expect(await bookingOf(id)).toMatchObject({ status: 'booked' });
        expect(parcelsFor(invoice)).toHaveLength(1);
    });

    it('treats 429 as "later": nothing was made, so trying again books it', async () => {
        const id = await placedOrder();
        const before = mock.createCalls;
        mock.createTrouble.push('tooMany');
        expect((await book(id)).reason).toBe('COURIER_BUSY');
        expect(await bookingOf(id)).toMatchObject({ status: 'unconfirmed', errorCode: 'COURIER_BUSY' });
        expect(parcelsFor(await orderNumber(id))).toHaveLength(0);
        // While calls to the courier are paused, it waits ("waiting for Steadfast").
        const paused = vi.spyOn(server.app.get(CourierClients), 'paused').mockReturnValue(true);
        try {
            expect((await bookingOf(id)).waitingForCourier).toBe(true);
            await pollNow(id);
            expect(mock.createCalls - before).toBe(1);
        } finally {
            paused.mockRestore();
        }
        expect((await book(id)).status).toBe('booked');
        expect(mock.createCalls - before).toBe(2);
        expect(parcelsFor(await orderNumber(id))).toHaveLength(1);
    });

    it('asks staff to check Pathao’s panel, which can’t be asked by invoice', async () => {
        await adminClient.query(SYNC);
        const id = await placedOrder();
        const before = mock.createCalls;
        mock.createTrouble.push('error500');
        expect((await book(id, 'pathao')).reason).toBe('COURIER_UNAVAILABLE');
        // Not tried again on its own, and "Try again" makes nothing new.
        expect((await book(id, 'pathao')).reason).toBe('CHECK_COURIER_PANEL');
        await pollNow(id);
        expect(mock.createCalls - before).toBe(1);
        // Staff found it in Pathao's panel.
        const parcel = parcelsFor(await orderNumber(id))[0]!;
        const linked = (
            await adminClient.query(RESOLVE, { orderId: id, consignmentId: parcel.consignmentId })
        ).resolveBdCourierBooking;
        expect(linked).toMatchObject({ status: 'booked', consignmentId: parcel.consignmentId });

        // Another one that isn't in Pathao's panel: the booking fails and the order books again.
        const other = await placedOrder();
        mock.createTrouble.push('drop');
        expect((await book(other, 'pathao')).reason).toBe('COURIER_UNAVAILABLE');
        mock.parcels.delete(`pathao:${parcelsFor(await orderNumber(other))[0]!.consignmentId}`);
        expect((await adminClient.query(RESOLVE, { orderId: other })).resolveBdCourierBooking.status).toBe(
            'failed',
        );
        expect((await book(other, 'pathao')).status).toBe('booked');
    });
});

describe('COD after booking', () => {
    const payments = (advance: boolean) => {
        const settings = defaultPaymentSettings();
        return adminClient.query(PAYMENT_SETTINGS, {
            input: {
                ...settings,
                mfs: {
                    ...settings.mfs,
                    bkash: { enabled: true, number: '01812345678', accountType: 'personal' },
                },
                advance: advance
                    ? { ...settings.advance, enabled: true, rule: 'delivery', scope: 'all' }
                    : settings.advance,
            },
        });
    };
    afterEach(() => payments(false));

    it('flags the booking when an advance is verified after booking, until staff update the parcel', async () => {
        await payments(true);
        await shopClient.asAnonymousUser();
        await prepareCheckout(shopClient, { phone: '01714077777' });
        await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
        await shopClient.query(PAY, {
            input: {
                method: 'bd-bkash',
                metadata: { senderNumber: '01912345678', transactionId: '8N7A6C0001', purpose: 'advance' },
            },
        });
        const placed = (await shopClient.query(PAY, { input: { method: 'bd-cod', metadata: {} } }))
            .addPaymentToOrder;
        expect(placed.state).toBe('PaymentAuthorized');
        const id = placed.id as string;
        await adminClient.query(CONFIRM, { input: { orderId: id } });
        // Booked before staff verified the ৳60 advance: the courier collects the full ৳1310.
        const booking = await book(id);
        expect(booking).toMatchObject({ status: 'booked', codAmount: 131000, newCodAmount: null });

        const bkash = placed.payments.find((p: { method: string }) => p.method === 'bd-bkash');
        expect(
            (await adminClient.query(VERIFY, { input: { paymentId: bkash.id } })).verifyBdPayment.state,
        ).toBe('Settled');
        await until(async () => (await bookingOf(id)).newCodAmount !== null);
        expect(await bookingOf(id)).toMatchObject({ codAmount: 131000, newCodAmount: 125000 });

        // Staff changed it in Steadfast's panel.
        expect(
            (await adminClient.query(CONFIRM_COD, { orderId: id })).confirmBdCourierCodUpdated,
        ).toMatchObject({
            codAmount: 125000,
            newCodAmount: null,
        });
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
        expect(mock.byInvoice(await orderNumber(mirpur))!.body).toMatchObject({
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

    it('moves the order on the next poll when it didn’t follow its parcel', async () => {
        const id = await placedOrder();
        const booking = await book(id, 'pathao');
        // The status is saved but the order move never happened (as if the server stopped between).
        const couriers = server.app.get(CourierService);
        await couriers.applyStatus(await couriers.background(), n(booking.id), 'Picked', null, 'poll', null);
        expect((await orderById(id)).state).toBe('Packed');
        mock.parcels.get(`pathao:${booking.consignmentId}`)!.status = 'Picked';
        await pollNow(id);
        expect((await orderById(id)).state).toBe('Shipped');
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

    it('forgets Pathao’s places when the mode changes (sandbox and live IDs differ)', async () => {
        await adminClient.query(SYNC);
        expect((await adminClient.query(SETUP)).bdCourierSetup.pathaoCities).toBe(2);
        const settings = defaultCourierSettings();
        await adminClient.query(UPDATE, {
            input: {
                ...settings,
                pathao: { ...settings.pathao, enabled: true, storeId: '555', mode: 'live' },
            },
        });
        expect((await adminClient.query(SETUP)).bdCourierSetup.pathaoCities).toBe(0);
        const count = await db().query(`SELECT count(*)::int AS n FROM bd_courier_location_map`);
        expect(count[0].n).toBe(0);
    });
});

describe('permissions', () => {
    it('refuses booking to anyone without BookCourier', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(BOOK, { orderId: '1' })).rejects.toThrow();
        await expect(adminClient.query(SETUP)).rejects.toThrow();
    });

    it('refuses booking to staff whose role lacks BookCourier, but lets them see the booking', async () => {
        await adminClient.asSuperAdmin();
        const id = await placedOrder();
        const { createRole } = await adminClient.query(gql`
            mutation {
                createRole(
                    input: {
                        code: "no-courier"
                        description: "No courier"
                        permissions: [ReadOrder, UpdateOrder]
                    }
                ) {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($roleId: ID!) {
                    createAdministrator(
                        input: {
                            firstName: "Rina"
                            lastName: "Staff"
                            emailAddress: "rina@example.com"
                            password: "rina-password"
                            roleIds: [$roleId]
                        }
                    ) {
                        id
                    }
                }
            `,
            { roleId: createRole.id },
        );
        const staff = new SimpleGraphQLClient(config, `${core}/admin-api`);
        await staff.asUserWithCredentials('rina@example.com', 'rina-password');
        await expect(staff.query(BOOK, { orderId: id })).rejects.toThrow(/permission|authorized/i);
        await expect(staff.query(BOOK_MANY, { orderIds: [id] })).rejects.toThrow(/permission|authorized/i);
        await expect(
            staff.query(MANUAL, { orderId: id, courierName: 'RedX', trackingCode: 'RX9' }),
        ).rejects.toThrow(/permission|authorized/i);
        await expect(staff.query(RESOLVE, { orderId: id })).rejects.toThrow(/permission|authorized/i);
        await expect(staff.query(CONFIRM_COD, { orderId: id })).rejects.toThrow(/permission|authorized/i);
        expect((await staff.query(BOOKING, { orderId: id })).bdCourierBooking).toBeNull();
        expect(mock.byInvoice(await orderNumber(id))).toBeUndefined();
    });
});
