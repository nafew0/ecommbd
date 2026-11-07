import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    checkoutEventId,
    classifyMetaError,
    defaultMetaSettings,
    FBC_PATTERN,
    FBP_PATTERN,
    isBrowserEvent,
    metaActionSource,
    metaCity,
    metaEmail,
    metaName,
    metaPhone,
    parseMetaSettings,
    purchaseEventId,
} from './meta';
import { hashedUserData, sha256 } from './meta-hash';
import { isPrivateMetaPath, metaPageUrl } from './meta-url';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Meta normalization', () => {
    it('follows Meta’s rules for each field', () => {
        expect(metaPhone('+8801712345678')).toBe('8801712345678');
        expect(metaEmail('  John_Smith@Gmail.com ')).toBe('john_smith@gmail.com');
        expect(metaName('Md. Rahim Uddin')).toEqual({ fn: 'md', ln: 'rahim uddin' });
        expect(metaName('রহিম উদ্দিন')).toEqual({ fn: 'রহিম', ln: 'উদ্দিন' });
        expect(metaName('Rahim')).toEqual({ fn: 'rahim', ln: '' });
        expect(metaName(' . ')).toEqual({ fn: '', ln: '' });
        expect(metaCity("Cox's Bazar")).toBe('coxsbazar');
    });

    it('hashes with SHA-256 the way Meta’s examples do', () => {
        // Meta's documented example: the email "john_smith@gmail.com".
        expect(sha256(metaEmail('John_Smith@gmail.com'))).toBe(hash('john_smith@gmail.com'));
        expect(sha256('john_smith@gmail.com')).toBe(
            '62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f',
        );
    });

    it('builds user data without placeholder emails or empty fields', () => {
        const data = hashedUserData({
            phone: '+8801712345678',
            email: '8801712345678@phone.invalid',
            fullName: 'রহিম উদ্দিন',
            city: 'Dhaka',
            externalId: '42',
        });
        expect(Object.keys(data).sort()).toEqual(['country', 'ct', 'external_id', 'fn', 'ln', 'ph']);
        expect(data.ph).toEqual([hash('8801712345678')]);
        expect(data.fn).toEqual([hash('রহিম')]);
        expect(data.country).toEqual([hash('bd')]);
        expect(data.ct).toEqual([hash('dhaka')]);
        expect(hashedUserData({ email: 'a@b.com' }).em).toEqual([hash('a@b.com')]);
    });
});

describe('Meta settings and IDs', () => {
    it('accepts the defaults, two pixels at most, digits only', () => {
        expect(parseMetaSettings(defaultMetaSettings()).ok).toBe(true);
        expect(parseMetaSettings({ ...defaultMetaSettings(), pixelIds: ['123456', '123456'] })).toMatchObject(
            {
                ok: true,
                settings: { pixelIds: ['123456'] },
            },
        );
        expect(parseMetaSettings({ ...defaultMetaSettings(), pixelIds: ['12a456'] }).ok).toBe(false);
        expect(
            parseMetaSettings({ ...defaultMetaSettings(), pixelIds: ['123456', '234567', '345678'] }).ok,
        ).toBe(false);
    });

    it('checks the Meta cookies and gives a Purchase the same ID everywhere', () => {
        expect(FBP_PATTERN.test('fb.1.1729750000000.1234567890')).toBe(true);
        expect(FBP_PATTERN.test('fb.1.x.1')).toBe(false);
        expect(FBC_PATTERN.test('fb.1.1729750000000.IwAR2abc-DEF_123')).toBe(true);
        expect(purchaseEventId('ABC123')).toBe('purchase-ABC123');
        expect(checkoutEventId('ABC123')).toBe('checkout-ABC123');
    });

    it('takes only the four browser events from the storefront', () => {
        expect(isBrowserEvent('ViewContent')).toBe(true);
        expect(isBrowserEvent('Purchase')).toBe(false);
        expect(isBrowserEvent(42)).toBe(false);
    });
});

describe('Meta errors and action sources', () => {
    it('tells a bad token and a refused Pixel from a busy Meta and a bad event', () => {
        expect(classifyMetaError(400, 190)).toBe('token');
        expect(classifyMetaError(401)).toBe('token');
        // A wrong Pixel ID or a token without permission: the whole Pixel, never event by event.
        expect(classifyMetaError(403, 10)).toBe('pixel');
        expect(classifyMetaError(400, 200)).toBe('pixel');
        expect(classifyMetaError(400, 299)).toBe('pixel');
        expect(classifyMetaError(400, 803)).toBe('pixel');
        expect(classifyMetaError(400, 100, 33)).toBe('pixel');
        expect(classifyMetaError(429)).toBe('retry');
        expect(classifyMetaError(503)).toBe('retry');
        expect(classifyMetaError(400, 613)).toBe('retry');
        expect(classifyMetaError(400, 100)).toBe('invalid');
        expect(classifyMetaError(400, 300)).toBe('invalid');
        expect(classifyMetaError(400)).toBe('invalid');
    });

    it('says how a manual order came in', () => {
        expect(metaActionSource(undefined)).toBe('website');
        expect(metaActionSource('web')).toBe('website');
        expect(metaActionSource('phone')).toBe('phone_call');
        expect(metaActionSource('messenger')).toBe('chat');
        expect(metaActionSource('whatsapp')).toBe('chat');
        expect(metaActionSource('facebookComment')).toBe('chat');
        expect(metaActionSource('walkIn')).toBe('physical_store');
        expect(metaActionSource('import')).toBe('system_generated');
        expect(metaActionSource('manual')).toBe('other');
    });
});

describe('the page address Meta sees', () => {
    it('keeps campaign tags and drops every other query parameter and the fragment', () => {
        expect(
            metaPageUrl(
                'https://shop.example.com/product/panjabi/?utm_source=fb&fbclid=IwAR2&phone=017&x=1#top',
            ),
        ).toBe('https://shop.example.com/product/panjabi/?utm_source=fb&fbclid=IwAR2');
        expect(metaPageUrl('https://shop.example.com/checkout/thank-you/?order=ABC123XYZ')).toBe(
            'https://shop.example.com/checkout/thank-you/',
        );
        expect(metaPageUrl('https://shop.example.com/checkout/pay/?to=attempt-secret')).toBe(
            'https://shop.example.com/checkout/pay/',
        );
        expect(metaPageUrl('https://user:pass@shop.example.com/?utm_campaign=')).toBe(
            'https://shop.example.com/',
        );
    });

    it('replaces the tracking link’s token and payment routes', () => {
        expect(metaPageUrl('https://shop.example.com/t/SECRETTOKEN123/')).toBe(
            'https://shop.example.com/t/-/',
        );
        expect(metaPageUrl('https://shop.example.com/en/t/SECRETTOKEN123/')).toBe(
            'https://shop.example.com/en/t/-/',
        );
        expect(metaPageUrl('https://shop.example.com/bd-pay/start/attempt123')).toBe(
            'https://shop.example.com/bd-pay/',
        );
    });

    it('refuses what isn’t a web address', () => {
        expect(metaPageUrl('not a url')).toBeNull();
        expect(metaPageUrl('javascript:alert(1)')).toBeNull();
    });

    it('knows the pages that are never tracked', () => {
        for (const path of ['/t/abc/', '/en/t/abc/', '/track/', '/checkout/pay/', '/account/', '/bd-pay/x'])
            expect(isPrivateMetaPath(path)).toBe(true);
        for (const path of ['/', '/en', '/product/x/', '/checkout/', '/checkout/thank-you/', '/s/offer/'])
            expect(isPrivateMetaPath(path)).toBe(false);
    });
});
