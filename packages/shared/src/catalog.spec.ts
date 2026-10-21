import { describe, expect, it } from 'vitest';
import {
    emptyProductForm,
    emptyVariant,
    parseProductForm,
    parseYoutubeUrl,
    type ProductForm,
    slugify,
} from './catalog';
import { takaToMinor } from './money';

const tk = takaToMinor;

const product = (patch: Partial<ProductForm> = {}): ProductForm => {
    const base = emptyProductForm();
    return {
        ...base,
        name: { bn: 'সুতি পাঞ্জাবি', en: 'Cotton panjabi' },
        variants: [{ ...base.variants[0]!, price: tk(1250) }],
        ...patch,
    };
};

const errors = (input: unknown) => {
    const result = parseProductForm(input);
    return result.ok ? [] : result.errors;
};

describe('parseProductForm', () => {
    it('accepts a simple product and cleans its text', () => {
        const result = parseProductForm(product({ name: { bn: '  সুতি  পাঞ্জাবি ', en: '' } }));
        expect(result.ok && result.product.name).toEqual({ bn: 'সুতি পাঞ্জাবি', en: '' });
    });

    it('needs a name in at least one language, and a price', () => {
        expect(errors(product({ name: { bn: '', en: '' } }))).toEqual([
            { path: 'name.bn', code: 'required' },
        ]);
        const noPrice = product();
        noPrice.variants[0]!.price = 0;
        expect(errors(noPrice)).toEqual([{ path: 'variants.0.price', code: 'required' }]);
    });

    it('refuses fractional taka and an old price that isn’t higher', () => {
        const bad = product();
        bad.variants[0] = { ...bad.variants[0]!, price: 125_050 };
        expect(errors(bad)).toEqual([{ path: 'variants.0.price', code: 'invalid' }]);
        const old = product();
        old.variants[0] = { ...old.variants[0]!, oldPrice: tk(1250) };
        expect(errors(old)).toEqual([{ path: 'variants.0.oldPrice', code: 'invalid' }]);
        old.variants[0] = { ...old.variants[0]!, oldPrice: tk(1500) };
        expect(errors(old)).toEqual([]);
    });

    it('has exactly one variant without variations', () => {
        expect(
            errors(
                product({
                    variants: [
                        { ...emptyVariant(), price: 1 * 100 },
                        { ...emptyVariant(), price: 100 },
                    ],
                }),
            ),
        ).toEqual([{ path: 'variants', code: 'invalid' }]);
    });

    it('needs a unique option name for each variation, and a name for custom ones', () => {
        const sized = product({
            variationType: 'size',
            variants: [
                { ...emptyVariant(), price: tk(1250), option: { bn: '', en: 'M' } },
                { ...emptyVariant(), price: tk(1300), option: { bn: '', en: 'm' } },
                { ...emptyVariant(), price: tk(1300), option: { bn: '', en: '' } },
            ],
        });
        expect(errors(sized)).toEqual([
            { path: 'variants.1.option.bn', code: 'invalid' },
            { path: 'variants.2.option.bn', code: 'required' },
        ]);
        const custom = product({
            variationType: 'custom',
            variants: [{ ...emptyVariant(), price: tk(100), option: { bn: 'আম', en: '' } }],
        });
        expect(errors(custom)).toEqual([{ path: 'variationName.bn', code: 'required' }]);
    });

    it('keeps exactly one default variant', () => {
        const none = product({
            variationType: 'colour',
            variants: [
                { ...emptyVariant(), price: tk(100), option: { bn: 'লাল', en: 'Red' } },
                { ...emptyVariant(), price: tk(100), option: { bn: 'নীল', en: 'Blue' } },
            ],
        });
        const first = parseProductForm(none);
        expect(first.ok && first.product.variants.map(v => v.isDefault)).toEqual([true, false]);
        none.variants = none.variants.map(variant => ({ ...variant, isDefault: true }));
        const both = parseProductForm(none);
        expect(both.ok && both.product.variants.map(v => v.isDefault)).toEqual([true, false]);
        none.variants = [
            { ...none.variants[0]!, isDefault: false },
            { ...none.variants[1]!, isDefault: true },
        ];
        const second = parseProductForm(none);
        expect(second.ok && second.product.variants.map(v => v.isDefault)).toEqual([false, true]);
    });

    it('checks the YouTube link and the image counts', () => {
        expect(errors(product({ youtubeUrl: 'https://vimeo.com/1' }))).toEqual([
            { path: 'youtubeUrl', code: 'invalidUrl' },
        ]);
        expect(errors(product({ galleryAssetIds: Array.from({ length: 11 }, (_, i) => String(i)) }))).toEqual(
            [{ path: 'galleryAssetIds', code: 'tooMany' }],
        );
    });
});

describe('parseYoutubeUrl', () => {
    it.each([
        ['', ''],
        ['youtu.be/abc123', 'https://youtu.be/abc123'],
        ['http://www.youtube.com/watch?v=abc', 'https://www.youtube.com/watch?v=abc'],
        ['https://m.youtube.com/shorts/xyz', 'https://m.youtube.com/shorts/xyz'],
    ])('reads %j', (input, expected) => {
        expect(parseYoutubeUrl(input)).toBe(expected);
    });

    it.each([['https://vimeo.com/1'], ['not a url at all ::'], ['https://youtube.evil.com/x']])(
        'refuses %j',
        input => {
            expect(parseYoutubeUrl(input)).toBeNull();
        },
    );
});

describe('slugify', () => {
    it.each([
        ['Cotton Panjabi (Blue)', 'cotton-panjabi-blue'],
        ['  Café crème  ', 'cafe-creme'],
        ['সুতি পাঞ্জাবি', ''],
    ])('%j → %j', (input, expected) => {
        expect(slugify(input)).toBe(expected);
    });
});
