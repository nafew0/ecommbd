import { expect, type Page, test } from '@playwright/test';
import {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    HybridBinarizer,
    MultiFormatReader,
    RGBLuminanceSource,
} from '@zxing/library';
import { PNG } from 'pngjs';
import { signIn } from './support/admin-ui';
import {
    adminSession,
    type ApiSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from './support/store-api';

/**
 * Printing (roadmap phase 06): every template prints to a PDF of the right paper size, barcodes
 * scan, the phone and COD amount are never cut off on any sticker, and 100 selected orders print
 * in one go. Desktop only: the packing desk prints from a PC.
 */

const LONG_ADDRESS =
    'বাসা ১২৩/এ, রোড ১৪, ব্লক সি, সেকশন ১২, মিরপুর পল্লবী, মসজিদের গলির শেষ মাথায় সবুজ গেটের তিনতলা বাড়ি, দ্বিতীয় তলা, ফ্ল্যাট ২বি, পাশে স্কুল';

let admin: ApiSession;
const orders: Array<{ id: string; number: string }> = [];

/** Points per millimetre in a PDF. */
const PT_PER_MM = 72 / 25.4;

async function orderOf(code: string) {
    const { orders: found } = await admin.query(
        'query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items { id customFields { orderNumber } } } }',
        { code },
    );
    return { id: found.items[0].id as string, number: found.items[0].customFields.orderNumber as string };
}

async function openPrintView(page: Page, document: string, ids: string[], size?: string) {
    const params = new URLSearchParams({ document, orders: ids.join(',') });
    if (size) params.set('size', size);
    await page.goto(`/admin/print?${params}`);
    await expect(page.locator('[data-print-ready="true"]')).toBeVisible({ timeout: 15_000 });
}

/** The page sizes (in mm) of every page of a PDF made by Chrome. */
function pdfPages(pdf: Buffer): Array<{ width: number; height: number }> {
    return [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map(
        match => ({
            width: Number(match[1]) / PT_PER_MM,
            height: Number(match[2]) / PT_PER_MM,
        }),
    );
}

/** Reads the barcode in a screenshot with ZXing, as a scanner would. */
function scan(png: Buffer): string {
    const image = PNG.sync.read(png);
    const luminance = new Uint8ClampedArray(image.width * image.height);
    for (let i = 0; i < luminance.length; i++) {
        const [r, g, b] = [image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!];
        luminance[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    const reader = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
        [DecodeHintType.TRY_HARDER, true],
    ]);
    const bitmap = new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(luminance, image.width, image.height)),
    );
    return reader.decode(bitmap, hints).getText();
}

