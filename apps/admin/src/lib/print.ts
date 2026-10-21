import { formatTaka } from '@ecommbd/shared/money';
import { formatBdPhone } from '@ecommbd/shared/phone';
import type { PrintDocument, PrintLanguage, PrintSettings } from '@ecommbd/shared/print-settings';
import { asciiToBanglaDigits } from '@ecommbd/shared/text';
import { formatDhaka } from '@ecommbd/shared/time';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { bn } from '../messages/bn';
import { en } from '../messages/en';
import { adminApi } from './api';

/** What `bdPrintData` returns (roadmap phase 06). Money is null on packing slips. */
export interface PrintLine {
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number | null;
    linePrice: number | null;
}

export interface PrintOrder {
    id: string;
    orderNumber: string;
    placedAt: string | null;
    customerName: string;
    phone: string | null;
    alternatePhone: string | null;
    streetLine1: string;
    area: string | null;
    districtId: string | null;
    thanaId: string | null;
    landmark: string | null;
    note: string | null;
    lines: PrintLine[];
    subtotal: number | null;
    discount: number | null;
    delivery: number | null;
    total: number | null;
    paid: number | null;
    codDue: number | null;
    paymentType: 'cod' | 'advance' | 'prepaid';
    paymentMethods: string[];
    printedAt: string | null;
    courierConsignment: string | null;
}

export interface PrintStore {
    name: { bn: string; en: string };
    phones: string[];
    addressLine: string;
    area: string;
    districtId: string;
    thanaId: string;
    logo: { preview: string } | null;
    returnPolicy: { bn: string; en: string };
}

export interface PrintData {
    document: PrintDocument;
    orders: PrintOrder[];
    store: PrintStore;
    settings: PrintSettings;
}

export const PRINT_DATA = `
    query PrintData($ids: [ID!]!, $document: String!) {
        bdPrintData(orderIds: $ids, document: $document) {
            document
            orders {
                id orderNumber placedAt customerName phone alternatePhone streetLine1 area districtId thanaId
                landmark note
                lines { name sku quantity unitPrice linePrice }
                subtotal discount delivery total paid codDue paymentType paymentMethods printedAt courierConsignment
            }
            store {
                name { bn en } phones addressLine area districtId thanaId
                logo { preview }
                returnPolicy { bn en }
            }
            settings
        }
    }
`;

export type DocLabels = Omit<typeof en.print.doc, 'page' | 'paymentTypes'> & {
    page(page: number, pages: number): string;
    paymentTypes: typeof en.print.doc.paymentTypes;
};

/** The labels printed on documents, in Bangla, English, or both ("মোট / Total"). */
export function docLabels(language: PrintLanguage): DocLabels {
    if (language !== 'both') {
        return (language === 'bn' ? bn : en).print.doc;
    }
    const a = bn.print.doc;
    const b = en.print.doc;
    const both = (x: string, y: string) => (x === y ? x : `${x} / ${y}`);
    const labels = Object.fromEntries(
        Object.entries(a)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, both(value as string, b[key as keyof typeof b] as string)]),
    ) as Omit<DocLabels, 'page' | 'paymentTypes'>;
    return {
        ...labels,
        page: (page, pages) => `${a.page(page, pages)} / ${b.page(page, pages)}`,
        paymentTypes: {
            cod: both(a.paymentTypes.cod, b.paymentTypes.cod),
            advance: both(a.paymentTypes.advance, b.paymentTypes.advance),
            prepaid: both(a.paymentTypes.prepaid, b.paymentTypes.prepaid),
        },
    };
}

/** Text that comes in both languages (store name, policy), as the print language asks. */
export function bilingual(text: { bn: string; en: string }, language: PrintLanguage): string {
    if (language === 'both') {
        return [text.bn, text.en]
            .filter(Boolean)
            .filter((value, index, all) => all.indexOf(value) === index)
            .join(' / ');
    }
    return text[language] || text[language === 'bn' ? 'en' : 'bn'];
}

export interface PrintFormat {
    money(minor: number): string;
    date(iso: string | null): string;
    number(value: number): string;
    /** Phones keep Latin digits: couriers dial them. */
    phone(e164: string | null): string;
}

/** Amounts, dates and counts with Bangla digits when the print settings say so; dates in Dhaka time. */
export function printFormat(banglaDigits: boolean): PrintFormat {
    return {
        money: minor => formatTaka(minor, { banglaDigits }),
        date: iso => (iso ? formatDhaka(new Date(iso), { banglaDigits, withTime: true }) : ''),
        number: value => (banglaDigits ? asciiToBanglaDigits(String(value)) : String(value)),
        phone: e164 => (e164 ? formatBdPhone(e164) : ''),
    };
}

/** District and thana names in the print language, for the districts these orders go to. */
export function usePrintPlaces(districtIds: string[], language: PrintLanguage) {
    const ids = [...new Set(districtIds.filter(Boolean))].sort();
    const languages = language === 'both' ? (['bn', 'en'] as const) : [language];
    const query = useQuery({
        queryKey: ['printPlaces', ids, language],
        enabled: ids.length > 0,
        staleTime: Infinity,
        queryFn: async () => {
            const parts = languages.flatMap(lang => [
                `d_${lang}: bdDistricts(lang: ${lang}) { id name }`,
                ...ids.map(
                    (id, index) =>
                        `t${index}_${lang}: bdThanas(districtId: ${JSON.stringify(id)}, lang: ${lang}) { id name }`,
                ),
            ]);
            return adminApi<Record<string, Array<{ id: string; name: string }>>>(
                `query { ${parts.join('\n')} }`,
            );
        },
    });
    const names = (lang: 'bn' | 'en') => {
        const data = query.data ?? {};
        const map = new Map<string, string>();
        for (const [key, list] of Object.entries(data)) {
            if (key.endsWith(`_${lang}`)) list.forEach(place => map.set(place.id, place.name));
        }
        return map;
    };
    const maps = Object.fromEntries(languages.map(lang => [lang, names(lang)]));
    return {
        ready: ids.length === 0 || query.isSuccess,
        /** "Mirpur 10, মিরপুর, ঢাকা": the area as typed, then the thana and district in the print language. */
        place(order: { area: string | null; thanaId: string | null; districtId: string | null }): string {
            const named = languages.map(lang =>
                [maps[lang]!.get(order.thanaId ?? ''), maps[lang]!.get(order.districtId ?? '')]
                    .filter(Boolean)
                    .join(', '),
            );
            return [order.area, ...named.filter((value, index, all) => value && all.indexOf(value) === index)]
                .filter(Boolean)
                .join(', ');
        },
    };
}

/**
 * The printed page size, as a stylesheet built in script: the admin's Content Security Policy
 * blocks inline `<style>` but allows constructed stylesheets.
 */
export function usePageStyle(css: string) {
    useEffect(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        return () => {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(existing => existing !== sheet);
        };
    }, [css]);
}

/** Opens the print view for these orders in a new tab, so the list stays where it was. */
export function openPrint(document: PrintDocument, orderIds: string[]) {
    const params = new URLSearchParams({ document, orders: orderIds.join(',') });
    window.open(`/admin/print?${params}`, '_blank', 'noopener');
}
