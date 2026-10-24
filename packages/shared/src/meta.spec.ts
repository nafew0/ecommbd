import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    defaultMetaSettings,
    FBC_PATTERN,
    FBP_PATTERN,
    metaCity,
    metaEmail,
    metaName,
    metaPhone,
    parseMetaSettings,
    purchaseEventId,
} from './meta';
import { hashedUserData, sha256 } from './meta-hash';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Meta normalization', () => {
    it('follows Meta’s rules for each field', () => {
        expect(metaPhone('+8801712345678')).toBe('8801712345678');
        expect(metaEmail('  John_Smith@Gmail.com ')).toBe('john_smith@gmail.com');
        expect(metaName('Md. Rahim Uddin')).toEqual({ fn: 'md', ln: 'rahim uddin' });
        expect(metaName('রহিম উদ্দিন')).toEqual({ fn: 'রহিম', ln: 'উদ্দিন' });
        expect(metaName('Rahim')).toEqual({ fn: 'rahim', ln: '' });
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
    });
});
