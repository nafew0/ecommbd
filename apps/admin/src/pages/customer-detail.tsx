import { visibleEmail } from '@ecommbd/shared/placeholder-email';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Phone } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const CUSTOMER = `
    query Customer($id: ID!) {
        customer(id: $id) {
            id
            createdAt
            firstName
            lastName
            emailAddress
            customFields {
                phone
                alternatePhone
                source
                internalNotes
                smsOptOut
                orderCount
                deliveredCount
                returnedCount
                cancelledCount
                totalSpent
                lastOrderAt
            }
            orders(options: { take: 10, sort: { orderPlacedAt: DESC }, filter: { active: { eq: false } } }) {
                totalItems
                items {
                    id
                    code
                    state
                    orderPlacedAt
                    totalWithTax
                }
            }
        }
    }
`;

const SAVE_NOTES = `
    mutation SaveNotes($id: ID!, $notes: String) {
        updateCustomer(input: { id: $id, customFields: { internalNotes: $notes } }) {
            ... on Customer { id }
            ... on ErrorResult { message }
        }
    }
`;

const SAVE_SMS_OPT_OUT = `
    mutation SaveSmsOptOut($id: ID!, $optOut: Boolean!) {
        updateCustomer(input: { id: $id, customFields: { smsOptOut: $optOut } }) {
            ... on Customer { id }
            ... on ErrorResult { message }
        }
    }
`;

interface CustomerDetail {
    id: string;
    createdAt: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    customFields: {
        phone: string | null;
        alternatePhone: string | null;
        source: 'web' | 'manual' | 'import';
        internalNotes: string | null;
        smsOptOut: boolean;
        orderCount: number;
        deliveredCount: number;
        returnedCount: number;
        cancelledCount: number;
        totalSpent: number;
        lastOrderAt: string | null;
    };
    orders: {
        totalItems: number;
        items: Array<{
            id: string;
            code: string;
            state: string;
            orderPlacedAt: string | null;
            totalWithTax: number;
        }>;
    };
}

