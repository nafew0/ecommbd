import { describe, expect, it } from 'vitest';
import {
    defaultSmsSettings,
    newTrackingToken,
    parseSmsSettings,
    renderSmsTemplate,
    smsSegments,
} from './sms';

describe('smsSegments', () => {
    it('counts plain English as GSM-7: 160 in one SMS, 153 per part', () => {
        expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'gsm7', units: 160, segments: 1, perSegment: 160 });
        expect(smsSegments('a'.repeat(161))).toEqual({ encoding: 'gsm7', units: 161, segments: 2, perSegment: 153 });
        expect(smsSegments('a'.repeat(306)).segments).toBe(2);
        expect(smsSegments('a'.repeat(307)).segments).toBe(3);
    });

    it('counts extension characters (€, [, ], {, }) twice', () => {
        expect(smsSegments('Tk 100 €').units).toBe(9);
        expect(smsSegments('{}'.repeat(40)).units).toBe(160);
    });

    it('counts Bangla as Unicode: 70 in one SMS, 67 per part', () => {
        const bangla = 'আপনার অর্ডার কনফার্ম হয়েছে';
        expect(smsSegments(bangla)).toMatchObject({ encoding: 'ucs2', units: bangla.length, segments: 1 });
        expect(smsSegments('অ'.repeat(70)).segments).toBe(1);
        expect(smsSegments('অ'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
        expect(smsSegments('অ'.repeat(134)).segments).toBe(2);
        expect(smsSegments('অ'.repeat(135)).segments).toBe(3);
    });

    it('treats mixed text and emoji as Unicode; an emoji takes two units', () => {
        expect(smsSegments('Order 1001 confirmed অর্ডার').encoding).toBe('ucs2');
        expect(smsSegments('Thanks 😊')).toMatchObject({ encoding: 'ucs2', units: 9 });
        expect(smsSegments('')).toMatchObject({ encoding: 'gsm7', segments: 1 });
    });
});

describe('renderSmsTemplate', () => {
    it('fills the variables as plain text', () => {
        expect(
            renderSmsTemplate('{name}, order #{orderNumber}: Tk {total}', { name: 'Rahim', orderNumber: '1001', total: '1,310' }, 'en'),
        ).toBe('Rahim, order #1001: Tk 1,310');
        // Values are never interpreted: braces in a value stay as they are.
        expect(renderSmsTemplate('{name}', { name: '{total}' }, 'en')).toBe('{total}');
    });

    it('uses safe defaults for missing values and drops unknown ones', () => {
        expect(renderSmsTemplate('{name}, ধন্যবাদ। {storeName}', {}, 'bn')).toBe('গ্রাহক, ধন্যবাদ। আমাদের দোকান');
        expect(renderSmsTemplate('Track: {trackingUrl} .', { trackingUrl: null }, 'en')).toBe('Track:.');
        expect(renderSmsTemplate('Hi {nonsense}', {}, 'en')).toBe('Hi');
    });
});

describe('sms settings', () => {
    it('has defaults that pass the schema', () => {
        const settings = defaultSmsSettings();
        expect(parseSmsSettings(settings)).toEqual({ ok: true, settings });
        expect(settings.events.otp).toMatchObject({ enabled: true, required: true });
        expect(settings.events.delivered.enabled).toBe(false);
    });

    it('refuses an empty template and a bad sender ID', () => {
        const settings = defaultSmsSettings();
        expect(
            parseSmsSettings({ ...settings, events: { ...settings.events, placed: { ...settings.events.placed, bn: ' ' } } }),
        ).toEqual({ ok: false, errors: [{ path: 'events.placed.bn', code: 'required' }] });
        expect(parseSmsSettings({ ...settings, senderId: 'Rahim-Fashion!' }).ok).toBe(false);
    });
});

describe('newTrackingToken', () => {
    it('is 22 URL-safe characters from 16 random bytes', () => {
        const token = newTrackingToken(bytes => bytes.fill(251));
        expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(token).toBe('-_v7-_v7-_v7-_v7-_v7-w');
    });
});
