import { STOCK_REASONS, type StockReason } from '@ecommbd/shared/catalog';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Field } from '../components/form/field';
import { useDigits } from '../components/form/inputs';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input, Select, Textarea } from '../components/ui/input';
import { Badge, EmptyState, PageHeader } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';

const STOCK = `
    query Stock($search: String, $lowOnly: Boolean) {
        bdStock(search: $search, lowOnly: $lowOnly, take: 200) {
            variantId productId name sku preview stockOnHand allocated available backorder low
        }
    }
`;
const HISTORY = `
    query History($variantId: ID!) {
        bdStockHistory(variantId: $variantId) { id createdAt change stockAfter reason note staffName }
    }
`;
const ADJUST = `
    mutation Adjust($input: BdAdjustStockInput!) { adjustBdStock(input: $input) { id stockAfter } }
`;

interface StockRow {
    variantId: string;
    productId: string;
    name: string;
    sku: string;
    preview: string | null;
    stockOnHand: number;
    allocated: number;
    available: number;
    backorder: boolean;
    low: boolean;
}

interface Adjustment {
    id: string;
    createdAt: string;
    change: number;
    stockAfter: number;
    reason: StockReason;
    note: string;
    staffName: string;
}

/** Stock (roadmap phase 05): every variant, lowest first, with quick adjustments and their reasons. */
export function StockPage() {
    const { messages: m } = useI18n();
    const s = m.stock;
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const format = useFormat();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [lowOnly, setLowOnly] = useState(false);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['stock', term, lowOnly],
        queryFn: () =>
            adminApi<{ bdStock: StockRow[] }>(STOCK, { search: term || null, lowOnly }).then(r => r.bdStock),
    });
    const [adjusting, setAdjusting] = useState<StockRow | null>(null);
    const [change, setChange] = useState('');
    const [reason, setReason] = useState<StockReason>('received');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const history = useQuery({
        queryKey: ['stockHistory', adjusting?.variantId],
        enabled: !!adjusting,
        queryFn: () =>
            adminApi<{ bdStockHistory: Adjustment[] }>(HISTORY, { variantId: adjusting!.variantId }).then(
                r => r.bdStockHistory,
            ),
    });
    const amount = Number(banglaToAsciiDigits(change.trim().replace(/^\+/, '')));
    const valid = change.trim() !== '' && Number.isInteger(amount) && amount !== 0;

    const submit = async () => {
        if (!adjusting || !valid) return;
        setBusy(true);
        try {
            await adminApi(ADJUST, {
                input: { variantId: adjusting.variantId, change: amount, reason, note: note.trim() || null },
            });
            toast.success(s.saved);
            setAdjusting(null);
            void queryClient.invalidateQueries({ queryKey: ['stock'] });
            void queryClient.invalidateQueries({ queryKey: ['products'] });
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : m.errors.generic);
        } finally {
            setBusy(false);
        }
    };

    const columns: Column<StockRow>[] = [
        {
            key: 'name',
            header: s.columns.product,
            cell: row => (
                <div className="flex items-center gap-3">
                    {row.preview ? (
                        <img
                            src={`${row.preview}?preset=tiny`}
                            alt=""
                            className="size-10 rounded object-cover"
                        />
                    ) : (
                        <div className="size-10 rounded bg-slate-100" />
                    )}
                    <div className="min-w-0">
                        <Link
                            to={`/products/${row.productId}`}
                            className="font-medium text-teal-800 hover:underline"
                        >
                            {row.name}
                        </Link>
                        <p className="text-sm text-slate-600">{row.sku}</p>
                    </div>
                </div>
            ),
        },
        {
            key: 'available',
            header: s.columns.available,
            cell: row => (
                <span className="flex flex-wrap items-center gap-2">
                    <span className={row.low ? 'font-semibold text-red-700' : 'font-medium'}>
                        {digits(row.available)}
                    </span>
                    {row.low && <Badge tone="red">{s.low}</Badge>}
                    {row.backorder && <Badge tone="sky">{s.preorder}</Badge>}
                </span>
            ),
        },
        {
            key: 'onHand',
            header: s.columns.onHand,
            hideOnMobile: true,
            cell: row => `${digits(row.stockOnHand)} (${s.reserved(digits(row.allocated))})`,
        },
        {
            key: 'actions',
            header: '',
            cell: row =>
                (can('UpdateProduct') || can('UpdateCatalog')) && (
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            setAdjusting(row);
                            setChange('');
                            setReason('received');
                            setNote('');
                        }}
                    >
                        {s.adjust}
                    </Button>
                ),
        },
    ];

    return (
        <>
            <PageHeader title={s.title} description={s.description} />
            <ListPage
                rows={query.data ?? []}
                rowId={row => row.variantId}
                columns={columns}
                loading={query.isPending}
                search={{ value: search, onChange: setSearch, placeholder: s.search }}
                filters={<Switch label={s.lowOnly} checked={lowOnly} onChange={setLowOnly} />}
                empty={<EmptyState icon={<Boxes className="size-6" aria-hidden />} title={s.empty} body="" />}
            />
            <Dialog
                open={!!adjusting}
                onClose={() => setAdjusting(null)}
                dismissible={!busy}
                title={s.adjustTitle(adjusting?.name ?? '')}
                description={adjusting ? s.now(digits(adjusting.stockOnHand)) : undefined}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setAdjusting(null)} disabled={busy}>
                            {m.common.cancel}
                        </Button>
                        <Button loading={busy} disabled={!valid} onClick={() => void submit()}>
                            {m.common.save}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Field label={s.change} hint={s.changeHint}>
                        {control => (
                            <Input
                                {...control}
                                autoFocus
                                inputMode="numeric"
                                value={change}
                                onChange={e => setChange(e.target.value)}
                            />
                        )}
                    </Field>
                    <Field label={s.reason}>
                        {control => (
                            <Select
                                {...control}
                                value={reason}
                                onChange={e => setReason(e.target.value as StockReason)}
                            >
                                {STOCK_REASONS.map(code => (
                                    <option key={code} value={code}>
                                        {s.reasons[code]}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field label={s.note} optional>
                        {control => (
                            <Textarea
                                {...control}
                                rows={2}
                                maxLength={500}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                            />
                        )}
                    </Field>
                    {history.data && history.data.length > 0 && (
                        <div>
                            <h3 className="mb-2 text-sm font-medium">{s.history}</h3>
                            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                                {history.data.map(item => (
                                    <li key={item.id} className="flex flex-wrap justify-between gap-2">
                                        <span>
                                            <span
                                                className={
                                                    item.change > 0 ? 'text-green-700' : 'text-red-700'
                                                }
                                            >
                                                {item.change > 0 ? '+' : ''}
                                                {digits(item.change)}
                                            </span>{' '}
                                            {s.reasons[item.reason] ?? item.reason}
                                            {item.note && ` · ${item.note}`}
                                        </span>
                                        <span className="text-slate-500">
                                            {item.staffName} · {format.dateTime(item.createdAt)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </Dialog>
        </>
    );
}
