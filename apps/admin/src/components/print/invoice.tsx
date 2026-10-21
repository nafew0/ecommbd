import { pageSizeMm } from '@ecommbd/shared/print-settings';
import { useLayoutEffect, useRef, useState } from 'react';
import type { PrintOrder } from '../../lib/print';
import { paginateRows, PX_PER_MM } from '../../lib/paginate';
import { Barcode } from './barcode';
import { footerLine, Page, ReprintStamp, storeName, type TemplateProps } from './common';

type Kind = 'invoice' | 'slip';

/** A4 or A5 invoices, or packing slips (items and quantities, no prices), one or more pages each. */
export function InvoiceDocuments(props: TemplateProps & { kind: Kind }) {
    return (
        <>
            {props.orders.map(order => (
                <InvoicePages key={order.id} {...props} order={order} />
            ))}
        </>
    );
}

const MARGIN_MM = { a4: 10, a5: 7 };
/** Keeps rounding from pushing a page onto a second sheet. */
const SAFETY_MM = 1;

function InvoicePages(props: TemplateProps & { kind: Kind; order: PrintOrder }) {
    const { order, settings, fontsReady } = props;
    const size = settings.invoice.size;
    const paper = pageSizeMm('invoice', { invoice: size, sticker: '4x6' });
    const margin = MARGIN_MM[size];
    const heightMm = paper.height - SAFETY_MM;
    const [pages, setPages] = useState<number[][]>(() => [order.lines.map((_, index) => index)]);
    const measure = useRef<HTMLDivElement>(null);

    // Lay everything out once, invisibly, at the page's width; measure; then split into pages.
    useLayoutEffect(() => {
        const root = measure.current;
        if (!root) return;
        const height = (selector: string) =>
            root.querySelector(selector)?.getBoundingClientRect().height ?? 0;
        const inner = (heightMm - 2 * margin) * PX_PER_MM;
        const table = height('[data-measure="thead"]');
        const footer = height('[data-measure="footer"]');
        const rows = [...root.querySelectorAll('[data-measure="row"]')].map(
            row => row.getBoundingClientRect().height,
        );
        setPages(
            paginateRows(rows, {
                first: inner - height('[data-measure="header"]') - table - footer,
                next: inner - height('[data-measure="short-header"]') - table - footer,
                totals: height('[data-measure="totals"]'),
            }),
        );
    }, [order, size, fontsReady, heightMm, margin]);

    const width = `${paper.width - 2 * margin}mm`;
    return (
        <>
            <div
                ref={measure}
                aria-hidden
                className="invisible absolute -left-[9999px] print:hidden"
                style={{ width }}
            >
                <div data-measure="header">
                    <FullHeader {...props} />
                </div>
                <div data-measure="short-header">
                    <ShortHeader {...props} page={1} pages={2} />
                </div>
                <table className="w-full border-collapse text-[10pt]">
                    <thead data-measure="thead">
                        <LineHeader {...props} />
                    </thead>
                    <tbody>
                        {order.lines.map((line, index) => (
                            <LineRow key={index} {...props} index={index} data-measure="row" />
                        ))}
                    </tbody>
                </table>
                <div data-measure="totals">
                    <Totals {...props} />
                </div>
                {/* The last page's footer: the tallest, with the footer line. */}
                <div data-measure="footer">
                    <PageFooter {...props} page={2} pages={2} />
                </div>
            </div>
            {pages.map((lines, pageIndex) => (
                <Page key={pageIndex} widthMm={paper.width} heightMm={heightMm} paddingMm={margin}>
                    <div className="flex h-full flex-col" data-order={order.orderNumber}>
                        {pageIndex === 0 ? (
                            <FullHeader {...props} />
                        ) : (
                            <ShortHeader {...props} page={pageIndex + 1} pages={pages.length} />
                        )}
                        <table className="w-full border-collapse text-[10pt]">
                            <thead>
                                <LineHeader {...props} />
                            </thead>
                            <tbody>
                                {lines.map(index => (
                                    <LineRow key={index} {...props} index={index} />
                                ))}
                            </tbody>
                        </table>
                        {pageIndex === pages.length - 1 && <Totals {...props} />}
                        <div className="mt-auto">
                            <PageFooter {...props} page={pageIndex + 1} pages={pages.length} />
                        </div>
                    </div>
                </Page>
            ))}
        </>
    );
}

