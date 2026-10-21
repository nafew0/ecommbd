import { useLayoutEffect, useRef } from 'react';
import { PX_PER_MM } from '../../lib/paginate';
import { Barcode } from './barcode';
import { footerLine, ReprintStamp, storeName, type TemplateProps } from './common';

export const RECEIPT_WIDTH_MM = 80;

/**
 * 80 mm thermal receipts, one per page. The roll has no fixed length, so the page is as long as the
 * longest receipt in this batch (`onHeight`, in mm).
 */
export function ReceiptDocuments(props: TemplateProps & { onHeight(mm: number): void }) {
    const { orders, store, settings, labels, format, place, fontsReady, onHeight } = props;
    const root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const receipts = [...(root.current?.querySelectorAll('[data-receipt]') ?? [])];
        const tallest = Math.max(0, ...receipts.map(receipt => receipt.getBoundingClientRect().height));
        onHeight(Math.ceil(tallest / PX_PER_MM) + 4);
    }, [orders, fontsReady, onHeight]);
    const row = 'flex justify-between gap-2';
    return (
        <div ref={root} className="flex flex-col gap-4 print:gap-0">
            {orders.map(order => (
                <section
                    key={order.id}
                    data-receipt=""
                    data-print-page=""
                    className="bg-white px-[4mm] py-[3mm] text-[9pt] leading-snug text-black shadow-md print:shadow-none [&:not(:last-child)]:break-after-page"
                    style={{ width: `${RECEIPT_WIDTH_MM}mm`, boxSizing: 'border-box' }}
                >
                    <p className="text-center text-[11pt] font-semibold">
                        {storeName(store, settings.language)}
                    </p>
                    {store.phones.length > 0 && (
                        <p className="text-center">{store.phones.map(format.phone).join(', ')}</p>
                    )}
                    <hr className="my-1 border-dashed border-black" />
                    <p className={row}>
                        <span>
                            {labels.receipt} #{order.orderNumber}
                        </span>
                        {order.printedAt && <ReprintStamp labels={labels} />}
                    </p>
                    <p>{format.date(order.placedAt)}</p>
                    <p className="font-semibold break-words">{order.customerName}</p>
                    <p>{format.phone(order.phone)}</p>
                    <p className="break-words">
                        {[order.streetLine1, place(order)].filter(Boolean).join(', ')}
                    </p>
                    <hr className="my-1 border-dashed border-black" />
                    {order.lines.map((line, index) => (
                        <div key={index} className="mb-0.5">
                            <p className="break-words">{line.name}</p>
                            <p className={row}>
                                <span>
                                    {format.number(line.quantity)} × {format.money(line.unitPrice ?? 0)}
                                </span>
                                <span>{format.money(line.linePrice ?? 0)}</span>
                            </p>
                        </div>
                    ))}
                    <hr className="my-1 border-dashed border-black" />
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
                    <p className={`${row} font-semibold`}>
                        <span>{labels.total}</span>
                        <span>{format.money(order.total ?? 0)}</span>
                    </p>
                    {(order.paid ?? 0) > 0 && (
                        <p className={row}>
                            <span>{labels.paid}</span>
                            <span>{format.money(order.paid ?? 0)}</span>
                        </p>
                    )}
                    <p className={`${row} mt-1 border-y-2 border-black py-1 text-[12pt] font-bold`}>
                        <span>{labels.codDue}</span>
                        <span data-cod>{format.money(order.codDue ?? 0)}</span>
                    </p>
                    {settings.invoice.showNote && order.note && (
                        <p className="mt-1 break-words">
                            {labels.note}: {order.note}
                        </p>
                    )}
                    <div className="mt-2 flex justify-center">
                        <Barcode value={order.orderNumber} heightMm={9} moduleMm={0.3} />
                    </div>
                    <p className="mt-1 text-center">{footerLine(store, settings) || labels.thanks}</p>
                </section>
            ))}
        </div>
    );
}
