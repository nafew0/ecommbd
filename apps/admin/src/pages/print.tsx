import {
    INVOICE_SIZES,
    pageSizeMm,
    PRINT_BATCH_SIZE,
    PRINT_DOCUMENTS,
    type PrintDocument,
    type PrintSettings,
    STICKER_PAGES,
    STICKER_SIZES,
} from '@ecommbd/shared/print-settings';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { InvoiceDocuments } from '../components/print/invoice';
import { RECEIPT_WIDTH_MM, ReceiptDocuments } from '../components/print/receipt';
import { StickerDocuments } from '../components/print/sticker';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import { Alert, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import {
    docLabels,
    PRINT_DATA,
    type PrintData,
    printFormat,
    usePageStyle,
    usePrintPlaces,
} from '../lib/print';
import { useToast } from '../lib/toast';

const MARK_PRINTED = `
    mutation MarkPrinted($ids: [ID!]!, $document: String!) { markBdOrdersPrinted(orderIds: $ids, document: $document) }
`;

/** The admin's font, in both weights and both scripts: printing waits until they are loaded. */
function useFontsReady(enabled: boolean): boolean {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        const fonts = ['400 12px "Hind Siliguri"', '600 12px "Hind Siliguri"'];
        void Promise.all(
            fonts.flatMap(font => [document.fonts.load(font, 'অআ'), document.fonts.load(font, 'Aa1')]),
        )
            .catch(() => undefined)
            .then(() => alive && setReady(true));
        return () => {
            alive = false;
        };
    }, [enabled]);
    return ready;
}

/**
 * The print view (roadmap phase 06): invoices, packing slips, receipts or courier stickers for up
 * to 100 orders at a time, printed by the browser on the paper the settings say. Bigger selections
 * print in batches, which keeps the browser responsive. Opened in its own tab, without the menu.
 */