type PartProps = TemplateProps & { kind: Kind; order: PrintOrder };

function FullHeader({ order, store, settings, labels, format, place, kind }: PartProps) {
    const show = settings.invoice;
    return (
        <header className="mb-4 text-[10pt]">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-0.5">
                    {show.showLogo && store.logo && (
                        <img
                            src={store.logo.preview}
                            alt=""
                            className="mb-1 max-h-[16mm] max-w-[50mm] object-contain"
                        />
                    )}
                    <p className="text-[13pt] font-semibold break-words">
                        {storeName(store, settings.language)}
                    </p>
                    {store.phones.length > 0 && <p>{store.phones.map(format.phone).join(', ')}</p>}
                    {show.showStoreAddress && store.addressLine && (
                        <p className="break-words">{store.addressLine}</p>
                    )}
                </div>
                <div className="shrink-0 space-y-1 text-right">
                    <p className="text-[16pt] font-semibold">
                        {kind === 'invoice' ? labels.invoice : labels.packingSlip}
                    </p>
                    {order.printedAt && <ReprintStamp labels={labels} />}
                    <p>
                        {labels.order} <span className="text-[13pt] font-semibold">#{order.orderNumber}</span>
                    </p>
                    <div className="flex justify-end">
                        <Barcode value={order.orderNumber} heightMm={10} />
                    </div>
                    <p>
                        {labels.date}: {format.date(order.placedAt)}
                    </p>
                </div>
            </div>
            <div className="mt-3 rounded border border-black/40 p-2">
                <p className="text-[9pt] uppercase">{labels.billTo}</p>
                <p className="text-[12pt] font-semibold break-words">{order.customerName}</p>
                <p>
                    {labels.phone}: <span className="font-semibold">{format.phone(order.phone)}</span>
                    {order.alternatePhone && (
                        <>
                            {' · '}
                            {labels.alternate}: {format.phone(order.alternatePhone)}
                        </>
                    )}
                </p>
                <p className="break-words">{[order.streetLine1, place(order)].filter(Boolean).join(', ')}</p>
                {order.landmark && <p className="break-words">{order.landmark}</p>}
            </div>
        </header>
    );
}

function ShortHeader({ order, labels, page, pages, kind }: PartProps & { page: number; pages: number }) {
    return (
        <header className="mb-3 flex justify-between border-b border-black/40 pb-1 text-[10pt]">
            <span className="font-semibold">
                {kind === 'invoice' ? labels.invoice : labels.packingSlip} · #{order.orderNumber} ·{' '}
                {order.customerName}
            </span>
            <span>{labels.page(page, pages)}</span>
        </header>
    );
}

function LineHeader({ labels, kind }: PartProps) {
    const cell = 'border-b-2 border-black px-1 py-1 text-left font-semibold';
    return (
        <tr>
            <th className={`${cell} w-[8mm]`}>#</th>
            <th className={cell}>{labels.item}</th>
            <th className={`${cell} w-[16mm] text-right`}>{labels.quantity}</th>
            {kind === 'invoice' ? (
                <>
                    <th className={`${cell} w-[24mm] text-right`}>{labels.unitPrice}</th>
                    <th className={`${cell} w-[26mm] text-right`}>{labels.amount}</th>
                </>
            ) : (
                <th className={`${cell} w-[16mm] text-center`}>{labels.packed}</th>
            )}
        </tr>
    );
}

