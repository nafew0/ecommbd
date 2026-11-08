import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, Badge, Card, CardBody, CardHeader } from './ui/misc';
import {
    addressLines,
    apiErrorMessage,
    decimalToMinor,
    formatMinor,
    sameAddress,
    wooStatusLabel,
} from './woo-migration-format';
import { TechnicalDetails } from './woo-run-report';

interface Legacy {
    id: string;
    number: string;
    status: string;
    currency: string;
    /** Minor units (poisha for taka), as a string: the column is a bigint. */
    total: string;
    refunded?: string;
    placedAt?: string | null;
    liveOrderId?: string | null;
    /** The billing name and phone (lists only). */
    name?: string;
    phone?: string | null;
    /** The WooCommerce order as it was imported (only on `wooLegacyOrder`). */
    snapshot?: Record<string, unknown>;
}

/** Only WooCommerce's unpaid, not-yet-shipped statuses can become a live order. */
const CONVERTIBLE = ['pending', 'processing', 'on-hold'];

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * Orders imported from WooCommerce, kept as read-only history (roadmap phase 21), on the
 * migration page and a customer's page. A recent unpaid COD order can be turned into a live one.
 */
export function LegacyOrders({
    sourceId,
    customerId,
    pageSize = 10,
    showHeader = true,
}: {
    sourceId?: string;
    customerId?: string;
    pageSize?: number;
    /** False on the WooCommerce orders page, whose page header already says what this is. */
    showHeader?: boolean;
}) {
    const { messages, language } = useI18n();
    const m = messages.migration;
    const format = useFormat();
    const { can } = useAuth();
    const client = useQueryClient();
    const [search, setSearch] = useState('');
    const [skip, setSkip] = useState(0);
    const [selected, setSelected] = useState('');
    const [frozen, setFrozen] = useState(false);
    const [reduced, setReduced] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [live, setLive] = useState('');
    const query = useQuery({
        queryKey: ['woo', 'history', sourceId, customerId, search, skip, pageSize],
        queryFn: () =>
            adminApi<{ wooLegacyOrders: { items: Legacy[]; totalItems: number } }>(
                'query($sourceId:ID,$customerId:ID,$search:String,$skip:Int,$take:Int){wooLegacyOrders(sourceId:$sourceId,customerId:$customerId,search:$search,skip:$skip,take:$take)}',
                { sourceId, customerId, search, skip, take: pageSize },
            ).then(r => r.wooLegacyOrders),
    });
    const detail = useQuery({
        queryKey: ['woo', 'legacy', selected],
        enabled: !!selected,
        queryFn: () =>
            adminApi<{ wooLegacyOrder: Legacy }>('query($id:ID!){wooLegacyOrder(id:$id)}', {
                id: selected,
            }).then(r => r.wooLegacyOrder),
    });
    async function convert() {
        setBusy(true);
        setError('');
        try {
            const result = await adminApi<{ convertWooOpenOrder: { id: string } }>(
                'mutation($legacyId:ID!,$input:JSON!){convertWooOpenOrder(legacyId:$legacyId,input:$input){id}}',
                { legacyId: selected, input: { sourceFrozen: frozen, inventoryAlreadyReduced: reduced } },
            );
            setLive(result.convertWooOpenOrder.id);
            await client.invalidateQueries({ queryKey: ['woo', 'history'] });
        } catch (cause) {
            // The server explains refusals (address, stock, totals) in the admin's language.
            setError(apiErrorMessage(m, cause));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Card>
            {showHeader && <CardHeader title={m.legacyTitle} />}
            <CardBody>
                {showHeader && <p className="text-sm text-slate-600">{m.legacyIntro}</p>}
                <Input
                    aria-label={m.search}
                    placeholder={m.search}
                    value={search}
                    onChange={e => {
                        setSearch(e.target.value);
                        setSkip(0);
                    }}
                />
                {(query.isError || detail.isError) && <Alert tone="warning">{m.failed}</Alert>}
                <ul className="divide-y">
                    {query.data?.items.map(order => (
                        <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={order.id}>
                            <div className="min-w-0">
                                <p className="font-medium">
                                    #{order.number} ·{' '}
                                    {formatMinor(order.total, order.currency, language === 'bn')}
                                </p>
                                {/* Not on a customer's own page: it's always them. */}
                                {!customerId && (order.name || order.phone) && (
                                    <p className="text-sm break-words">
                                        {[order.name, order.phone && format.phone(order.phone)]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                )}
                                <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
                                    {[format.date(order.placedAt), wooStatusLabel(m, order.status)]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    {order.liveOrderId && <Badge tone="green">{m.convertedTag}</Badge>}
                                </p>
                            </div>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setSelected(order.id);
                                    setFrozen(false);
                                    setReduced(false);
                                    setLive('');
                                    setError('');
                                }}
                            >
                                {m.details}
                            </Button>
                        </li>
                    ))}
                </ul>
                {!query.data?.items.length && <p>{m.empty}</p>}
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        disabled={skip === 0}
                        onClick={() => setSkip(Math.max(0, skip - pageSize))}
                    >
                        {m.previous}
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={skip + pageSize >= (query.data?.totalItems ?? 0)}
                        onClick={() => setSkip(skip + pageSize)}
                    >
                        {m.next}
                    </Button>
                </div>
                {selected && detail.data && (
                    <div className="space-y-4 border-t pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-medium">
                                {m.snapshot} #{detail.data.number}
                            </h3>
                            <Button variant="ghost" onClick={() => setSelected('')}>
                                {m.close}
                            </Button>
                        </div>
                        <OrderSnapshot order={detail.data} />
                        {error && <Alert tone="warning">{error}</Alert>}
                        {/* Hiding this is a convenience: convertWooOpenOrder checks RunMigration itself. */}
                        {can('RunMigration') &&
                            !detail.data.liveOrderId &&
                            CONVERTIBLE.includes(detail.data.status) && (
                                <>
                                    <p>{m.conversionHint}</p>
                                    <label className="flex gap-2">
                                        <input
                                            type="checkbox"
                                            checked={frozen}
                                            onChange={e => setFrozen(e.target.checked)}
                                        />
                                        {m.frozen}
                                    </label>
                                    <label className="flex gap-2">
                                        <input
                                            type="checkbox"
                                            checked={reduced}
                                            onChange={e => setReduced(e.target.checked)}
                                        />
                                        {m.reduced}
                                    </label>
                                    <Button disabled={!frozen} loading={busy} onClick={() => void convert()}>
                                        {m.open}
                                    </Button>
                                </>
                            )}
                        {live && (
                            <Link className="underline" to={`/orders/${live}`}>
                                {m.converted} {m.active}
                            </Link>
                        )}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

/** One labelled value, as on the customer page. */
function Item({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="font-medium break-words">{children}</dd>
        </div>
    );
}

/**
 * An old order the way staff read an order: date, status, payment, items, charges, total, the
 * customer's note and the address. The whole imported record (notes, tax lines, meta) is still
 * there under "Technical details", for support.
 */
function OrderSnapshot({ order }: { order: Legacy }) {
    const { messages, language } = useI18n();
    const m = messages.migration;
    const format = useFormat();
    const s = order.snapshot ?? {};
    // Amounts in the snapshot are WooCommerce decimals in the order's own currency.
    const money = (minor: string | null) =>
        minor == null ? '—' : formatMinor(minor, order.currency, language === 'bn');
    const lines = Array.isArray(s.line_items)
        ? (s.line_items.filter(line => line && typeof line === 'object') as Array<Record<string, unknown>>)
        : [];
    const delivery = decimalToMinor(s.shipping_total);
    const discount = decimalToMinor(s.discount_total);
    const payment =
        s.payment_method === 'cod' ? m.cod : text(s.payment_method_title) || text(s.payment_method) || '—';
    const note = text(s.customer_note);
    // One address block when WooCommerce's delivery address is missing or the same as billing.
    const separateDelivery = !!addressLines(s.shipping) && !sameAddress(s.billing, s.shipping);
    return (
        <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Item label={m.placedAt}>{format.dateTime(order.placedAt) || '—'}</Item>
                <Item label={m.orderStatus}>{wooStatusLabel(m, order.status)}</Item>
                <Item label={m.payment}>{payment}</Item>
                {delivery != null && <Item label={m.deliveryCharge}>{money(delivery)}</Item>}
                {discount != null && discount !== '0' && <Item label={m.discount}>{money(discount)}</Item>}
                <Item label={m.total}>{money(order.total)}</Item>
                {order.refunded && order.refunded !== '0' && (
                    <Item label={m.refunded}>{money(order.refunded)}</Item>
                )}
            </dl>
            {lines.length > 0 && (
                <div className="text-sm">
                    <h4 className="font-medium">{m.items}</h4>
                    <ul className="divide-y divide-slate-100">
                        {lines.map((line, index) => (
                            <li key={String(line.id ?? index)} className="flex justify-between gap-3 py-1.5">
                                <span className="min-w-0 break-words">
                                    {text(line.name) || '—'}
                                    {typeof line.quantity === 'number' &&
                                        ` × ${messages.common.number(line.quantity)}`}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                    {money(decimalToMinor(line.total))}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {note && (
                <div className="text-sm">
                    <h4 className="font-medium">{m.customerNote}</h4>
                    <p className="break-words whitespace-pre-line">{note}</p>
                </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                <AddressBlock title={separateDelivery ? m.billingAddress : m.address} address={s.billing} />
                {separateDelivery && <AddressBlock title={m.deliveryAddress} address={s.shipping} />}
            </div>
            <TechnicalDetails data={order.snapshot} />
        </>
    );
}

/** A WooCommerce address as name, phone, address and district (nothing shown when it's empty). */
function AddressBlock({ title, address }: { title: string; address: unknown }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const lines = addressLines(address);
    if (!lines) return null;
    return (
        <div className="min-w-0 space-y-2 text-sm">
            <h4 className="font-medium">{title}</h4>
            <dl className="space-y-2">
                {lines.name && <Item label={m.name}>{lines.name}</Item>}
                {lines.phone && (
                    <Item label={m.phone}>
                        {/* Only a number we could read as Bangladeshi becomes a call link. */}
                        {lines.phone.e164 ? (
                            <a className="underline" href={`tel:${lines.phone.e164}`}>
                                {lines.phone.display}
                            </a>
                        ) : (
                            lines.phone.display
                        )}
                    </Item>
                )}
                {lines.address && <Item label={m.address}>{lines.address}</Item>}
                {lines.district && <Item label={m.district}>{lines.district}</Item>}
            </dl>
        </div>
    );
}
