import { defaultPrintSettings, type PrintLanguage, type PrintSettings } from '@ecommbd/shared/print-settings';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { docLabels, type PrintOrder, printFormat, type PrintStore } from '../../lib/print';
import type { TemplateProps } from './common';
import { InvoiceDocuments } from './invoice';
import { ReceiptDocuments } from './receipt';
import { StickerDocuments } from './sticker';

/** Snapshot tests of each print template's HTML with Bangla and English data (roadmap phase 06). */

const order: PrintOrder = {
    id: '1',
    orderNumber: 'MF-1001',
    placedAt: '2026-10-21T17:59:00.000Z',
    customerName: 'রহিম উদ্দিন',
    phone: '+8801712345678',
    alternatePhone: '+8801812345678',
    streetLine1: 'বাসা ১২, রোড ৫, ব্লক সি',
    area: 'মিরপুর ১০',
    districtId: 'BD3026',
    thanaId: 'BD3026M26',
    landmark: 'মসজিদের পাশে',
    note: 'বিকেল ৫টার পরে দিন',
    lines: [
        {
            name: 'সুতির পাঞ্জাবি (সাদা, XL)',
            sku: 'PANJABI-1',
            quantity: 2,
            unitPrice: 125000,
            linePrice: 250000,
        },
        { name: 'Silk Saree', sku: 'SAREE-1', quantity: 1, unitPrice: 450000, linePrice: 450000 },
    ],
    subtotal: 700000,
    discount: 20000,
    delivery: 6000,
    total: 686000,
    paid: 6000,
    codDue: 680000,
    paymentType: 'advance',
    paymentMethods: ['bKash'],
    printedAt: null,
    courierConsignment: null,
};

const store: PrintStore = {
    name: { bn: 'রহিম ফ্যাশন', en: 'Rahim Fashion' },
    phones: ['+8801912345678'],
    addressLine: 'House 7, Road 2',
    area: 'Dhanmondi',
    districtId: 'BD3026',
    thanaId: 'BD3026M10',
    logo: null,
    returnPolicy: { bn: 'পণ্য হাতে পেয়ে দেখে নিন।', en: 'Please check your order on delivery.' },
};

function props(
    language: PrintLanguage,
    change: (settings: PrintSettings) => void = () => undefined,
): TemplateProps {
    const settings = defaultPrintSettings();
    settings.language = language;
    change(settings);
    return {
        orders: [order, { ...order, id: '2', orderNumber: 'MF-1002', printedAt: '2026-10-21T18:00:00.000Z' }],
        store,
        settings,
        labels: docLabels(language),
        format: printFormat(settings.banglaDigits),
        place: () => (language === 'en' ? 'Mirpur 10, Mirpur, Dhaka' : 'মিরপুর ১০, মিরপুর, ঢাকা'),
        fontsReady: true,
    };
}

describe('print templates', () => {
    it.each(['bn', 'en'] as const)('renders an A4 invoice in %s', language => {
        const html = renderToStaticMarkup(<InvoiceDocuments {...props(language)} kind="invoice" />);
        expect(html).toMatchSnapshot();
        expect(html).toContain('MF-1001');
        expect(html).toContain('৳6,800');
        expect(html).toContain(language === 'bn' ? 'ডেলিভারিতে নিতে হবে' : 'Collect on delivery');
        // The second order was printed before.
        expect(html).toContain(language === 'bn' ? 'আবার প্রিন্ট' : 'Reprint');
    });

    it('renders a packing slip with no prices', () => {
        const slip = {
            ...props('en'),
            orders: [
                { ...order, lines: order.lines.map(line => ({ ...line, unitPrice: null, linePrice: null })) },
            ],
        };
        const html = renderToStaticMarkup(<InvoiceDocuments {...slip} kind="slip" />);
        expect(html).toMatchSnapshot();
        expect(html).toContain('Packing slip');
        expect(html).not.toContain('৳');
    });

    it('renders both languages side by side, with Bangla digits when asked', () => {
        const html = renderToStaticMarkup(
            <InvoiceDocuments
                {...props('both', settings => {
                    settings.banglaDigits = true;
                    settings.invoice.size = 'a5';
                })}
                kind="invoice"
            />,
        );
        expect(html).toMatchSnapshot();
        expect(html).toContain('সর্বমোট / Total');
        expect(html).toContain('৳৬,৮০০');
        // Phone numbers keep Latin digits for couriers.
        expect(html).toContain('01712-345678');
    });

    it('renders an 80 mm receipt', () => {
        const html = renderToStaticMarkup(<ReceiptDocuments {...props('bn')} onHeight={() => undefined} />);
        expect(html).toMatchSnapshot();
        expect(html).toContain('width:80mm');
    });

    it.each(['4x6', '3x4', 'a4-8', 'a4-12'] as const)('renders %s stickers', size => {
        const html = renderToStaticMarkup(
            <StickerDocuments
                {...props('bn', settings => {
                    settings.sticker.size = size;
                })}
            />,
        );
        expect(html).toMatchSnapshot();
        expect(html).toContain('data-sticker-phone');
        expect(html).toContain('01712-345678');
        expect(html).toContain('৳6,800');
    });

    it('adds the courier’s consignment barcode once booked (phase 19)', () => {
        const booked = props('en');
        booked.orders = [{ ...order, courierConsignment: '123456789' }];
        const html = renderToStaticMarkup(<StickerDocuments {...booked} />);
        expect(html).toContain('data-barcode="123456789"');
        expect(html).toContain('Consignment: 123456789');
        expect(renderToStaticMarkup(<StickerDocuments {...props('en')} />)).not.toContain('Consignment');
    });

    it('puts 8 stickers on one A4 sheet and starts a new sheet for the 9th', () => {
        const many = { ...props('en', settings => void (settings.sticker.size = 'a4-8')) };
        many.orders = Array.from({ length: 9 }, (_, index) => ({
            ...order,
            id: String(index),
            orderNumber: String(1001 + index),
        }));
        const html = renderToStaticMarkup(<StickerDocuments {...many} />);
        expect(html.match(/data-print-page/g)).toHaveLength(2);
        expect(html.match(/data-sticker=/g)).toHaveLength(9);
    });
});
