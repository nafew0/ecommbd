import { dhakaDateKey } from '@ecommbd/shared/time';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { type PickedVariant, ProductPicker } from '../components/orders/product-picker';
import { Field } from '../components/form/field';
import { ImageUpload, type UploadedImage } from '../components/form/image-upload';
import { TakaInput, useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input, Select, Textarea } from '../components/ui/input';
import { Page, TwoColumn } from '../components/ui/layout';
import { Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { ApiError, adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

interface LineDraft {
    key: string;
    variantId: string;
    name: string;
    quantity: string;
    unitCost: number | null;
}

interface Draft {
    supplierId: string;
    purchasedOn: string;
    note: string;
    delivery: number | null;
    other: number | null;
    discount: number | null;
    paid: number | null;
    lines: LineDraft[];
    bill: UploadedImage | null;
}

interface LineView {
    id: string;
    variantId: string;
    name: string;
    sku: string;
    quantity: number;
    received: number;
    returned: number;
    unitCost: number;
}

interface PurchaseView {
    id: string;
    number: string;
    supplierId: string;
    supplierName: string;
    purchasedOn: string;
    status: 'draft' | 'ordered' | 'partial' | 'received';
    note: string;
    receiveNote: string;
    delivery: number;
    other: number;
    discount: number;
    paid: number;
    billAssetId: string | null;
    billPreview: string | null;
    total: number;
    owed: number;
    lines: LineView[];
}

const TONE = { draft: 'slate', ordered: 'sky', partial: 'amber', received: 'green' } as const;

function blank(supplierId: string): Draft {
    return {
        supplierId,
        purchasedOn: dhakaDateKey(new Date()),
        note: '',
        delivery: null,
        other: null,
        discount: null,
        paid: null,
        lines: [],
        bill: null,
    };
}

function qty(value: string): number {
    const parsed = Number(banglaToAsciiDigits(value).replace(/[^\d]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

/** A purchase: a draft to fill in, then receive stock or send some back. */
export function PurchasePage() {
    const { id } = useParams();
    const [params] = useSearchParams();
    const query = useQuery({
        queryKey: ['purchase', id],
        enabled: Boolean(id),
        queryFn: () =>
            adminApi<{ bdPurchase: PurchaseView | null }>(
                `query ($id: ID!) {
                    bdPurchase(id: $id) {
                        id number supplierId supplierName purchasedOn status note receiveNote
                        delivery other discount paid billAssetId billPreview total owed
                        lines { id variantId name sku quantity received returned unitCost }
                    }
                }`,
                { id },
            ).then(result => result.bdPurchase),
    });
    if (id && query.isLoading) return <PageSkeleton />;
    if (!id || query.data?.status === 'draft') {
        return <PurchaseForm id={id} initial={query.data} supplierId={params.get('supplier') ?? ''} />;
    }
    if (!query.data) return <PageSkeleton />;
    return <PurchaseDetail purchase={query.data} />;
}

function PurchaseForm({ id, initial, supplierId }: { id?: string; initial?: PurchaseView | null; supplierId: string }) {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const digits = useDigits();
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canEdit = can('ManagePurchase');
    const suppliers = useQuery({
        queryKey: ['supplierOptions'],
        queryFn: () =>
            adminApi<{ bdSuppliers: { items: Array<{ id: string; name: string }> } }>(
                `{ bdSuppliers(take: 100) { items { id name } } }`,
            ).then(result => result.bdSuppliers.items),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Draft>(null);
    useEffect(() => {
        if (draft) return;
        if (initial) {
            load({
                supplierId: initial.supplierId,
                purchasedOn: initial.purchasedOn,
                note: initial.note,
                delivery: initial.delivery,
                other: initial.other,
                discount: initial.discount,
                paid: initial.paid,
                bill: initial.billPreview && initial.billAssetId ? { id: initial.billAssetId, preview: initial.billPreview } : null,
                lines: initial.lines.map(line => ({
                    key: line.id,
                    variantId: line.variantId,
                    name: line.name,
                    quantity: digits(line.quantity),
                    unitCost: line.unitCost,
                })),
            });
        } else if (!id) {
            load(blank(supplierId));
        }
    }, [initial, id, supplierId, draft, load, digits]);
    const save = useMutation({
        mutationFn: (input: Draft) => {
            const body = {
                supplierId: input.supplierId,
                purchasedOn: input.purchasedOn,
                note: input.note,
                delivery: input.delivery ?? 0,
                other: input.other ?? 0,
                discount: input.discount ?? 0,
                paid: input.paid ?? 0,
                billAssetId: input.bill?.id ?? null,
                lines: input.lines.map(line => ({
                    id: null,
                    variantId: line.variantId,
                    quantity: qty(line.quantity),
                    unitCost: line.unitCost ?? 0,
                })),
            };
            return adminApi<{
                createBdPurchase?: { purchase: { id: string } | null; errors: Array<{ path: string }> };
                updateBdPurchase?: { purchase: { id: string } | null; errors: Array<{ path: string }> };
            }>(
                id
                    ? `mutation ($id: ID!, $input: JSON!) { updateBdPurchase(id: $id, input: $input) { purchase { id } errors { path } } }`
                    : `mutation ($input: JSON!) { createBdPurchase(input: $input) { purchase { id } errors { path } } }`,
                { id, input: body },
            );
        },
        onSuccess: result => {
            const saved = result.createBdPurchase ?? result.updateBdPurchase;
            if (!saved?.purchase) {
                toast.error(m.settings.fixErrors);
                return;
            }
            toast.success(p.saved);
            if (!id) navigate(`/products/purchases/${saved.purchase.id}`, { replace: true });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const order = useMutation({
        mutationFn: () =>
            adminApi(`mutation ($id: ID!) { markBdPurchaseOrdered(id: $id) { id } }`, { id }),
        onSuccess: () => {
            toast.success(p.orderedSaved);
            void queryClient.invalidateQueries({ queryKey: ['purchase', id] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const add = (variant: PickedVariant) =>
        setDraft({
            ...draft,
            lines: [
                ...draft.lines,
                { key: variant.variantId + draft.lines.length, variantId: variant.variantId, name: variant.name, quantity: digits(1), unitCost: null },
            ],
        });
    return (
        <Page width="wide">
            <PageHeader
                back={{ to: '/products/purchases', label: p.backPurchases }}
                title={initial?.number ?? p.addPurchase}
                badges={initial ? <Badge tone="slate">{p.statuses.draft}</Badge> : undefined}
                menu={
                    id && canEdit
                        ? [{ label: p.markOrdered, onSelect: () => order.mutate() }]
                        : undefined
                }
            />
            {(suppliers.data?.length ?? 0) === 0 && !suppliers.isLoading && (
                <p className="mb-4 text-sm text-ink-muted">{p.noSupplier}</p>
            )}
            <form
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) save.mutate(draft);
                }}
            >
                <div className="space-y-4">
                    <Card>
                        <CardHeader title={p.supplier} />
                        <CardBody>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={p.supplier}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={draft.supplierId}
                                            disabled={!canEdit}
                                            onChange={event => setDraft({ ...draft, supplierId: event.target.value })}
                                        >
                                            <option value="">{p.supplier}</option>
                                            {(suppliers.data ?? []).map(row => (
                                                <option key={row.id} value={row.id}>
                                                    {row.name}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                                <Field label={p.date}>
                                    {control => (
                                        <Input
                                            {...control}
                                            type="date"
                                            value={draft.purchasedOn}
                                            disabled={!canEdit}
                                            onChange={event => setDraft({ ...draft, purchasedOn: event.target.value })}
                                        />
                                    )}
                                </Field>
                            </div>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader title={p.lines} />
                        <CardBody>
                            {canEdit && <ProductPicker allowSoldOut onPick={add} />}
                            <ul className="space-y-3">
                                {draft.lines.map(line => (
                                    <li key={line.key} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        <p className="text-sm sm:col-span-2 lg:col-span-1">{line.name}</p>
                                        <Field label={p.quantity}>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    inputMode="numeric"
                                                    value={line.quantity}
                                                    disabled={!canEdit}
                                                    onChange={event =>
                                                        setDraft({
                                                            ...draft,
                                                            lines: draft.lines.map(item =>
                                                                item.key === line.key ? { ...item, quantity: event.target.value } : item,
                                                            ),
                                                        })
                                                    }
                                                />
                                            )}
                                        </Field>
                                        <Field label={p.cost}>
                                            {control => (
                                                <TakaInput
                                                    {...control}
                                                    value={line.unitCost}
                                                    disabled={!canEdit}
                                                    onChange={unitCost =>
                                                        setDraft({
                                                            ...draft,
                                                            lines: draft.lines.map(item =>
                                                                item.key === line.key ? { ...item, unitCost } : item,
                                                            ),
                                                        })
                                                    }
                                                />
                                            )}
                                        </Field>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                className="text-left text-sm text-danger"
                                                onClick={() =>
                                                    setDraft({ ...draft, lines: draft.lines.filter(item => item.key !== line.key) })
                                                }
                                            >
                                                {p.remove}
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </CardBody>
                    </Card>
                    <CollapsibleCard
                        title={p.charges}
                        summary={draft.delivery || draft.paid ? p.charges : p.charges}
                        forceOpen={Boolean(draft.delivery || draft.other || draft.discount || draft.paid || draft.note || draft.bill)}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={p.delivery} optional>
                                {control => (
                                    <TakaInput {...control} value={draft.delivery} disabled={!canEdit} onChange={delivery => setDraft({ ...draft, delivery })} />
                                )}
                            </Field>
                            <Field label={p.other} optional>
                                {control => (
                                    <TakaInput {...control} value={draft.other} disabled={!canEdit} onChange={other => setDraft({ ...draft, other })} />
                                )}
                            </Field>
                            <Field label={p.discount} optional>
                                {control => (
                                    <TakaInput {...control} value={draft.discount} disabled={!canEdit} onChange={discount => setDraft({ ...draft, discount })} />
                                )}
                            </Field>
                            <Field label={p.paid} optional>
                                {control => (
                                    <TakaInput {...control} value={draft.paid} disabled={!canEdit} onChange={paid => setDraft({ ...draft, paid })} />
                                )}
                            </Field>
                        </div>
                        <Field label={p.note} optional>
                            {control => (
                                <Textarea {...control} value={draft.note} disabled={!canEdit} onChange={event => setDraft({ ...draft, note: event.target.value })} />
                            )}
                        </Field>
                        <Field label={p.bill} optional>
                            {() => (
                                <ImageUpload value={draft.bill} disabled={!canEdit} onChange={bill => setDraft({ ...draft, bill })} />
                            )}
                        </Field>
                    </CollapsibleCard>
                </div>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}

function PurchaseDetail({ purchase }: { purchase: PurchaseView }) {
    const { messages: m } = useI18n();
    const p = m.purchases;
    const format = useFormat();
    const digits = useDigits();
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canEdit = can('ManagePurchase');
    const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
    const [receiveNote, setReceiveNote] = useState(purchase.receiveNote);
    const [returnQty, setReturnQty] = useState<Record<string, string>>({});
    const [showReturn, setShowReturn] = useState(false);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['purchase', purchase.id] });
    const receive = useMutation({
        mutationFn: () =>
            adminApi(`mutation ($id: ID!, $input: JSON!) { receiveBdPurchase(id: $id, input: $input) { id } }`, {
                id: purchase.id,
                input: {
                    note: receiveNote,
                    lines: purchase.lines.map(line => ({ lineId: line.id, quantity: qty(receiveQty[line.id] ?? '') })),
                },
            }),
        onSuccess: () => {
            toast.success(p.receivedSaved);
            setReceiveQty({});
            refresh();
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const sendBack = useMutation({
        mutationFn: () =>
            adminApi(`mutation ($id: ID!, $input: JSON!) { returnBdPurchase(id: $id, input: $input) { id } }`, {
                id: purchase.id,
                input: {
                    lines: purchase.lines.map(line => ({ lineId: line.id, quantity: qty(returnQty[line.id] ?? '') })),
                },
            }),
        onSuccess: () => {
            toast.success(p.returnSaved);
            setReturnQty({});
            setShowReturn(false);
            refresh();
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const remove = useMutation({
        mutationFn: () => adminApi(`mutation ($id: ID!) { deleteBdPurchase(id: $id) }`, { id: purchase.id }),
        onSuccess: () => {
            toast.success(p.deleted);
            navigate('/products/purchases');
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const receivedAny = purchase.lines.some(line => line.received > 0);
    const openPrint = (document: 'order' | 'receipt') =>
        window.open(`/admin/print/purchase?id=${purchase.id}&document=${document}`, '_blank');
    return (
        <Page width="wide">
            <PageHeader
                back={{ to: '/products/purchases', label: p.backPurchases }}
                title={purchase.number}
                badges={<Badge tone={TONE[purchase.status]}>{p.statuses[purchase.status]}</Badge>}
                actions={
                    canEdit ? (
                        <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
                            {p.receive}
                        </Button>
                    ) : undefined
                }
                menu={[
                    { label: p.printOrder, onSelect: () => openPrint('order') },
                    ...(receivedAny ? [{ label: p.printReceipt, onSelect: () => openPrint('receipt') }] : []),
                    ...(canEdit
                        ? [
                              { label: p.returnGoods, onSelect: () => setShowReturn(true) },
                              ...(!receivedAny
                                  ? [
                                        {
                                            label: p.delete,
                                            tone: 'danger' as const,
                                            onSelect: () => {
                                                void confirm({ title: p.deleteTitle, body: p.deleteBody, danger: true }).then(yes => {
                                                    if (yes) remove.mutate();
                                                });
                                            },
                                        },
                                    ]
                                  : []),
                          ]
                        : []),
                ]}
            />
            <TwoColumn
                main={
                    <div className="space-y-4">
                        <Card>
                            <CardHeader title={p.lines} />
                            <CardBody>
                                <ul className="divide-y divide-line">
                                    {purchase.lines.map(line => (
                                        <li key={line.id} className="grid gap-2 py-3 sm:grid-cols-4">
                                            <div>
                                                <p className="text-sm">{line.name}</p>
                                                <p className="text-[13px] text-ink-muted">{line.sku}</p>
                                            </div>
                                            <p className="text-sm tabular-nums">
                                                {p.ordered} {digits(line.quantity)}
                                            </p>
                                            <p className="text-sm tabular-nums">
                                                {p.received} {digits(line.received)}
                                                {line.returned > 0 && ` · ${p.returned} ${digits(line.returned)}`}
                                            </p>
                                            <p className="text-sm tabular-nums">{format.money(line.unitCost)}</p>
                                            {canEdit && (
                                                <Field label={p.receiveNow}>
                                                    {control => (
                                                        <Input
                                                            {...control}
                                                            inputMode="numeric"
                                                            value={receiveQty[line.id] ?? ''}
                                                            onChange={event =>
                                                                setReceiveQty(current => ({ ...current, [line.id]: event.target.value }))
                                                            }
                                                        />
                                                    )}
                                                </Field>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                {canEdit && (
                                    <Field label={p.receiveNote} hint={p.receiveHint} optional>
                                        {control => (
                                            <Textarea
                                                {...control}
                                                value={receiveNote}
                                                onChange={event => setReceiveNote(event.target.value)}
                                            />
                                        )}
                                    </Field>
                                )}
                            </CardBody>
                        </Card>
                        {showReturn && canEdit && (
                            <Card>
                                <CardHeader title={p.returnGoods} />
                                <CardBody>
                                    <p className="text-[13px] text-ink-muted">{p.returnHint}</p>
                                    {purchase.lines.map(line => (
                                        <Field key={line.id} label={`${line.name} · ${p.returnNow}`}>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    inputMode="numeric"
                                                    value={returnQty[line.id] ?? ''}
                                                    onChange={event =>
                                                        setReturnQty(current => ({ ...current, [line.id]: event.target.value }))
                                                    }
                                                />
                                            )}
                                        </Field>
                                    ))}
                                    <Button type="button" onClick={() => sendBack.mutate()} disabled={sendBack.isPending}>
                                        {p.returnGoods}
                                    </Button>
                                </CardBody>
                            </Card>
                        )}
                    </div>
                }
                side={
                    <Card>
                        <CardHeader title={purchase.supplierName} />
                        <CardBody>
                            <p className="text-sm text-ink-muted">{digits(purchase.purchasedOn)}</p>
                            <p className="text-sm">
                                {p.total} <span className="tabular-nums">{format.money(purchase.total)}</span>
                            </p>
                            <p className="text-sm">
                                {p.owed} <span className="tabular-nums">{format.money(purchase.owed)}</span>
                            </p>
                            {purchase.note && <p className="text-sm">{purchase.note}</p>}
                        </CardBody>
                    </Card>
                }
            />
        </Page>
    );
}
