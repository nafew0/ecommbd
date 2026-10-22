import { describe, expect, it } from 'vitest';
import { createSection, documentIssues, readDocument } from './document';
import { fillFromProduct, LANDING_CATEGORIES, LANDING_TEMPLATES, landingTemplate } from './landing-templates';
import { sectionDefinition } from './registry';
import {
    checkSalesSettings,
    defaultSalesSettings,
    isSameSitePath,
    packSaving,
    readPrice,
    readSalesSettings,
    SALES_LIMITS,
    salesColoursCss,
    toSalesSlug,
} from './sales-page';
import { COLUMN_LAYOUTS, ELEMENT_KINDS } from './sections/custom';
import { readThemeSettings } from './theme';

const product = { name: { bn: 'খাঁটি সরিষার তেল', en: 'Pure mustard oil' } };

describe('the Custom section', () => {
    it('offers every element kind, with columns up to four', () => {
        const definition = sectionDefinition('custom')!;
        const kinds = definition.blocks!.fields.kind!;
        expect(kinds.kind === 'select' && kinds.options.map(option => option.value)).toEqual([
            ...ELEMENT_KINDS,
        ]);
        expect(Math.max(...Object.values(COLUMN_LAYOUTS).map(widths => widths.length))).toBe(4);
        expect(definition.blocks!.max).toBe(40);
    });

    it('starts with a photo beside a heading, text and an order button', () => {
        const section = createSection('custom');
        expect(section.blocks.map(block => [block.settings.kind, block.settings.column])).toEqual([
            ['image', '1'],
            ['heading', '2'],
            ['text', '2'],
            ['button', '2'],
        ]);
        expect(section.blocks[3]!.settings.link).toEqual({ type: 'anchor', anchor: 'order' });
    });

    it('keeps only checked element values', () => {
        const document = readDocument({
            sections: [
                {
                    uid: 'custom01',
                    type: 'custom',
                    v: 1,
                    settings: { layout: '9-9', gap: 500 },
                    blocks: [
                        {
                            uid: 'elem0001',
                            settings: {
                                kind: 'marquee',
                                color: 'url(x)',
                                size: 400,
                                price: 99_999,
                                script: 'x',
                            },
                        },
                    ],
                },
            ],
        });
        const section = document.sections[0]!;
        expect(section.settings).toMatchObject({ layout: '1-1', gap: 80 });
        expect(section.blocks[0]!.settings).toMatchObject({
            kind: 'heading',
            color: '',
            size: 120,
            price: 100_000,
        });
        expect(section.blocks[0]!.settings).not.toHaveProperty('script');
    });
});

describe('sales sections', () => {
    it('only lets a page have one order form', () => {
        const first = createSection('order-form');
        const second = createSection('order-form');
        expect(documentIssues({ sections: [first] })).toEqual([]);
        expect(documentIssues({ sections: [first, second] })).toContainEqual({
            sectionId: second.uid,
            field: 'sections',
            code: 'duplicateOrderForm',
        });
    });

    it('jump to the order form by its anchor', () => {
        expect(createSection('order-form').style.anchor).toBe('order');
        expect(createSection('sales-hero').style.align).toBe('center');
        expect(createSection('countdown').settings).toMatchObject({ mode: 'fixed', hours: 6, endsAt: '' });
    });
});