test.describe('printing', () => {
    test.skip(({ isMobile }) => isMobile, 'The packing desk prints from a PC');

    test.beforeAll(async () => {
        admin = await adminSession();
        const variantId = await ensureCheckoutFixtures(admin);
        orders.length = 0;
        for (const [name, streetLine1] of [
            ['PW Print one', undefined],
            ['PW Print two', undefined],
            ['PW Print with a very long name that keeps going on', LONG_ADDRESS],
        ] as const) {
            orders.push(
                await orderOf(await placePhoneOrder({ variantId, name, phone: randomPhone(), streetLine1 })),
            );
        }
    });

    const ids = () => orders.map(order => order.id);

    test('prints A4 and A5 invoices, one page per order, in Bangla', async ({ page }) => {
        await signIn(page, 'bn');
        await openPrintView(page, 'invoice', ids(), 'a4');
        await expect(page.locator('main')).toContainText('ডেলিভারিতে নিতে হবে');
        const a4 = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
        expect(a4).toHaveLength(3);
        for (const sheet of a4) {
            expect(sheet.width).toBeCloseTo(210, 0);
            expect(sheet.height).toBeCloseTo(297, 0);
        }
        await openPrintView(page, 'invoice', ids(), 'a5');
        const a5 = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
        expect(a5).toHaveLength(3);
        expect(a5[0]!.width).toBeCloseTo(148, 0);
    });

    test('prints packing slips without prices, and 80 mm receipts', async ({ page }) => {
        await signIn(page, 'en');
        await openPrintView(page, 'slip', ids());
        await expect(page.locator('main')).not.toContainText('৳');
        expect(pdfPages(await page.pdf({ preferCSSPageSize: true }))).toHaveLength(3);
        await openPrintView(page, 'receipt', ids());
        const receipts = pdfPages(await page.pdf({ preferCSSPageSize: true }));
        expect(receipts).toHaveLength(3);
        expect(receipts[0]!.width).toBeCloseTo(80, 0);
        expect(receipts[0]!.height).toBeGreaterThan(60);
    });

    for (const [size, perPage, width] of [
        ['4x6', 1, 101.6],
        ['3x4', 1, 76.2],
        ['a4-8', 8, 210],
        ['a4-12', 12, 210],
    ] as const) {
        test(`prints ${size} stickers: phone and COD never cut off, even with a long address`, async ({
            page,
        }) => {
            await signIn(page, 'bn');
            await openPrintView(page, 'sticker', ids(), size);
            const sheets = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
            expect(sheets).toHaveLength(Math.ceil(3 / perPage));
            expect(sheets[0]!.width).toBeCloseTo(width, 0);
            const long = page.locator(`[data-sticker="${orders[2]!.number}"]`);
            const box = (await long.boundingBox())!;
            for (const part of ['[data-sticker-phone]', '[data-sticker-cod]', '[data-barcode]']) {
                const inner = (await long.locator(part).boundingBox())!;
                expect(inner.y, part).toBeGreaterThanOrEqual(box.y - 0.5);
                expect(inner.y + inner.height, part).toBeLessThanOrEqual(box.y + box.height + 0.5);
                expect(inner.x + inner.width, part).toBeLessThanOrEqual(box.x + box.width + 0.5);
            }
            // The address shrank to fit.
            const fitted = await long.locator('[data-fit-pt]').getAttribute('data-fit-pt');
            const normal = await page
                .locator(`[data-sticker="${orders[0]!.number}"] [data-fit-pt]`)
                .getAttribute('data-fit-pt');
            expect(Number(fitted)).toBeLessThanOrEqual(Number(normal));
        });
    }

    test('splits a 55-line invoice over pages with repeated headers and "page 2 of 3"', async ({ page }) => {
        // Layout only: the API's answer is replaced with one big order (the test store has one product).
        await page.route('**/admin-api**', async route => {
            const body = route.request().postData() ?? '';
            if (!body.includes('PrintData')) return route.fallback();
            const response = await route.fetch();
            const json = await response.json();
            const order = json.data.bdPrintData.orders[0];
            order.lines = Array.from({ length: 55 }, (_, index) => ({
                name: `পণ্য ${index + 1}: a product with a long name that wraps onto a second line on A4 paper`,
                sku: `SKU-${index + 1}`,
                quantity: 1,
                unitPrice: 100000,
                linePrice: 100000,
            }));
            json.data.bdPrintData.orders = [order];
            await route.fulfill({ response, json });
        });
        await signIn(page, 'en');
        await openPrintView(page, 'invoice', [orders[0]!.id], 'a4');
        const sheets = page.locator('main [data-print-page]');
        const count = await sheets.count();
        expect(count).toBeGreaterThanOrEqual(2);
        // Every line exactly once, the header repeated on each page, the totals on the last.
        await expect(page.locator('main [data-print-page] tbody tr')).toHaveCount(55);
        await expect(page.locator('main [data-print-page] thead')).toHaveCount(count);
        await expect(sheets.nth(1)).toContainText(`পেজ ${'২'} / `);
        await expect(sheets.last()).toContainText('ডেলিভারিতে নিতে হবে');
        await expect(sheets.first()).not.toContainText('ডেলিভারিতে নিতে হবে');
        // Nothing spills over: one sheet per page box.
        expect(pdfPages(await page.pdf({ preferCSSPageSize: true }))).toHaveLength(count);
        for (let index = 0; index < count; index++) {
            const box = (await sheets.nth(index).boundingBox())!;
            const rows = sheets.nth(index).locator('tbody tr');
            const last = (await rows.last().boundingBox())!;
            expect(last.y + last.height).toBeLessThanOrEqual(box.y + box.height);
        }
    });

    test.describe('barcodes', () => {
        test.use({ deviceScaleFactor: 3 });

        test('scan back to the order number on invoices and stickers', async ({ page }) => {
            await signIn(page, 'en');
            for (const document of ['invoice', 'sticker'] as const) {
                await openPrintView(page, document, [orders[0]!.id]);
                const barcode = page.locator('[data-print-page] [data-barcode]').first();
                expect(await barcode.getAttribute('data-barcode')).toBe(orders[0]!.number);
                expect(scan(await barcode.screenshot())).toBe(orders[0]!.number);
            }
        });
    });

    test('marks orders printed, and a second print says "Reprint"', async ({ page }) => {
        const [first] = orders;
        await page.addInitScript(() => {
            window.print = () => undefined;
        });
        await signIn(page, 'en');
        await openPrintView(page, 'sticker', [first!.id], '4x6');
        // The stamp is in the print language (Bangla by default); the toolbar in the admin's.
        await expect(page.locator('main')).not.toContainText('আবার প্রিন্ট');
        await page.getByRole('button', { name: 'Print' }).click();
        await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled();
        await openPrintView(page, 'sticker', [first!.id], '4x6');
        await expect(page.locator('main')).toContainText('আবার প্রিন্ট');
        await expect(page.getByText(/printed before/)).toBeVisible();
    });

    test('selects 100 orders in the list and prints their A4 invoices and 4×6 stickers', async ({
        page,
        context,
    }) => {
        test.setTimeout(180_000);
        // At least 100 orders in the store.
        const { bdOrders } = await admin.query('{ bdOrders(take: 1) { totalItems } }');
        const variantId = await ensureCheckoutFixtures(admin);
        const missing = Math.max(0, 100 - bdOrders.totalItems);
        for (let start = 0; start < missing; start += 10) {
            await Promise.all(
                Array.from({ length: Math.min(10, missing - start) }, (_, index) =>
                    placePhoneOrder({ variantId, name: `PW Bulk ${start + index}`, phone: randomPhone() }),
                ),
            );
        }
        await page.addInitScript(() => {
            window.print = () => undefined;
        });
        await signIn(page, 'en');
        await page.goto('/admin/orders');
        await page.getByLabel('Per page').selectOption('100');
        await expect(page.getByRole('row')).toHaveCount(101, { timeout: 15_000 });
        await page.getByLabel('Select all on this page').check();
        await expect(page.getByText('100 selected')).toBeVisible();

        for (const [document, perOrder] of [
            ['invoice', '[data-order]'],
            ['sticker', '[data-sticker]'],
        ] as const) {
            await page.getByLabel('What to print').selectOption(document);
            const popup = context.waitForEvent('page');
            await page.getByRole('button', { name: 'Print', exact: true }).click();
            const view = await popup;
            await expect(view.locator('[data-print-ready="true"]')).toBeVisible({ timeout: 30_000 });
            await expect(view.getByLabel('What to print')).toHaveValue(document);
            const distinct = await view
                .locator(`main ${perOrder}`)
                .evaluateAll(
                    nodes =>
                        new Set(
                            nodes.map(
                                node =>
                                    (node as HTMLElement).dataset.order ??
                                    (node as HTMLElement).dataset.sticker,
                            ),
                        ).size,
                );
            expect(distinct).toBe(100);
            if (document === 'sticker') {
                const sheets = pdfPages(await view.pdf({ preferCSSPageSize: true }));
                expect(sheets).toHaveLength(100);
                expect(sheets[0]!.height).toBeCloseTo(152, 0);
            }
            await view.close();
        }
    });
});
