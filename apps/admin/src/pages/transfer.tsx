import { asciiToBanglaDigits, banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { type PickedVariant, ProductPicker } from '../components/orders/product-picker';
import { Field } from '../components/form/field';
import { useDigits } from '../components/form/inputs';
import { MoreFields } from '../components/ui/disclosure';
import { Input, Select, Textarea } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { ApiError, adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

interface BranchOption {
    id: string;
    name: string;
}

interface LineDraft {
    key: string;
    variantId: string;
    name: string;
    quantity: string;
}

interface SendDraft {
    fromId: string;
    toId: string;
    note: string;
    lines: LineDraft[];
}

interface TransferLine {
    id: string;
    variantId: string;
    name: string;
    sku: string;
    quantity: number;
    received: number;
    inTransit: number;
}

interface TransferView {
    id: string;
    number: string;
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    status: 'sent' | 'partial' | 'received';
    note: string;
    sentAt: string;
    lines: TransferLine[];
}

const TONE = { sent: 'sky', partial: 'amber', received: 'green' } as const;

function qty(value: string): number {
    const parsed = Number(banglaToAsciiDigits(value).replace(/[^\d]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

const empty = (): SendDraft => ({ fromId: '', toId: '', note: '', lines: [] });

/** Send stock, or receive what is still on the way. */
export function TransferPage() {
    const { id } = useParams();
    const query = useQuery({
        queryKey: ['transfer', id],
        enabled: Boolean(id),
        queryFn: () =>
            adminApi<{ bdTransfer: TransferView | null }>(
                `query ($id: ID!) {
                    bdTransfer(id: $id) {
                        id number fromId toId fromName toName status note sentAt
                        lines { id variantId name sku quantity received inTransit }
                    }
                }`,
                { id },
            ).then(result => result.bdTransfer),
    });
    if (id && query.isLoading) return <PageSkeleton />;
    if (!id) return <SendForm />;
    if (!query.data) return <PageSkeleton />;
    return <ReceiveForm transfer={query.data} />;
}

function useBranches() {
    return useQuery({
        queryKey: ['branchOptions'],
        queryFn: () => adminApi<{ bdBranches: BranchOption[] }>(`{ bdBranches { id name } }`).then(result => result.bdBranches),
    });
}

function BranchSelect({
    label,
    value,
    branches,
    disabled,
    error,
    onChange,
}: {
    label: string;
    value: string;
    branches: BranchOption[];
    disabled?: boolean;
    error?: string;
    onChange(value: string): void;
}) {
    const { messages: m } = useI18n();
    return (
        <Field label={label} error={error}>
            {control => (
                <Select {...control} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
                    <option value="">{m.branches.chooseBranch}</option>
                    {branches.map(branch => (
                        <option key={branch.id} value={branch.id}>
                            {branch.name}
                        </option>
                    ))}
                </Select>
            )}
        </Field>
    );
}

function SendForm() {
    const { messages: m } = useI18n();
    const b = m.branches;
    const digits = useDigits();
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const canEdit = can('ManageBranch');
    const branches = useBranches();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const { draft, setDraft, dirty, discard } = useDraft<SendDraft>(empty());
    const save = useMutation({
        mutationFn: (input: SendDraft) =>
            adminApi<{
                sendBdTransfer: { transfer: { id: string } | null; errors: Array<{ path: string; code: string }> };
            }>(
                `mutation ($input: JSON!) {
                    sendBdTransfer(input: $input) { transfer { id } errors { path code } }
                }`,
                {
                    input: {
                        fromId: input.fromId,
                        toId: input.toId,
                        note: input.note,
                        lines: input.lines.map(line => ({ variantId: line.variantId, quantity: qty(line.quantity) })),
                    },
                },
            ).then(result => result.sendBdTransfer),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (!result.transfer) {
                toast.error(m.settings.fixErrors);
                return;
            }
            toast.success(b.sent);
            navigate(`/products/transfers/${result.transfer.id}`, { replace: true });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const add = (variant: PickedVariant) => {
        const existing = draft.lines.find(line => line.variantId === variant.variantId);
        setDraft({
            ...draft,
            lines: existing
                ? draft.lines.map(line =>
                      line.variantId === variant.variantId
                          ? { ...line, quantity: digits(qty(line.quantity) + 1) }
                          : line,
                  )
                : [...draft.lines, { key: variant.variantId, variantId: variant.variantId, name: variant.name, quantity: digits(1) }],
        });
    };
    return (
        <Page width="narrow">
            <PageHeader back={{ to: '/products/transfers', label: b.backTransfers }} title={b.addTransfer} />
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={b.from} />
                    <CardBody>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <BranchSelect
                                label={b.from}
                                value={draft.fromId}
                                branches={branches.data ?? []}
                                disabled={!canEdit}
                                error={errors.fromId}
                                onChange={fromId => setDraft({ ...draft, fromId })}
                            />
                            <BranchSelect
                                label={b.to}
                                value={draft.toId}
                                branches={branches.data ?? []}
                                disabled={!canEdit}
                                error={errors.toId}
                                onChange={toId => setDraft({ ...draft, toId })}
                            />
                        </div>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={b.lines} />
                    <CardBody>
                        {canEdit && <ProductPicker allowSoldOut onPick={add} />}
                        <ul className="space-y-3">
                            {draft.lines.map(line => (
                                <li key={line.key} className="grid gap-3 sm:grid-cols-2">
                                    <p className="text-sm">{line.name}</p>
                                    <Field label={b.quantity}>
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
                                </li>
                            ))}
                        </ul>
                        <MoreFields summary={b.note}>
                            <Field label={b.note} error={errors.note} optional>
                                {control => (
                                    <Textarea
                                        {...control}
                                        value={draft.note}
                                        maxLength={500}
                                        disabled={!canEdit}
                                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    />
                                )}
                            </Field>
                        </MoreFields>
                    </CardBody>
                </Card>
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saveLabel={b.send} onDiscard={discard} />}
            </form>
        </Page>
    );
}

function ReceiveForm({ transfer }: { transfer: TransferView }) {
    const { messages: m, language } = useI18n();
    const b = m.branches;
    const digits = useDigits();
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('ManageBranch') && transfer.status !== 'received';
    const { draft, setDraft, load, dirty, discard } = useDraft<Record<string, string>>(null);
    const remaining = transfer.lines.map(line => `${line.id}:${line.inTransit}`).join(',');
    useEffect(() => {
        const show = (value: number) => (language === 'bn' ? asciiToBanglaDigits(String(value)) : String(value));
        const zeros = Object.fromEntries(transfer.lines.map(line => [line.id, '0']));
        load(zeros);
        setDraft(Object.fromEntries(transfer.lines.map(line => [line.id, show(line.inTransit)])));
    }, [remaining, language, load, setDraft, transfer.lines]);
    const receive = useMutation({
        mutationFn: (quantities: Record<string, string>) =>
            adminApi(
                `mutation ($id: ID!, $input: JSON!) { receiveBdTransfer(id: $id, input: $input) { id } }`,
                {
                    id: transfer.id,
                    input: {
                        lines: transfer.lines.map(line => ({ lineId: line.id, quantity: qty(quantities[line.id] ?? '0') })),
                    },
                },
            ),
        onSuccess: () => {
            toast.success(b.receivedSaved);
            void queryClient.invalidateQueries({ queryKey: ['transfer', transfer.id] });
            void queryClient.invalidateQueries({ queryKey: ['transfers'] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    return (
        <Page width="narrow">
            <PageHeader
                back={{ to: '/products/transfers', label: b.backTransfers }}
                title={transfer.number}
                description={`${transfer.fromName} → ${transfer.toName} · ${format.dateTime(transfer.sentAt)}`}
                badges={<Badge tone={TONE[transfer.status]}>{b.statuses[transfer.status]}</Badge>}
            />
            <form
                onSubmit={event => {
                    event.preventDefault();
                    if (canEdit) receive.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={b.lines} />
                    <CardBody>
                        <ul className="space-y-3">
                            {transfer.lines.map(line => (
                                <li key={line.id} className="grid gap-3 sm:grid-cols-2">
                                    <div className="text-sm">
                                        <p>{line.name}</p>
                                        <p className="text-ink-muted">
                                            {b.quantity} {digits(line.quantity)} · {b.inTransit} {digits(line.inTransit)}
                                        </p>
                                    </div>
                                    {canEdit ? (
                                        <Field label={b.receive}>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    inputMode="numeric"
                                                    value={draft[line.id] ?? ''}
                                                    onChange={event => setDraft({ ...draft, [line.id]: event.target.value })}
                                                />
                                            )}
                                        </Field>
                                    ) : (
                                        <p className="text-sm text-ink-muted">
                                            {b.received} {digits(line.received)}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {transfer.note && <p className="text-sm text-ink-muted">{transfer.note}</p>}
                    </CardBody>
                </Card>
                {canEdit && (
                    <SaveBar
                        dirty={dirty}
                        saving={receive.isPending}
                        saveLabel={b.receive}
                        onDiscard={discard}
                    />
                )}
            </form>
        </Page>
    );
}