describe('sales page templates', () => {
    it('are twelve, in known categories, with unique ids and both languages', () => {
        expect(LANDING_TEMPLATES).toHaveLength(12);
        expect(new Set(LANDING_TEMPLATES.map(template => template.id)).size).toBe(12);
        for (const template of LANDING_TEMPLATES) {
            expect(LANDING_CATEGORIES).toContain(template.category);
            expect(template.name.bn && template.name.en, template.id).toBeTruthy();
            expect(template.description.bn && template.description.en, template.id).toBeTruthy();
        }
        // Every category has at least one.
        expect(new Set(LANDING_TEMPLATES.map(template => template.category))).toEqual(
            new Set(LANDING_CATEGORIES),
        );
        expect(landingTemplate('herbal')?.category).toBe('health');
        expect(landingTemplate('nope')).toBeUndefined();
    });

    it('build pages ready to publish, with the product name, packs and one order form', () => {
        for (const template of LANDING_TEMPLATES) {
            const document = template.build(product);
            const types = document.sections.map(section => section.type);
            expect(documentIssues(document), template.id).toEqual([]);
            expect(readDocument(document), template.id).toEqual(document);
            expect(types[0], template.id).toBe('sales-hero');
            expect(
                types.filter(type => type === 'order-form'),
                template.id,
            ).toHaveLength(1);
            expect(types, template.id).toContain('price-packs');
            expect(document.sections[0]!.settings.headline).toEqual(product.name);
            const uids = document.sections.map(section => section.uid);
            expect(new Set(uids).size, template.id).toBe(uids.length);
        }
    });

    it("take the product's video and review screenshots", () => {
        const document = landingTemplate('gadget')!.build(product);
        const filled = fillFromProduct(document, {
            video: 'https://youtu.be/dQw4w9WgXcQ',
            reviews: [
                { assetId: '7', preview: '/a.jpg' },
                { assetId: '8', preview: '/b.jpg' },
            ],
        });
        const video = filled.sections.find(section => section.type === 'video')!;
        expect(video.hidden).toBe(false);
        expect(video.settings.video).toBe('https://youtu.be/dQw4w9WgXcQ');
        const reviews = filled.sections.find(section => section.type === 'testimonials')!;
        expect(reviews.hidden).toBe(false);
        expect(reviews.settings.look).toBe('screenshots');
        expect(reviews.blocks.map(block => block.settings.photo)).toEqual([
            { assetId: '7', preview: '/a.jpg' },
            { assetId: '8', preview: '/b.jpg' },
        ]);
        expect(documentIssues(filled)).toEqual([]);
        // Without them, nothing changes.
        expect(fillFromProduct(document, {})).toEqual(document);
    });

    it('use the other language when the product has a name in one only', () => {
        const document = landingTemplate('general')!.build({ name: { bn: '', en: 'Chia seeds' } });
        expect(document.sections[0]!.settings.headline).toEqual({ bn: 'Chia seeds', en: 'Chia seeds' });
    });
});

