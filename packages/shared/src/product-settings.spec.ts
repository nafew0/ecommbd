import { describe, expect, it } from 'vitest';
import { emptyProductForm, parseProductForm } from './catalog';
import { takaToMinor } from './money';
import {
    allUnits,
    autoSku,
    defaultProductSettings,
    parseProductSettings,
    productStatusOf,
    shippingClassCharge,
    trashExpiresAt,
    unitName,
} from './product-settings';

const tk = takaToMinor;

describe('product status', () => {
    it('reads enabled as published, and the stored reason otherwise', () => {
        expect(productStatusOf({ enabled: true })).toBe('published');
        expect(productStatusOf({ enabled: true, status: 'archived' })).toBe('published');
        expect(productStatusOf({ enabled: false })).toBe('draft');
        expect(productStatusOf({ enabled: false, status: 'archived' })).toBe('archived');
        expect(productStatusOf({ enabled: false, status: 'draft', trashedAt: new Date() })).toBe('trash');
    });

    it('keeps the trash for 30 days', () => {
        expect(trashExpiresAt(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });

    it('derives the status from enabled for older callers, and enabled from the status', () => {
        const published = parseProductForm({
            ...emptyProductForm(),
            status: undefined,
            name: { bn: 'ক', en: '' },
            variants: [{ ...emptyProductForm().variants[0]!, price: tk(100) }],
        });
        expect(published.ok && published.product.status).toBe('published');
        const form = emptyProductForm();
        const base = { ...form, name: { bn: 'ক', en: '' }, variants: [{ ...form.variants[0]!, price: tk(100) }] };
        const old = parseProductForm({ ...base, status: undefined, enabled: false });
        expect(old.ok && old.product.status).toBe('draft');
        const archived = parseProductForm({ ...base, status: 'archived', enabled: true });
        expect(archived.ok && archived.product.enabled).toBe(false);
    });
});

describe('product settings', () => {
    it('defaults to the P prefix and nothing else', () => {
        expect(defaultProductSettings()).toEqual({ skuPrefix: 'P', customUnits: [], shippingClasses: [] });
        expect(autoSku('P', 12, 1)).toBe('P12-1');
        expect(autoSku('SKU', '7', 3)).toBe('SKU7-3');
    });

    it('cleans the prefix and gives every unit and class a stable code', () => {
        const parsed = parseProductSettings({
            skuPrefix: ' ab-c ',
            customUnits: [{ name: { bn: 'হালি', en: 'Hali' } }, { name: { bn: 'বস্তা', en: '' } }],
            shippingClasses: [
                { name: { bn: 'বড় বাক্স', en: 'Bulky box' }, charge: tk(100) },
                { code: 'bulky-box', name: { bn: 'আবার', en: 'Again' }, charge: 0 },
            ],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.settings.skuPrefix).toBe('ABC');
        expect(parsed.settings.customUnits.map(unit => unit.code)).toEqual(['hali', 'unit-2']);
        expect(parsed.settings.shippingClasses.map(item => item.code)).toEqual(['bulky-box', 'bulky-box-2']);
    });

    it('refuses a missing name, an empty prefix and paisa', () => {
        const parsed = parseProductSettings({
            skuPrefix: '--',
            customUnits: [{ name: { bn: '', en: '' } }],
            shippingClasses: [{ name: { bn: 'ক', en: '' }, charge: 150 }],
        });
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.errors.map(error => error.path).sort()).toEqual([
            'customUnits.0.name.bn',
            'shippingClasses.0.charge',
            'skuPrefix',
        ]);
        const empty = parseProductSettings({ skuPrefix: '--', customUnits: [], shippingClasses: [] });
        expect(!empty.ok && empty.errors.map(error => error.path)).toEqual(['skuPrefix']);
    });

    it('refuses a unit that takes a built-in code', () => {
        const parsed = parseProductSettings({
            skuPrefix: 'P',
            customUnits: [{ name: { bn: 'কেজি', en: 'kg' } }],
            shippingClasses: [],
        });
        expect(!parsed.ok && parsed.errors).toEqual([{ path: 'customUnits.0.name.bn', code: 'taken' }]);
    });

    it('names a unit in the shopper’s language, and shows none for a removed one', () => {
        const settings = { customUnits: [{ code: 'hali', name: { bn: 'হালি', en: '' } }] };
        expect(allUnits(settings).map(unit => unit.code)).toEqual(['piece', 'kg', 'gram', 'litre', 'dozen', 'set', 'hali']);
        expect(unitName('kg', settings, 'bn')).toBe('কেজি');
        expect(unitName('hali', settings, 'en')).toBe('হালি');
        expect(unitName('gone', settings, 'bn')).toBeNull();
        expect(unitName(null, settings, 'bn')).toBeNull();
    });

    it('counts each class once', () => {
        const classes = [
            { code: 'bulky', charge: tk(100) },
            { code: 'fragile', charge: tk(30) },
        ];
        expect(shippingClassCharge(['bulky', 'bulky', null, 'fragile', 'gone'], classes)).toBe(tk(130));
        expect(shippingClassCharge([], classes)).toBe(0);
    });
});

describe('product settings edge cases', () => {
    it('refuses a name longer than 40 letters in either language', () => {
        const parsed = parseProductSettings({
            skuPrefix: 'P',
            customUnits: [{ name: { bn: 'ক', en: 'x'.repeat(41) } }],
            shippingClasses: [],
        });
        expect(!parsed.ok && parsed.errors).toEqual([{ path: 'customUnits.0.name.bn', code: 'tooLong' }]);
    });

    it('falls back to the other language, and to P for an empty prefix', () => {
        const settings = {
            customUnits: [
                { code: 'tin', name: { bn: '', en: 'tin' } },
                { code: 'blank', name: { bn: '', en: '' } },
            ],
        };
        expect(unitName('tin', settings, 'bn')).toBe('tin');
        expect(unitName('blank', settings, 'bn')).toBeNull();
        expect(autoSku('', 5, 2)).toBe('P5-2');
    });
});
