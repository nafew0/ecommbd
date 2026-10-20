import { describe, expect, it } from 'vitest';
import {
    changedSettingsPaths,
    emptyStoreSettings,
    parseStoreSettings,
    POLICY_KEYS,
    PRIVATE_STORE_SETTINGS_FIELDS,
    type StoreSettings,
    toPublicStoreSettings,
} from './store-settings';

function valid(): StoreSettings {
    const settings = emptyStoreSettings('bn');
    settings.profile.storeName = { bn: 'রহিম ফ্যাশন', en: 'Rahim Fashion' };
    return settings;
}

function errorsFor(change: (settings: StoreSettings) => void) {
    const settings = valid();
    change(settings);
    const result = parseStoreSettings(settings);
    return result.ok ? [] : result.errors;
}

describe('parseStoreSettings', () => {
    it('accepts blank settings with a store name', () => {
        const result = parseStoreSettings(valid());
        expect(result).toEqual({ ok: true, settings: valid() });
    });

    it('normalizes text, phone numbers (Bangla digits too), email and links', () => {
        const settings = valid();
        settings.profile.storeName.bn = '  রহিম\u200B  ফ্যাশন ';
        settings.profile.phones = ['০১৭১২-৩৪৫৬৭৮', '02-9123456', ''];
        settings.profile.whatsapp = '+880 1812 345678';
        settings.profile.ownerPhone = '01912345678';
        settings.profile.email = ' Shop@Example.COM ';
        settings.profile.messengerUrl = 'm.me/rahimfashion';
        settings.profile.social.facebook = 'https://facebook.com/rahimfashion';
        settings.profile.address.line = ' House 12,\r\n Road 5 ';
        const result = parseStoreSettings(settings);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const profile = result.settings.profile;
        expect(profile.storeName.bn).toBe('রহিম ফ্যাশন');
        expect(profile.phones).toEqual(['+8801712345678', '+88029123456']);
        expect(profile.whatsapp).toBe('+8801812345678');
        expect(profile.ownerPhone).toBe('+8801912345678');
        expect(profile.email).toBe('shop@example.com');
        expect(profile.messengerUrl).toBe('https://m.me/rahimfashion');
        expect(profile.social.facebook).toBe('https://facebook.com/rahimfashion');
        expect(profile.address.line).toBe('House 12,\nRoad 5');
    });

    it('requires a store name in at least one language', () => {
        expect(errorsFor(s => (s.profile.storeName = { bn: ' ', en: '' }))).toEqual([
            { path: 'profile.storeName', code: 'required' },
        ]);
        expect(errorsFor(s => (s.profile.storeName = { bn: '', en: 'Rahim' }))).toEqual([]);
    });

    it('reports invalid phones, emails and links with codes the admin translates', () => {
        expect(
            errorsFor(s => {
                s.profile.phones = ['12345'];
                s.profile.whatsapp = '02-9123456';
                s.profile.email = 'not-an-email';
                s.profile.messengerUrl = 'javascript:alert(1)';
                s.profile.social.youtube = 'https://localhost';
            }),
        ).toEqual([
            { path: 'profile.phones.0', code: 'invalidPhone' },
            { path: 'profile.whatsapp', code: 'invalidMobile' },
            { path: 'profile.messengerUrl', code: 'invalidUrl' },
            { path: 'profile.email', code: 'invalidEmail' },
            { path: 'profile.social.youtube', code: 'invalidUrl' },
        ]);
        expect(errorsFor(s => (s.profile.social.tiktok = 'not a url'))).toEqual([
            { path: 'profile.social.tiktok', code: 'invalidUrl' },
        ]);
    });

    it('enforces lengths and counts', () => {
        expect(errorsFor(s => (s.profile.storeName.en = 'x'.repeat(101)))).toEqual([
            { path: 'profile.storeName.en', code: 'tooLong' },
        ]);
        expect(
            errorsFor(s => (s.profile.social.instagram = `https://instagram.com/${'a'.repeat(500)}`)),
        ).toEqual([{ path: 'profile.social.instagram', code: 'tooLong' }]);
        expect(
            errorsFor(s => (s.profile.phones = ['01712345678', '01812345678', '01912345678', '01612345678'])),
        ).toEqual([{ path: 'profile.phones', code: 'tooMany' }]);
    });

    it('needs both district and thana in the store address', () => {
        expect(errorsFor(s => (s.profile.address.districtId = 'BD3026'))).toEqual([
            { path: 'profile.address.thanaId', code: 'required' },
        ]);
        expect(errorsFor(s => (s.profile.address.thanaId = 'BD3026M26'))).toEqual([
            { path: 'profile.address.districtId', code: 'required' },
        ]);
    });

    it('uses "invalid" for anything that is not one of our codes (wrong types)', () => {
        const result = parseStoreSettings({
            ...valid(),
            locale: { defaultLanguage: 'fr', banglaDigits: 'yes' },
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map(error => error.code)).toEqual(['invalid', 'invalid', 'invalid']);
    });
});

describe('public and private fields', () => {
    it('removes the owner phone and keeps everything else', () => {
        const settings = valid();
        settings.profile.ownerPhone = '+8801912345678';
        settings.profile.tradeLicenceNumber = 'TRAD/DNCC/012345/2026';
        const publicSettings = toPublicStoreSettings(settings);
        expect(JSON.stringify(publicSettings)).not.toContain('+8801912345678');
        expect(publicSettings.profile.tradeLicenceNumber).toBe('TRAD/DNCC/012345/2026');
        expect(PRIVATE_STORE_SETTINGS_FIELDS).toEqual(['profile.ownerPhone']);
    });
});

describe('emptyStoreSettings', () => {
    it('starts in the chosen language with every policy empty', () => {
        expect(emptyStoreSettings('en').locale.defaultLanguage).toBe('en');
        expect(emptyStoreSettings().locale.defaultLanguage).toBe('bn');
        expect(POLICY_KEYS.map(key => emptyStoreSettings().policies[key].isTemplate)).toEqual([
            false,
            false,
            false,
            false,
        ]);
    });
});

describe('changedSettingsPaths', () => {
    it('lists the leaf paths that changed, treating arrays as one value', () => {
        const before = valid();
        const after = valid();
        after.profile.phones = ['+8801712345678'];
        after.locale.banglaDigits = true;
        after.policies.terms.bn = 'নতুন শর্তাবলি';
        expect(changedSettingsPaths(before, after)).toEqual([
            'profile.phones',
            'policies.terms.bn',
            'locale.banglaDigits',
        ]);
        expect(changedSettingsPaths(before, valid())).toEqual([]);
        expect(changedSettingsPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    });
});