describe('sales page settings', () => {
    it('default to a slim header, hidden from Google, a sticky bar and a thank-you message', () => {
        const settings = readSalesSettings(undefined);
        expect(settings).toEqual(defaultSalesSettings());
        expect(settings).toMatchObject({
            header: 'slim',
            hideFromGoogle: true,
            stickyBar: true,
            width: 'phone',
        });
        expect(settings.thankYou.message.bn).toBeTruthy();
        // A merchant may clear the message on purpose.
        expect(readSalesSettings({ thankYou: { message: { bn: '', en: '' } } }).thankYou.message.bn).toBe('');
    });

    it('read packs as whole taka, sorted, without duplicates or nonsense', () => {
        const settings = readSalesSettings({
            packs: [
                { quantity: 3, price: 250_050, label: { bn: 'ফ্যামিলি', en: 'Family' }, popular: true },
                { quantity: 1, price: '100000' },
                { quantity: 3, price: 1 },
                { quantity: 0, price: 100 },
                { quantity: 2, price: -5 },
                { quantity: 1.5, price: 100 },
            ],
        });
        expect(settings.packs).toEqual([
            { quantity: 1, price: 100_000, label: { bn: '', en: '' }, popular: false },
            { quantity: 3, price: 250_100, label: { bn: 'ফ্যামিলি', en: 'Family' }, popular: true },
        ]);
        expect(readPrice(0)).toBeNull();
        expect(readPrice('x')).toBeNull();
        expect(readPrice(1e15)).toBe(SALES_LIMITS.maxPrice);
    });

    it('keep colours, header and redirect only when they are safe', () => {
        const settings = readSalesSettings({
            header: 'giant',
            colours: { main: '#C00', sale: 'red', background: '' },
            font: 'Comic Sans',
            thankYou: { redirect: 'https://evil.example/', whatsapp: false },
            bump: { enabled: true, variantId: '12', price: 30_000, title: { bn: 'সাথে নিন', en: 'Add' } },
        });
        expect(settings.header).toBe('slim');
        expect(settings.colours).toEqual({ main: '#cc0000', sale: '', background: '' });
        expect(settings.font).toBe('');
        expect(settings.thankYou).toMatchObject({ redirect: '', whatsapp: false });
        expect(settings.bump).toMatchObject({ enabled: true, variantId: '12', price: 30_000 });
        expect(readSalesSettings({ bump: { variantId: '1; drop table' } }).bump.variantId).toBeNull();
    });

    it('say what stops them from being saved', () => {
        const { errors } = checkSalesSettings({
            packs: [
                { quantity: 2, price: 100_000 },
                { quantity: 2, price: 150_000 },
                { quantity: 30, price: 0 },
            ],
            thankYou: { redirect: '//evil.example' },
            bump: { enabled: true },
        });
        expect(errors).toEqual([
            { path: 'packs.1.quantity', code: 'duplicatePack' },
            { path: 'packs.2.quantity', code: 'invalidQuantity' },
            { path: 'packs.2.price', code: 'invalidPrice' },
            { path: 'thankYou.redirect', code: 'invalidRedirect' },
            { path: 'bump', code: 'bumpIncomplete' },
        ]);
        const tooMany = Array.from({ length: 7 }, (_, index) => ({ quantity: index + 1, price: 100 }));
        expect(checkSalesSettings({ packs: tooMany }).errors).toEqual([
            { path: 'packs', code: 'tooManyPacks' },
        ]);
        expect(checkSalesSettings(defaultSalesSettings()).errors).toEqual([]);
    });

    it('allow only redirects on this site', () => {
        expect(isSameSitePath('/products/honey/')).toBe(true);
        expect(isSameSitePath('/')).toBe(true);
        expect(isSameSitePath('//evil.example')).toBe(false);
        expect(isSameSitePath('/\\evil.example')).toBe(false);
        expect(isSameSitePath('https://evil.example')).toBe(false);
        expect(isSameSitePath('/a b')).toBe(false);
        expect(isSameSitePath(`/${'a'.repeat(300)}`)).toBe(false);
    });

    it("put the page's own colours over the theme's", () => {
        const theme = readThemeSettings({});
        expect(salesColoursCss(theme, defaultSalesSettings())).toBe('');
        const settings = readSalesSettings({ colours: { main: '#0a6b3d', sale: '#d4380d' } });
        const css = salesColoursCss(theme, settings);
        expect(css.startsWith('html[data-theme][data-theme][data-theme]{')).toBe(true);
        expect(css).toContain('--accent:#0a6b3d');
        expect(css).toContain('--on-accent:#ffffff');
        expect(css).toContain('--sale:#d4380d');
        expect(css).toContain(`--background:${theme.colours.background}`);
    });

    it('work out what a pack saves', () => {
        const pack = { quantity: 3, price: 250_000, label: { bn: '', en: '' }, popular: false };
        expect(packSaving(pack, 100_000)).toBe(50_000);
        expect(packSaving(pack, 50_000)).toBe(0);
    });

    it('make addresses from titles in either language', () => {
        expect(toSalesSlug('  Chia Seeds — Offer!! ')).toBe('chia-seeds-—-offer');
        expect(toSalesSlug('খাঁটি মধু।')).toBe('খাঁটি-মধু');
        expect(toSalesSlug('a'.repeat(100))).toHaveLength(SALES_LIMITS.slug);
    });
});
