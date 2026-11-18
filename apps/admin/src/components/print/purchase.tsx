import type { ReactNode } from 'react';
import { Page } from './common';

export interface PurchasePrintLine {
    name: string;
    sku: string;
    quantity: number;
    unitCost: number;
}

export interface PurchasePrintData {
    document: 'order' | 'receipt';
    number: string;
    purchasedOn: string;
    supplier: { name: string; phone: string | null; address: string };
    storeName: { bn: string; en: string };
    lines: PurchasePrintLine[];
    delivery: number;
    other: number;
    discount: number;
    paid: number;
    total: number;
    owed: number;
    note: string;
    receiveNote: string;
}

export interface PurchasePrintLabels {
    title: string;
    supplier: string;
    product: string;
    quantity: string;
    cost: string;
    line: string;
    delivery: string;
    other: string;
    discount: string;
    paid: string;
    total: string;
    owed: string;
    note: string;
    money(minor: number): string;
    digits(value: string | number): string;
}

/** A purchase order or a goods-received note, on the same paper box as the other prints. */
export function PurchaseDocument({
    data,
    labels,
    language,
}: {
    data: PurchasePrintData;
    labels: PurchasePrintLabels;
    language: 'bn' | 'en';
}) {
    const store = data.storeName[language] || data.storeName.bn || data.storeName.en;
    return (
        <Page widthMm={210} heightMm={297} paddingMm={12}>
            <header className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm">{store}</p>
                    <h1 className="text-xl font-semibold">{labels.title}</h1>
                </div>
                <p className="text-right text-sm">
                    {data.number}
                    <br />
                    {labels.digits(data.purchasedOn)}
                </p>
            </header>
            <p className="mb-4 text-sm">
                <span className="text-black/70">{labels.supplier}</span> {data.supplier.name}
                {data.supplier.phone ? ` · ${data.supplier.phone}` : ''}
                {data.supplier.address ? ` · ${data.supplier.address}` : ''}
            </p>
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="border-b border-black text-left">
                        <th className="py-1 font-semibold">{labels.product}</th>
                        <th className="py-1 text-right font-semibold">{labels.quantity}</th>
                        <th className="py-1 text-right font-semibold">{labels.cost}</th>
                        <th className="py-1 text-right font-semibold">{labels.line}</th>
                    </tr>
                </thead>
                <tbody>
                    {data.lines.map(line => (
                        <tr key={`${line.sku}-${line.name}`} className="border-b border-black/20">
                            <td className="py-1">
                                {line.name}
                                {line.sku ? <span className="block text-xs">{line.sku}</span> : null}
                            </td>
                            <td className="py-1 text-right tabular-nums">{labels.digits(line.quantity)}</td>
                            <td className="py-1 text-right tabular-nums">{labels.money(line.unitCost)}</td>
                            <td className="py-1 text-right tabular-nums">{labels.money(line.quantity * line.unitCost)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <dl className="mt-4 ml-auto w-56 text-sm">
                <Row label={labels.delivery}>{labels.money(data.delivery)}</Row>
                <Row label={labels.other}>{labels.money(data.other)}</Row>
                <Row label={labels.discount}>{labels.money(data.discount)}</Row>
                <Row label={labels.paid}>{labels.money(data.paid)}</Row>
                <Row label={labels.total}>{labels.money(data.total)}</Row>
                <Row label={labels.owed}>{labels.money(data.owed)}</Row>
            </dl>
            {(data.note || data.receiveNote) && (
                <p className="mt-6 text-sm">
                    {labels.note}: {data.receiveNote || data.note}
                </p>
            )}
        </Page>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex justify-between gap-4 py-0.5">
            <dt>{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    );
}