/** One customer (roadmap phase 03): phone, stats, notes and recent orders. Never a placeholder email. */
export function CustomerDetailPage() {
    const { id = '' } = useParams();
    const { messages: m } = useI18n();
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['customer', id],
        queryFn: () =>
            adminApi<{ customer: CustomerDetail | null }>(CUSTOMER, { id }).then(result => result.customer),
    });
    const customer = query.data;
    const [notes, setNotes] = useState('');
    useEffect(
        () => setNotes(customer?.customFields.internalNotes ?? ''),
        [customer?.customFields.internalNotes],
    );
    const save = useMutation({
        mutationFn: () => adminApi(SAVE_NOTES, { id, notes: notes.trim() || null }),
        onSuccess: () => {
            toast.success(m.customers.notesSaved);
            void queryClient.invalidateQueries({ queryKey: ['customer', id] });
        },
        onError: () => toast.error(m.errors.generic),
    });

    const saveOptOut = useMutation({
        mutationFn: (optOut: boolean) => adminApi(SAVE_SMS_OPT_OUT, { id, optOut }),
        onSuccess: () => {
            toast.success(m.sms.optOutSaved);
            void queryClient.invalidateQueries({ queryKey: ['customer', id] });
        },
        onError: () => toast.error(m.errors.generic),
    });

    if (query.isPending) return <PageSkeleton />;
    if (!customer) {
        return (
            <>
                <BackLink />
                <Alert tone="warning">{m.customers.notFound}</Alert>
            </>
        );
    }
    const f = customer.customFields;
    const n = m.common.number;
    const name = `${customer.firstName} ${customer.lastName}`.trim() || m.customers.noName;
    const finished = f.deliveredCount + f.returnedCount;
    const email = visibleEmail(customer.emailAddress);

    return (
        <>
            <BackLink />
            <PageHeader
                title={name}
                actions={
                    f.phone && (
                        <a
                            href={`tel:${f.phone}`}
                            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-medium text-white hover:bg-teal-800"
                        >
                            <Phone className="size-4" aria-hidden />
                            {m.customers.call(format.phone(f.phone))}
                        </a>
                    )
                }
            />
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader title={m.customers.contact} />
                    <CardBody>
                        <dl className="grid gap-3 sm:grid-cols-2">
                            <Item label={m.customers.phone}>
                                {f.phone ? <a href={`tel:${f.phone}`}>{format.phone(f.phone)}</a> : '—'}
                            </Item>
                            <Item label={m.customers.alternatePhone}>
                                {f.alternatePhone ? (
                                    <a href={`tel:${f.alternatePhone}`}>{format.phone(f.alternatePhone)}</a>
                                ) : (
                                    '—'
                                )}
                            </Item>
                            <Item label={m.customers.email}>{email ?? m.customers.noEmail}</Item>
                            <Item label={m.customers.source}>
                                {m.customers.sources[f.source] ?? f.source}
                            </Item>
                            <Item label={m.customers.since}>{format.date(customer.createdAt)}</Item>
                        </dl>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader
                        title={m.customers.stats}
                        description={
                            finished > 0
                                ? m.customers.deliveryRate(Math.round((f.deliveredCount / finished) * 100))
                                : undefined
                        }
                    />
                    <CardBody>
                        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Item label={m.customers.orderCount}>{n(f.orderCount)}</Item>
                            <Item label={m.customers.delivered}>{n(f.deliveredCount)}</Item>
                            <Item label={m.customers.returned}>{n(f.returnedCount)}</Item>
                            <Item label={m.customers.cancelled}>{n(f.cancelledCount)}</Item>
                            <Item label={m.customers.totalSpent} hint={m.customers.totalSpentHint}>
                                {format.money(f.totalSpent)}
                            </Item>
                            <Item label={m.customers.lastOrder}>{format.date(f.lastOrderAt) || '—'}</Item>
                        </dl>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={m.customers.notes} />
                    <CardBody>
                        <Field label={m.customers.notes} hint={m.customers.notesHint}>
                            {control => (
                                <Textarea
                                    {...control}
                                    value={notes}
                                    maxLength={2000}
                                    readOnly={!can('UpdateCustomer')}
                                    onChange={event => setNotes(event.target.value)}
                                />
                            )}
                        </Field>
                        {can('UpdateCustomer') && (
                            <Button
                                onClick={() => save.mutate()}
                                loading={save.isPending}
                                disabled={notes === (f.internalNotes ?? '')}
                            >
                                {m.customers.saveNotes}
                            </Button>
                        )}
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={m.sms.optOut} />
                    <CardBody>
                        <Switch
                            label={m.sms.optOutLabel}
                            description={m.sms.optOutHint}
                            checked={f.smsOptOut}
                            disabled={!can('UpdateCustomer') || saveOptOut.isPending}
                            onChange={checked => saveOptOut.mutate(checked)}
                        />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={m.customers.recentOrders} />
                    {customer.orders.items.length === 0 ? (
                        <CardBody>
                            <p className="text-slate-600">{m.customers.noOrders}</p>
                        </CardBody>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                    <th className="px-4 py-2 font-medium">
                                        {m.customers.orderColumns.order}
                                    </th>
                                    <th className="px-4 py-2 font-medium">{m.customers.orderColumns.date}</th>
                                    <th className="px-4 py-2 text-right font-medium">
                                        {m.customers.orderColumns.total}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {customer.orders.items.map(order => (
                                    <tr key={order.id}>
                                        <td className="px-4 py-2 font-medium">{order.code}</td>
                                        <td className="px-4 py-2">{format.date(order.orderPlacedAt)}</td>
                                        <td className="px-4 py-2 text-right tabular-nums">
                                            {format.money(order.totalWithTax)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Card>
            </div>
        </>
    );
}

function BackLink() {
    const { messages: m } = useI18n();
    return (
        <Link
            to="/customers"
            className="mb-3 inline-flex items-center gap-1 text-sm text-teal-800 hover:underline"
        >
            <ArrowLeft className="size-4" aria-hidden />
            {m.customers.back}
        </Link>
    );
}

function Item({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="font-medium break-words">{children}</dd>
            {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
        </div>
    );
}
