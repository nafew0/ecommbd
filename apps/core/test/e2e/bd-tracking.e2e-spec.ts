import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placePhoneOrder } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

/**
 * Order tracking for shoppers (roadmap phase 14): by order number and phone (any form, Bangla
 * digits too), by the SMS token, only what a shopper may see, and rate limits against guessing.
 */

const PORT = 3068;
const config = createTestConfig(
    PORT,
    {},
    {
        // All lookups here come from one address: only the per-phone limit is tested.
        trackingRateLimits: {
            perIp: { limit: 1000, windowMs: 60_000 },
            perPhone: { limit: 20, windowMs: 60_000 },
        },
    },
);
const { server, adminClient, shopClient } = createTestEnvironment(config);

const TRACKED = `
    orderNumber
    placedAt
    status
    timeline { status at }
    firstName
    district
    lines { name quantity }
    total
    codDue
    courierTrackingUrl
`;
const TRACK = gql`
    query ($orderNumber: String!, $phone: String!) {
        bdTrackOrder(orderNumber: $orderNumber, phone: $phone) { ${TRACKED} }
    }
`;
const TRACK_TOKEN = gql`
    query ($token: String!) {
        bdTrackOrderByToken(token: $token) { ${TRACKED} }
    }
`;
const ORDER_TOKEN = gql`
    query ($code: String!) {
        orderByCode(code: $code) {
            code
            bdTrackingToken
        }
    }
`;
const ADMIN_ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            customFields {
                orderNumber
                trackingToken
            }
        }
    }
`;
const CONFIRM = gql`
    mutation ($input: BdConfirmOrderInput!) {
        confirmBdOrder(input: $input) {
            ... on Order {
                state
            }
        }
    }
`;
const ORDER_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdOrderSettings(input: $input) {
            errors {
                path
            }
        }
    }
`;

const PHONE = '01712345611';
let order: { id: string; code: string; orderNumber: string; token: string };

async function track(orderNumber: string, phone: string, languageCode: 'bn' | 'en' = 'bn') {
    const { bdTrackOrder } = await shopClient.query(TRACK, { orderNumber, phone }, { languageCode });
    return bdTrackOrder;
}

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 0,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const placed = await placePhoneOrder(shopClient, { phone: PHONE, name: 'রহিম উদ্দিন', quantity: 2 });
    // The token is given right after the order is placed (an event).
    let fields: { orderNumber: string; trackingToken: string | null } = {
        orderNumber: '',
        trackingToken: null,
    };
    for (let attempt = 0; attempt < 50 && !fields.trackingToken; attempt++) {
        fields = (await adminClient.query(ADMIN_ORDER, { id: placed.id })).order.customFields;
        if (!fields.trackingToken) await new Promise(resolve => setTimeout(resolve, 100));
    }
    order = {
        id: placed.id,
        code: placed.code,
        orderNumber: fields.orderNumber,
        token: fields.trackingToken!,
    };
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('tracking by order number and phone', () => {
    it('finds the order with the phone in any form, Bangla digits included', async () => {
        expect(order.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
        for (const phone of [PHONE, '+8801712345611', '০১৭১২-৩৪৫৬১১', '8801712345611']) {
            expect((await track(order.orderNumber, phone))?.orderNumber, phone).toBe(order.orderNumber);
        }
        expect((await track(`#${order.orderNumber}`, PHONE))?.orderNumber).toBe(order.orderNumber);
    });

    it('shows only the first name, the district, the items and the status', async () => {
        const bn = await track(order.orderNumber, PHONE);
        expect(bn).toMatchObject({
            status: 'new',
            firstName: 'রহিম',
            district: 'ঢাকা',
            lines: [{ name: expect.stringMatching(/\S/), quantity: 2 }],
            courierTrackingUrl: null,
        });
        expect(bn.timeline.map((step: { status: string }) => step.status)).toEqual(['new']);
        expect(bn.total).toBeGreaterThan(0);
        expect(Object.keys(bn).sort()).toEqual(
            [
                'codDue',
                'courierTrackingUrl',
                'district',
                'firstName',
                'lines',
                'orderNumber',
                'placedAt',
                'status',
                'timeline',
                'total',
            ].sort(),
        );
        expect((await track(order.orderNumber, PHONE, 'en')).district).toBe('Dhaka');
    });

    it('answers every miss the same way: null', async () => {
        expect(await track(order.orderNumber, '01812345678')).toBeNull();
        expect(await track('99999', PHONE)).toBeNull();
        expect(await track('not a number', PHONE)).toBeNull();
        expect(await track(order.orderNumber, 'not a phone')).toBeNull();
    });

    it('follows the status as staff work on the order', async () => {
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        const tracked = await track(order.orderNumber, PHONE);
        expect(tracked.status).toBe('confirmed');
        expect(tracked.timeline.map((step: { status: string }) => step.status)).toEqual(['new', 'confirmed']);
    });

    it('finds "1002" when the store numbers orders "MF-1002"', async () => {
        const { bdOrderSettings } = await adminClient.query(gql`
            {
                bdOrderSettings
            }
        `);
        const { updateBdOrderSettings } = await adminClient.query(ORDER_SETTINGS, {
            input: { ...bdOrderSettings, orderNumberPrefix: 'MF' },
        });
        expect(updateBdOrderSettings.errors).toEqual([]);
        const second = await placePhoneOrder(shopClient, { phone: '01912345622' });
        const { orderNumber } = (await adminClient.query(ADMIN_ORDER, { id: second.id })).order.customFields;
        expect(orderNumber).toMatch(/^MF-\d+$/);
        const digits = orderNumber.replace('MF-', '');
        expect((await track(digits, '01912345622'))?.orderNumber).toBe(orderNumber);
        expect((await track(orderNumber.toLowerCase(), '01912345622'))?.orderNumber).toBe(orderNumber);
    });
});

describe('tracking by token', () => {
    it('opens the order from the SMS link, and nothing for a wrong token', async () => {
        const { bdTrackOrderByToken } = await shopClient.query(TRACK_TOKEN, { token: order.token });
        expect(bdTrackOrderByToken.orderNumber).toBe(order.orderNumber);
        const wrong = await shopClient.query(TRACK_TOKEN, { token: 'x'.repeat(22) });
        expect(wrong.bdTrackOrderByToken).toBeNull();
        const malformed = await shopClient.query(TRACK_TOKEN, { token: "'; DROP TABLE order; --" });
        expect(malformed.bdTrackOrderByToken).toBeNull();
    });

    it('gives the thank-you page the token of the order the session placed', async () => {
        const placed = await placePhoneOrder(shopClient, { phone: '01712345633' });
        const { orderByCode } = await shopClient.query(ORDER_TOKEN, { code: placed.code });
        expect(orderByCode.bdTrackingToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
        const { bdTrackOrderByToken } = await shopClient.query(TRACK_TOKEN, {
            token: orderByCode.bdTrackingToken,
        });
        expect(bdTrackOrderByToken).not.toBeNull();
    });
});

describe('rate limits', () => {
    it('refuses more lookups for one phone than allowed, found or not', async () => {
        const phone = '01612345644';
        for (let attempt = 0; attempt < 20; attempt++) {
            expect(await track(String(1000 + attempt), phone)).toBeNull();
        }
        await expect(track('1100', phone, 'en')).rejects.toThrow(
            'Too many tries. Please wait a few minutes and try again.',
        );
    });
});
