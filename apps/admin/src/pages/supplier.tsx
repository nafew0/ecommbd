import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { PhoneInput, TakaInput } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input, Textarea } from '../components/ui/input';
import { Page, TwoColumn } from '../components/ui/layout';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { ApiError, adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';
import { dhakaDateKey } from '@ecommbd/shared/time';

interface Draft {
    name: string;
    phone: string;
    address: string;
    note: string;
}

interface PurchaseRow {
    id: string;
    number: string;
    purchasedOn: string;
    status: string;
    total: number;
    owed: number;
}

interface PaymentRow {
    id: string;
    amount: number;
    paidOn: string;
    note: string;
}

interface Detail extends Draft {
    id: string;
    balance: number;
    purchases: PurchaseRow[];
    payments: PaymentRow[];
}

const empty = (): Draft => ({ name: '', phone: '', address: '', note: '' });

/** One supplier: who they are, what is owed, their purchases and payments. */
export function SupplierPage() {
    const { id } = useParams();
    const isNew = !id;
    const { messages: m } = useI18n();
    const p = m.purchases;
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canEdit = can('ManagePurchase');
    const query = useQuery({
        queryKey: ['supplier', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdSupplier: Detail | null }>(
                `query ($id: ID!) {
                    bdSupplier(id: $id) {
                        id name phone address note balance
                        purchases { id number purchasedOn status total owed }
                        payments { id amount paidOn note }
                    }
                }`,
                { id },
            ).then(result => result.bdSupplier),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Draft>(isNew ? empty() : null);
    useEffect(() => {
        if (query.data) load({ name: query.data.name, phone: query.data.phone ?? '', address: query.data.address, note: query.data.note });
    }, [query.data, load]);
    const save = useMutation({
        mutationFn: (input: Draft) =>
            adminApi<{
                createBdSupplier?: { supplier: { id: string } | null; errors: Array<{ path: string }> };
                updateBdSupplier?: { supplier: { id: string } | null; errors: Array<{ path: string }> };
            }>(
                isNew
                    ? `mutation ($input: JSON!) { createBdSupplier(input: $input) { supplier { id } errors { path } } }`
                    : `mutation ($id: ID!, $input: JSON!) { updateBdSupplier(id: $id, input: $input) { supplier { id } errors { path } } }`,
                { id, input },
            ),
        onSuccess: result => {
            const saved = result.createBdSupplier ?? result.updateBdSupplier;
            if (!saved?.supplier) {
                toast.error(m.settings.fixErrors);
                return;
            }
            toast.success(p.saved);
            load(draft!);
            if (isNew) navigate(`/products/suppliers/${saved.supplier.id}`, { replace: true });
            else void queryClient.invalidateQueries({ queryKey: ['supplier', id] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    if (!draft || (!isNew && query.isLoading)) return <PageSkeleton />;
    const detail = query.data;
    return (
        <Page width="wide">
            <PageHeader
                back={{ to: '/products/suppliers', label: p.backSuppliers }}
                title={isNew ? p.addSupplier : draft.name || p.suppliersTitle}
                actions={
                    detail && canEdit ? (
                        <Button onClick={() => navigate(`/products/purchases/new?supplier=${detail.id}`)}>
                            {p.newPurchaseFor}
                        </Button>
                    ) : undefined
                }
            />
            <form
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) save.mutate(draft);
                }}
            >
                <TwoColumn
                    main={
                        <div className="space-y-4">
                            <Card>
                                <CardHeader title={p.name} />
                                <CardBody>
                                    <Field label={p.name} error={undefined}>
                                        {control => (
                                            <Input
                                                {...control}
                                                value={draft.name}
                                                disabled={!canEdit}
                                                onChange={event => setDraft({ ...draft, name: event.target.value })}
                                            />
                                        )}
                                    </Field>
                                    <Field label={p.phone} optional>
                                        {control => (
                                            <PhoneInput
                                                {...control}
                                                value={draft.phone}
                                                disabled={!canEdit}
                                                onChange={phone => setDraft({ ...draft, phone })}
                                            />
                                        )}
                                    </Field>
                                    <Field label={p.address} optional>
                                        {control => (
                                            <Textarea
                                                {...control}
                                                value={draft.address}
                                                disabled={!canEdit}
                                                onChange={event => setDraft({ ...draft, address: event.target.value })}
                                            />
                                        )}
                                    </Field>
                                    <Field label={p.note} optional>
                                        {control => (
                                            <Textarea
                                                {...control}
                                                value={draft.note}
                                                disabled={!canEdit}
                                                onChange={event => setDraft({ ...draft, note: event.target.value })}
                                            />
                                        )}
                                    </Field>
                                </CardBody>
                            </Card>
                            {detail && <PurchaseHistory rows={detail.purchases} />}
                            {detail && canEdit && <PaymentCard supplierId={detail.id} />}
                        </div>
                    }
                    side={
                        detail ? (
                            <Card>
                                <CardHeader title={p.balance} />
                                <CardBody>
                                    <p className="text-2xl font-semibold tabular-nums">{format.money(detail.balance)}</p>
                                    <p className="text-[13px] text-ink-muted">{p.balanceHint}</p>
                                </CardBody>
                            </Card>
                        ) : (
                            <span />
                        )
                    }
                />
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}

function PurchaseHistory({ rows }: { rows: PurchaseRow[] }) {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const format = useFormat();
    return (
        <Card>
            <CardHeader title={p.history} />
            <CardBody>
                {rows.length === 0 ? (
                    <p className="text-sm text-ink-muted">{p.emptyPurchases}</p>
                ) : (
                    <ul className="divide-y divide-line">
                        {rows.map(row => (
                            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                                <Link to={`/products/purchases/${row.id}`} className="font-semibold text-accent hover:underline">
                                    {row.number}
                                </Link>
                                <span className="text-ink-muted">{p.statuses[row.status as keyof typeof p.statuses]}</span>
                                <span className="tabular-nums">{format.money(row.total)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );
}

function PaymentCard({ supplierId }: { supplierId: string }) {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const toast = useToast();
    const queryClient = useQueryClient();
    const [amount, setAmount] = useState<number | null>(null);
    const [paidOn, setPaidOn] = useState(dhakaDateKey(new Date()));
    const [note, setNote] = useState('');
    const save = useMutation({
        mutationFn: () =>
            adminApi(
                `mutation ($input: JSON!) { recordBdSupplierPayment(input: $input) { id } }`,
                { input: { supplierId, amount, paidOn, note } },
            ),
        onSuccess: () => {
            toast.success(p.paymentSaved);
            setAmount(null);
            setNote('');
            void queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    return (
        <CollapsibleCard title={p.payments} summary={p.recordPayment}>
            <div className="space-y-4">
                <Field label={p.paymentAmount}>
                    {control => <TakaInput {...control} value={amount} onChange={setAmount} />}
                </Field>
                <Field label={p.paymentDate}>
                    {control => (
                        <Input {...control} type="date" value={paidOn} onChange={event => setPaidOn(event.target.value)} />
                    )}
                </Field>
                <Field label={p.note} optional>
                    {control => <Input {...control} value={note} onChange={event => setNote(event.target.value)} />}
                </Field>
                <Button type="button" disabled={!amount || save.isPending} onClick={() => save.mutate()}>
                    {p.recordPayment}
                </Button>
            </div>
        </CollapsibleCard>
    );
}