export function PrintPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const requested = params.get('document') as PrintDocument | null;
    const doc: PrintDocument = requested && PRINT_DOCUMENTS.includes(requested) ? requested : 'invoice';
    const allIds = useMemo(() => (params.get('orders') ?? '').split(',').filter(Boolean), [params]);
    const batches = Math.max(1, Math.ceil(allIds.length / PRINT_BATCH_SIZE));
    const batch = Math.min(Math.max(1, Number(params.get('batch') ?? 1) || 1), batches);
    const ids = allIds.slice((batch - 1) * PRINT_BATCH_SIZE, batch * PRINT_BATCH_SIZE);
    const allowed = can('PrintOrders');

    const query = useQuery({
        queryKey: ['print', doc, ids],
        queryFn: () =>
            adminApi<{ bdPrintData: PrintData }>(PRINT_DATA, { ids, document: doc }).then(
                result => result.bdPrintData,
            ),
        enabled: allowed && ids.length > 0,
        // Personal data: fetched fresh every time, never kept around.
        gcTime: 0,
        staleTime: 0,
    });
    const data = query.data;

    // The paper size can be changed here for one print without touching the settings.
    const settings: PrintSettings | undefined = useMemo(() => {
        if (!data) return undefined;
        const size = params.get('size');
        return {
            ...data.settings,
            invoice: {
                ...data.settings.invoice,
                size: INVOICE_SIZES.includes(size as never) ? (size as never) : data.settings.invoice.size,
            },
            sticker: {
                ...data.settings.sticker,
                size: STICKER_SIZES.includes(size as never) ? (size as never) : data.settings.sticker.size,
            },
        };
    }, [data, params]);

    const fontsReady = useFontsReady(Boolean(data));
    const places = usePrintPlaces(
        (data?.orders ?? []).map(order => order.districtId ?? ''),
        settings?.language ?? 'bn',
    );
    const [receiptMm, setReceiptMm] = useState<number | null>(null);
    const onReceiptHeight = useCallback((mm: number) => setReceiptMm(mm), []);

    const paper = settings
        ? doc === 'receipt'
            ? { width: RECEIPT_WIDTH_MM, height: receiptMm ?? 200 }
            : doc === 'sticker'
              ? STICKER_PAGES[settings.sticker.size]
              : pageSizeMm(doc, { invoice: settings.invoice.size, sticker: settings.sticker.size })
        : { width: 210, height: 297 };
    usePageStyle(
        `@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
         @media print { html, body { background: #fff !important; } }`,
    );

    const ready =
        Boolean(settings) && fontsReady && places.ready && (doc !== 'receipt' || receiptMm !== null);
    const [printing, setPrinting] = useState(false);
    const print = async () => {
        setPrinting(true);
        try {
            await adminApi(MARK_PRINTED, { ids: data!.orders.map(order => order.id), document: doc });
        } catch {
            toast.error(m.errors.generic);
        }
        setPrinting(false);
        window.print();
    };
    const set = (key: string, value: string | null) => {
        const next = new URLSearchParams(params);
        if (value === null) next.delete(key);
        else next.set(key, value);
        setParams(next, { replace: true });
    };

    if (!allowed) {
        return (
            <div className="p-6">
                <Alert tone="warning">{m.print.noPermission}</Alert>
            </div>
        );
    }
    const reprints = data?.orders.filter(order => order.printedAt).length ?? 0;
    const sizes = doc === 'sticker' ? STICKER_SIZES : doc === 'receipt' ? [] : INVOICE_SIZES;
    const currentSize = doc === 'sticker' ? settings?.sticker.size : settings?.invoice.size;
    const template = settings &&
        data && {
            orders: data.orders,
            store: data.store,
            settings,
            labels: docLabels(settings.language),
            format: printFormat(settings.banglaDigits),
            place: places.place,
            fontsReady,
        };

    return (
        <div className="min-h-dvh bg-slate-100 print:min-h-0 print:bg-white">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 print:hidden">
                <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-3">
                    <Link
                        to="/orders"
                        className="inline-flex min-h-11 items-center gap-1 text-sm text-teal-800"
                    >
                        <ArrowLeft className="size-4" aria-hidden />
                        {m.orders.back}
                    </Link>
                    <label className="text-sm">
                        <span className="block text-slate-600">{m.print.choose}</span>
                        <Select
                            value={doc}
                            onChange={event => set('document', event.target.value)}
                            className="w-52"
                        >
                            {PRINT_DOCUMENTS.map(key => (
                                <option key={key} value={key}>
                                    {m.print.documents[key]}
                                </option>
                            ))}
                        </Select>
                    </label>
                    {sizes.length > 0 && (
                        <label className="text-sm">
                            <span className="block text-slate-600">{m.print.paper}</span>
                            <Select
                                value={currentSize ?? ''}
                                onChange={event => set('size', event.target.value)}
                                className="w-48"
                            >
                                {sizes.map(size => (
                                    <option key={size} value={size}>
                                        {m.print.sizes[size]}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    )}
                    {batches > 1 && (
                        <div className="flex items-center gap-2 text-sm">
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={batch <= 1}
                                onClick={() => set('batch', String(batch - 1))}
                            >
                                {m.print.previousBatch}
                            </Button>
                            <span>
                                {m.print.batch(
                                    batch,
                                    batches,
                                    (batch - 1) * PRINT_BATCH_SIZE + 1,
                                    Math.min(batch * PRINT_BATCH_SIZE, allIds.length),
                                )}
                            </span>
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={batch >= batches}
                                onClick={() => set('batch', String(batch + 1))}
                            >
                                {m.print.nextBatch}
                            </Button>
                        </div>
                    )}
                    <Button
                        onClick={() => void print()}
                        disabled={!ready || !data?.orders.length}
                        loading={printing || (!ready && Boolean(data))}
                    >
                        <Printer className="size-4" aria-hidden />
                        {m.print.print}
                    </Button>
                </div>
                <p className="mx-auto mt-2 max-w-5xl text-sm text-slate-600">
                    {m.print.hint}
                    {reprints > 0 && ` ${m.print.reprints(reprints)}`}
                </p>
            </div>
            {query.isPending && ids.length > 0 ? (
                <div className="mx-auto max-w-5xl p-6">
                    <PageSkeleton />
                </div>
            ) : !template || template.orders.length === 0 ? (
                <div className="mx-auto max-w-5xl p-6">
                    <Alert tone="warning">{m.print.nothing}</Alert>
                </div>
            ) : (
                <main
                    data-print-ready={ready ? 'true' : 'false'}
                    data-print-document={doc}
                    className="flex flex-col items-center gap-6 py-6 print:block print:gap-0 print:p-0"
                >
                    {(doc === 'invoice' || doc === 'slip') && (
                        <InvoiceDocuments {...template} kind={doc === 'invoice' ? 'invoice' : 'slip'} />
                    )}
                    {doc === 'receipt' && <ReceiptDocuments {...template} onHeight={onReceiptHeight} />}
                    {doc === 'sticker' && <StickerDocuments {...template} />}
                </main>
            )}
        </div>
    );
}
