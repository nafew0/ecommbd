import { STICKER_GRID, STICKER_PAGES, type StickerSize } from '@ecommbd/shared/print-settings';
import type { PrintOrder } from '../../lib/print';
import { Barcode } from './barcode';
import { FitText } from './fit-text';
import { Page, ReprintStamp, storeName, type TemplateProps } from './common';

/** Sizes of the text on each sticker size, in points: the base and the address's smallest. */
const STYLE: Record<
    StickerSize,
    { base: number; minAddress: number; barcode: number; module: number; padding: number }
> = {
    '4x6': { base: 12, minAddress: 7, barcode: 13, module: 0.38, padding: 4 },
    '3x4': { base: 9, minAddress: 6, barcode: 10, module: 0.3, padding: 3 },
    'a4-8': { base: 8.5, minAddress: 6, barcode: 9, module: 0.3, padding: 3 },
    'a4-12': { base: 7.5, minAddress: 5.5, barcode: 8, module: 0.27, padding: 2.5 },
};

/**
 * Courier stickers: one per page (4×6 in, 3×4 in) or an A4 sheet of 8 or 12. Name, phone and the
 * COD amount sit at the top and never shrink; the address shrinks to fit, then wraps; the barcode
 * of the order number is at the bottom (the courier's own barcode joins it in phase 19).
 */
export function StickerDocuments(props: TemplateProps) {
    const size = props.settings.sticker.size;
    const paper = STICKER_PAGES[size];
    const grid = STICKER_GRID[size];
    const perPage = grid.columns * grid.rows;
    const pages: PrintOrder[][] = [];
    for (let start = 0; start < props.orders.length; start += perPage) {
        pages.push(props.orders.slice(start, start + perPage));
    }
    return (
        <>
            {pages.map((orders, index) => (
                <Page key={index} widthMm={paper.width} heightMm={paper.height - 0.5} paddingMm={0}>
                    <div
                        className="grid h-full"
                        style={{
                            gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
                            gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
                        }}
                    >
                        {orders.map(order => (
                            <Sticker key={order.id} {...props} order={order} size={size} />
                        ))}
                    </div>
                </Page>
            ))}
        </>
    );
}

function Sticker({
    order,
    store,
    settings,
    labels,
    format,
    place,
    fontsReady,
    size,
}: TemplateProps & { order: PrintOrder; size: StickerSize }) {
    const style = STYLE[size];
    const sheet = size.startsWith('a4');
    const show = settings.sticker;
    const items = order.lines.map(line => `${line.name} × ${format.number(line.quantity)}`).join(', ');
    return (
        <article
            data-sticker={order.orderNumber}
            className={`flex min-h-0 flex-col overflow-hidden leading-tight ${sheet ? 'border border-dashed border-black/40' : ''}`}
            style={{ padding: `${style.padding}mm`, fontSize: `${style.base}pt` }}
        >
            <div className="flex shrink-0 items-baseline justify-between gap-2">
                <span className="font-semibold">#{order.orderNumber}</span>
                {order.printedAt && <ReprintStamp labels={labels} />}
            </div>
            <div className="shrink-0" data-sticker-top>
                <p className="text-[0.85em]">{labels.to}</p>
                <p className="text-[1.15em] font-semibold break-words">{order.customerName}</p>
                <p className="text-[1.35em] font-bold tabular-nums" data-sticker-phone>
                    {format.phone(order.phone)}
                </p>
                {order.alternatePhone && (
                    <p className="tabular-nums">
                        {labels.alternate}: {format.phone(order.alternatePhone)}
                    </p>
                )}
                <p
                    className="my-[0.4em] rounded border-2 border-black px-[0.4em] py-[0.2em] text-[1.4em] font-bold"
                    data-sticker-cod
                >
                    {(order.codDue ?? 0) > 0
                        ? `${labels.codDue}: ${format.money(order.codDue ?? 0)}`
                        : labels.paidInFull}
                </p>
            </div>
            <div className="min-h-0 flex-1">
                <FitText
                    maxPt={style.base}
                    minPt={style.minAddress}
                    fontsReady={fontsReady}
                    className="break-words"
                >
                    <p data-sticker-address>
                        {order.streetLine1}
                        {order.streetLine1 && ', '}
                        {place(order)}
                    </p>
                    {order.landmark && <p>{order.landmark}</p>}
                    {show.showItems && items && <p className="mt-[0.3em] text-[0.85em]">{items}</p>}
                    {show.showNote && order.note && (
                        <p className="mt-[0.3em] text-[0.85em]">
                            {labels.note}: {order.note}
                        </p>
                    )}
                </FitText>
            </div>
            {show.showSender && (
                <p className="shrink-0 truncate text-[0.8em]">
                    {labels.from}: {storeName(store, settings.language)}
                    {store.phones[0] && `, ${format.phone(store.phones[0])}`}
                </p>
            )}
            <div className="mt-[0.3em] flex shrink-0 justify-center">
                <Barcode value={order.orderNumber} heightMm={style.barcode} moduleMm={style.module} />
            </div>
        </article>
    );
}
