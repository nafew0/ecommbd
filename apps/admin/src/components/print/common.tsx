import type { PrintLanguage, PrintSettings } from '@ecommbd/shared/print-settings';
import type { ReactNode } from 'react';
import type { DocLabels, PrintFormat, PrintOrder, PrintStore } from '../../lib/print';
import { bilingual } from '../../lib/print';

/** Everything a template needs, passed in, so templates render the same in tests and in the browser. */
export interface TemplateProps {
    orders: PrintOrder[];
    store: PrintStore;
    settings: PrintSettings;
    labels: DocLabels;
    format: PrintFormat;
    /** "Mirpur 10, মিরপুর, ঢাকা" in the print language. */
    place(order: PrintOrder): string;
    /** The web font has loaded: measure again. */
    fontsReady: boolean;
}

/** One printed page: exactly the paper's size, so each box is one sheet. */
export function Page({
    widthMm,
    heightMm,
    paddingMm,
    children,
    className = '',
}: {
    widthMm: number;
    heightMm: number;
    paddingMm: number;
    children: ReactNode;
    className?: string;
}) {
    // A page break after every page but the last: a break after the last adds a blank sheet.
    return (
        <section
            data-print-page=""
            className={`overflow-hidden bg-white text-black shadow-md print:shadow-none [&:not(:last-child)]:break-after-page ${className}`}
            style={{
                width: `${widthMm}mm`,
                height: `${heightMm}mm`,
                padding: `${paddingMm}mm`,
                boxSizing: 'border-box',
                printColorAdjust: 'exact',
            }}
        >
            {children}
        </section>
    );
}

/** A "Reprint" stamp for documents printed before. */
export function ReprintStamp({ labels }: { labels: DocLabels }) {
    return (
        <span className="rounded border-2 border-black px-1.5 text-[0.8em] font-semibold tracking-wide uppercase">
            {labels.reprint}
        </span>
    );
}

export function storeName(store: PrintStore, language: PrintLanguage): string {
    return bilingual(store.name, language);
}

/** The footer line: the merchant's own text, or the start of the return policy. */
export function footerLine(store: PrintStore, settings: PrintSettings): string {
    const own = bilingual(settings.footerText, settings.language);
    if (own) return own;
    return settings.invoice.showReturnPolicy ? bilingual(store.returnPolicy, settings.language) : '';
}