function LineRow({
    order,
    format,
    kind,
    index,
    ...rest
}: PartProps & { index: number; 'data-measure'?: string }) {
    const line = order.lines[index]!;
    const cell = 'border-b border-black/20 px-1 py-1 align-top';
    return (
        <tr data-measure={rest['data-measure']}>
            <td className={cell}>{format.number(index + 1)}</td>
            <td className={`${cell} break-words`}>
                {line.name}
                {line.sku && <span className="block text-[8pt] text-black/60">{line.sku}</span>}
            </td>
            <td className={`${cell} text-right`}>{format.number(line.quantity)}</td>
            {kind === 'invoice' ? (
                <>
                    <td className={`${cell} text-right whitespace-nowrap`}>
                        {format.money(line.unitPrice ?? 0)}
                    </td>
                    <td className={`${cell} text-right whitespace-nowrap`}>
                        {format.money(line.linePrice ?? 0)}
                    </td>
                </>
            ) : (
                <td className={`${cell} text-center`}>☐</td>
            )}
        </tr>
    );
}

function Totals({ order, settings, labels, format, kind }: PartProps) {
    const row = 'flex justify-between gap-4';
    return (
        <div className="mt-3 space-y-2 text-[10pt]">
            {kind === 'invoice' && (
                <div className="ml-auto w-[80mm] space-y-0.5">
                    <p className={row}>
                        <span>{labels.subtotal}</span>
                        <span>{format.money(order.subtotal ?? 0)}</span>
                    </p>
                    {(order.discount ?? 0) > 0 && (
                        <p className={row}>
                            <span>{labels.discount}</span>
                            <span>−{format.money(order.discount ?? 0)}</span>
                        </p>
                    )}
                    <p className={row}>
                        <span>{labels.delivery}</span>
                        <span>{format.money(order.delivery ?? 0)}</span>
                    </p>
                    <p className={`${row} border-t border-black pt-0.5 font-semibold`}>
                        <span>{labels.total}</span>
                        <span>{format.money(order.total ?? 0)}</span>
                    </p>
                    {(order.paid ?? 0) > 0 && (
                        <p className={row}>
                            <span>{labels.paid}</span>
                            <span>{format.money(order.paid ?? 0)}</span>
                        </p>
                    )}
                    <div className="mt-1 rounded border-2 border-black px-2 py-1">
                        {(order.codDue ?? 0) > 0 ? (
                            <p className={`${row} items-baseline`}>
                                <span className="font-semibold">{labels.codDue}</span>
                                <span className="text-[18pt] font-bold" data-cod>
                                    {format.money(order.codDue ?? 0)}
                                </span>
                            </p>
                        ) : (
                            <p className="font-semibold">{labels.paidInFull}</p>
                        )}
                    </div>
                    <p className="text-[9pt]">
                        {labels.payment}: {labels.paymentTypes[order.paymentType]}
                        {order.paymentMethods.length > 0 && ` (${order.paymentMethods.join(', ')})`}
                    </p>
                </div>
            )}
            {settings.invoice.showNote && order.note && (
                <p className="rounded border border-black/40 p-2 break-words whitespace-pre-line">
                    <span className="font-semibold">{labels.note}: </span>
                    {order.note}
                </p>
            )}
        </div>
    );
}

function PageFooter({
    order,
    store,
    settings,
    labels,
    page,
    pages,
    kind,
}: PartProps & { page: number; pages: number }) {
    const line = kind === 'invoice' ? footerLine(store, settings) : '';
    return (
        <footer className="mt-3 border-t border-black/30 pt-1 text-[8pt]">
            {page === pages && line && <p className="break-words">{line}</p>}
            <p className="flex justify-between">
                <span>{kind === 'invoice' && page === pages ? labels.thanks : `#${order.orderNumber}`}</span>
                {pages > 1 && <span>{labels.page(page, pages)}</span>}
            </p>
        </footer>
    );
}
