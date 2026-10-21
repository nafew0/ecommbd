import { defaultSmsSettings, type SmsSettings } from '@ecommbd/shared';
import { RequestContextService } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LogSmsDriver, SmsService } from '../../src/plugins/notifications';
import { DHAKA, MIRPUR, placePhoneOrder } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3063;
const driver = new LogSmsDriver();
const config = createTestConfig(PORT, {}, { smsDriver: driver });
const { server, adminClient, shopClient } = createTestEnvironment(config);

const SAVE_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdSmsSettings(input: $input) {
            settings
            errors {
                path
                code
            }
        }
    }
`;

const MESSAGES = gql`
    query ($orderId: ID!) {
        bdSmsMessages(orderId: $orderId) {
            event
            to
            body
            segments
            status
            reason
            sendAfter
        }
    }
`;

const action = (name: string, inputType: string) => gql`
    mutation ($input: ${inputType}!) { ${name}(input: $input) { ... on Order { id } ... on BdOrderActionError { reason } } }
`;
const CONFIRM = action('confirmBdOrder', 'BdConfirmOrderInput');
const PACK = action('packBdOrder', 'BdOrderActionInput');
const SHIP = action('markBdOrderShipped', 'BdOrderActionInput');

let phoneSuffix = 3000;
const newPhone = () => `01715${String(++phoneSuffix).padStart(6, '0')}`;

async function saveSettings(patch: (settings: SmsSettings) => Partial<SmsSettings> = () => ({})) {
    const settings = defaultSmsSettings();
    // Tests run at any hour: quiet hours are off unless a test turns them on.
    const input = { ...settings, quietHours: { ...settings.quietHours, enabled: false } };
    const { updateBdSmsSettings } = await adminClient.query(SAVE_SETTINGS, { input: { ...input, ...patch(input) } });
    expect(updateBdSmsSettings.errors).toEqual([]);
}

async function sentTo(phone: string, count: number) {
    const e164 = `+880${phone.slice(1)}`;
    for (let i = 0; i < 100; i += 1) {
        const sent = driver.sent.filter(message => message.to === e164);
        if (sent.length >= count) return sent;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return driver.sent.filter(message => message.to === e164);
}

async function messagesOf(orderId: string) {
    return (await adminClient.query(MESSAGES, { orderId })).bdSmsMessages as Array<{
        event: string;
        status: string;
        reason: string;
        body: string;
        sendAfter: string | null;
    }>;
}

/** The driver records an SMS just before the job saves "sent", so wait for the row too. */
async function statusesOf(orderId: string, expected: string[]) {
    let statuses: string[] = [];
    for (let i = 0; i < 50; i += 1) {
        statuses = (await messagesOf(orderId)).map(m => m.status);
        if (JSON.stringify(statuses) === JSON.stringify(expected)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return statuses;
}

beforeAll(async () => {
    await server.init({ initialData: testInitialData, productsCsvPath: testProductsCsvPath, customerCount: 0 });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await saveSettings();
    driver.failNext = 0;
});

describe('order SMS', () => {
    it('sends one Bangla SMS each when the order is placed, confirmed and shipped', async () => {
        const phone = newPhone();
        const order = await placePhoneOrder(shopClient, { phone, name: 'রহিম', districtId: DHAKA, thanaId: MIRPUR });
        expect((await sentTo(phone, 1))[0]!.text).toMatch(/^রহিম, আপনার অর্ডার #\d+ পেয়েছি। মোট ৳1,310।/);
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        await adminClient.query(PACK, { input: { orderId: order.id } });
        await adminClient.query(SHIP, { input: { orderId: order.id } });
        const sent = await sentTo(phone, 3);
        expect(sent.map(message => message.unicode)).toEqual([true, true, true]);
        expect(sent[1]!.text).toContain('কনফার্ম হয়েছে। ডেলিভারিতে দিতে হবে ৳1,310');
        expect(sent[2]!.text).toMatch(/ট্র্যাক করুন: https:\/\/shop\.example\.com\/t\/[A-Za-z0-9_-]{22}$/);

        // The same event again (a retried event) sends nothing more.
        const sms = server.app.get(SmsService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        await sms.queueSms(ctx, {
            event: 'confirmed',
            to: `+880${phone.slice(1)}`,
            language: 'bn',
            values: {},
            key: `order:${String(order.id).replace('T_', '')}:confirmed:+880${phone.slice(1)}`,
        });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(driver.sent.filter(message => message.to === `+880${phone.slice(1)}`)).toHaveLength(3);
        await statusesOf(order.id, ['sent', 'sent', 'sent']);
        const messages = await messagesOf(order.id);
        expect(messages.map(m => [m.event, m.status])).toEqual([
            ['shipped', 'sent'],
            ['confirmed', 'sent'],
            ['placed', 'sent'],
        ]);
    });

    it('retries a failing provider and still sends once', async () => {
        driver.failNext = 2;
        const phone = newPhone();
        const order = await placePhoneOrder(shopClient, { phone });
        expect(await sentTo(phone, 1)).toHaveLength(1);
        expect(await statusesOf(order.id, ['sent'])).toEqual(['sent']);
    });

    it('skips what the customer opted out of, but sends what the store marks as required', async () => {
        const phone = newPhone();
        const order = await placePhoneOrder(shopClient, { phone });
        await sentTo(phone, 1);
        const { order: withCustomer } = await adminClient.query(
            gql`query ($id: ID!) { order(id: $id) { customer { id } } }`,
            { id: order.id },
        );
        await adminClient.query(
            gql`mutation ($id: ID!) { updateCustomer(input: { id: $id, customFields: { smsOptOut: true } }) { ... on Customer { id } } }`,
            { id: withCustomer.customer.id },
        );
        const second = await placePhoneOrder(shopClient, { phone });
        await adminClient.query(CONFIRM, { input: { orderId: second.id } });
        await sentTo(phone, 2);
        await statusesOf(second.id, ['sent', 'skipped']);
        const messages = await messagesOf(second.id);
        expect(messages.map(m => [m.event, m.status, m.reason])).toEqual([
            ['confirmed', 'sent', ''],
            ['placed', 'skipped', 'the customer opted out of SMS'],
        ]);
    });

    it('never sends to foreign numbers, and caps SMS per phone a day', async () => {
        const sms = server.app.get(SmsService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const foreign = await sms.queueSms(ctx, { event: 'placed', to: '+12025550123', language: 'en', values: {}, key: 'test:foreign' });
        expect(foreign).toMatchObject({ status: 'skipped', reason: 'not a Bangladeshi mobile number' });

        await saveSettings(s => ({ caps: { ...s.caps, perPhonePerDay: 1 } }));
        const phone = newPhone();
        const order = await placePhoneOrder(shopClient, { phone });
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        await sentTo(phone, 1);
        await statusesOf(order.id, ['skipped', 'sent']);
        const messages = await messagesOf(order.id);
        expect(messages.map(m => [m.event, m.status, m.reason])).toEqual([
            ['confirmed', 'skipped', 'daily limit for this phone'],
            ['placed', 'sent', ''],
        ]);
    });

    it('holds ordinary SMS during quiet hours, until the morning in Dhaka', async () => {
        const hour = (new Date().getUTCHours() + 6) % 24;
        // Quiet from this hour to two hours later: now is inside.
        await saveSettings(() => ({ quietHours: { enabled: true, startHour: hour, endHour: (hour + 2) % 24 } }));
        const phone = newPhone();
        const order = await placePhoneOrder(shopClient, { phone });
        await new Promise(resolve => setTimeout(resolve, 300));
        const [placed] = await messagesOf(order.id);
        expect(placed).toMatchObject({ event: 'placed', status: 'scheduled' });
        expect(new Date(placed!.sendAfter!).getTime()).toBeGreaterThan(Date.now());
        expect(driver.sent.some(message => message.to === `+880${phone.slice(1)}`)).toBe(false);
    });

    it('uses the merchant’s templates, and refuses an empty one', async () => {
        await saveSettings(s => ({
            events: { ...s.events, placed: { ...s.events.placed, bn: 'অর্ডার {orderNumber} পেলাম, {name}!' } },
        }));
        const phone = newPhone();
        await placePhoneOrder(shopClient, { phone, name: 'করিম' });
        expect((await sentTo(phone, 1))[0]!.text).toMatch(/^অর্ডার \d+ পেলাম, করিম!$/);
        const settings = defaultSmsSettings();
        const { updateBdSmsSettings } = await adminClient.query(SAVE_SETTINGS, {
            input: { ...settings, events: { ...settings.events, otp: { ...settings.events.otp, en: '' } } },
        });
        expect(updateBdSmsSettings.errors).toEqual([{ path: 'events.otp.en', code: 'required' }]);
    });

    it('sends nothing for a manual order with "Send SMS" off', async () => {
        const phone = newPhone();
        const { createBdManualOrder } = await adminClient.query(
            gql`
                mutation ($input: BdManualOrderInput!) {
                    createBdManualOrder(input: $input) { ... on Order { id } ... on BdManualOrderError { reason } }
                }
            `,
            {
                input: {
                    customer: { name: 'Karim', phone },
                    address: { districtId: DHAKA, thanaId: MIRPUR, streetLine1: 'House 1' },
                    lines: [{ variantId: 'T_1', quantity: 1 }],
                    payment: { type: 'cod' },
                    source: 'phone',
                    sendSms: false,
                    confirm: true,
                },
            },
        );
        expect(createBdManualOrder.id).toBeDefined();
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(await messagesOf(createBdManualOrder.id)).toEqual([]);
    });

    it('counts what was sent today', async () => {
        const { bdSmsUsage } = await adminClient.query(gql`
            {
                bdSmsUsage {
                    today {
                        messages
                        segments
                    }
                    month {
                        messages
                    }
                    provider
                }
            }
        `);
        expect(bdSmsUsage.today.messages).toBeGreaterThanOrEqual(7);
        expect(bdSmsUsage.today.segments).toBeGreaterThanOrEqual(bdSmsUsage.today.messages);
        expect(bdSmsUsage.month.messages).toBeGreaterThanOrEqual(bdSmsUsage.today.messages);
        expect(bdSmsUsage.provider).toBe('log');
    });
});
