import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useDigits } from '../components/form/inputs';
import { Page as Sheet } from '../components/print/common';
import { Button } from '../components/ui/button';
import { PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

interface Part {
    known: boolean;
    amount: number | null;
}

interface Report {
    dateFrom: string;
    dateTo: string;
    previousFrom: string;
    previousTo: string;
    sales: Part;
    productCost: Part;
    deliveryAndCod: Part;
    gatewayFees: Part;
    expensesByHead: Array<{ code: string; name: string; amount: number }>;
    expenseTotal: number;
    profit: Part;
    previousProfit: Part;
    notes: Array<{ orderCode: string; saleDate: string }>;
}

/** A printed profit and loss, on the same page box as the other printouts (phase 53). */
export function ProfitPrintPage() {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const digits = useDigits();
    const [params] = useSearchParams();
    const dateFrom = params.get('from') ?? '';
    const dateTo = params.get('to') ?? '';
    const query = useQuery({
        queryKey: ['profitPrint', dateFrom, dateTo],
        enabled: Boolean(dateFrom && dateTo),
        queryFn: () =>
            adminApi<{ bdProfitAndLoss: Report }>(
                `query ($dateFrom: String!, $dateTo: String!) {
                    bdProfitAndLoss(dateFrom: $dateFrom, dateTo: $dateTo) {
                        dateFrom dateTo previousFrom previousTo expenseTotal
                        sales { known amount }
                        productCost { known amount }
                        deliveryAndCod { known amount }
                        gatewayFees { known amount }
                        profit { known amount }
                        previousProfit { known amount }
                        expensesByHead { code name amount }
                        notes { orderCode saleDate }
                    }
                }`,
                { dateFrom, dateTo },
            ).then(result => result.bdProfitAndLoss),
    });
    if (!query.data) return <PageSkeleton />;
    const data = query.data;
    const money = (part: Part) => (part.known && part.amount != null ? format.money(part.amount) : a.unknown);
    const rows: Array<[string, string]> = [
        [a.sales, money(data.sales)],
        [a.productCost, money(data.productCost)],
        [a.deliveryAndCod, money(data.deliveryAndCod)],
        [a.gatewayFees, money(data.gatewayFees)],
        [a.expenseTotal, format.money(data.expenseTotal)],
        [a.profit, money(data.profit)],
    ];
    return (
        <div className="flex flex-col items-center bg-page p-4 print:bg-white print:p-0">
            <Button className="mb-4 print:hidden" type="button" onClick={() => window.print()}>
                {a.print}
            </Button>
            <Sheet widthMm={210} heightMm={297} paddingMm={12}>
                <h1 className="text-lg font-semibold">{a.profitTitle}</h1>
                <p className="mt-1 text-sm">
                    {digits(data.dateFrom)} – {digits(data.dateTo)}
                </p>
                <table className="mt-4 w-full text-sm">
                    <tbody>
                        {rows.map(([label, value]) => (
                            <tr key={label} className="border-b border-line">
                                <td className="py-1">{label}</td>
                                <td className="py-1 text-right">{value}</td>
                            </tr>
                        ))}
                        {data.expensesByHead.map(row => (
                            <tr key={row.code}>
                                <td className="py-1 pl-4">{row.name}</td>
                                <td className="py-1 text-right">{format.money(row.amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-4 text-sm">
                    {a.compare(money(data.profit), money(data.previousProfit))} ({digits(data.previousFrom)} –{' '}
                    {digits(data.previousTo)})
                </p>
                {data.notes.map(note => (
                    <p key={note.orderCode} className="mt-2 text-sm">
                        {a.returnNote(note.orderCode, digits(note.saleDate))}
                    </p>
                ))}
            </Sheet>
        </div>
    );
}
