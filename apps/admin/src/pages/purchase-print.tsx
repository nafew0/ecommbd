import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { PurchaseDocument, type PurchasePrintData } from '../components/print/purchase';
import { useDigits } from '../components/form/inputs';
import { PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

/** Purchase order and goods-received note (phase 52), using the shared print page box. */
export function PurchasePrintPage() {
    const { messages: m, language } = useI18n();
    const p = m.purchases.print;
    const format = useFormat();
    const digits = useDigits();
    const [params] = useSearchParams();
    const id = params.get('id');
    const document = params.get('document') === 'receipt' ? 'receipt' : 'order';
    const query = useQuery({
        queryKey: ['purchasePrint', id, document],
        enabled: Boolean(id),
        queryFn: () =>
            adminApi<{ bdPurchasePrint: PurchasePrintData }>(
                `query ($id: ID!, $document: String!) { bdPurchasePrint(id: $id, document: $document) }`,
                { id, document },
            ).then(result => result.bdPurchasePrint),
        gcTime: 0,
        staleTime: 0,
    });
    if (!query.data) return <PageSkeleton />;
    const data = query.data;
    return (
        <div className="flex justify-center bg-page p-4 print:bg-white print:p-0">
            <PurchaseDocument
                data={data}
                language={language}
                labels={{
                    title: document === 'receipt' ? p.receipt : p.order,
                    supplier: p.supplier,
                    product: p.product,
                    quantity: p.quantity,
                    cost: p.cost,
                    line: p.line,
                    delivery: p.delivery,
                    other: p.other,
                    discount: p.discount,
                    paid: p.paid,
                    total: p.total,
                    owed: p.owed,
                    note: p.note,
                    money: format.money,
                    digits,
                }}
            />
        </div>
    );
}
