import {
    MANUAL_PAYMENT_METHODS,
    MANUAL_PAYMENT_TYPES,
    type ManualPaymentMethod,
    type ManualPaymentType,
    ORDER_SOURCES,
    type OrderSource,
} from '@ecommbd/shared/manual-orders';
import { parseBdMobile } from '@ecommbd/shared/phone';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DistrictThanaPicker, OTHER_THANA } from '../components/address/district-thana-picker';
import { Field } from '../components/form/field';
import { PhoneInput, TakaInput } from '../components/form/inputs';
import { type PickedVariant, ProductPicker } from '../components/orders/product-picker';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';

const QUOTE = `
    query Quote($input: BdManualOrderInput!) {
        bdManualOrderQuote(input: $input) {
            ... on BdManualOrderQuote { subTotal delivery discount codFee total paidNow codDue shippingMethodId deliveryOptions { id name price } }
            ... on BdManualOrderError { reason message details }
        }
    }
`;
const CREATE = `
    mutation Create($input: BdManualOrderInput!) {
        createBdManualOrder(input: $input) {
            ... on Order { id }
            ... on BdManualOrderError { reason message details }
        }
    }
`;
const FROM_INCOMPLETE = `
    query FromIncomplete($id: ID!) {
        bdIncompleteCheckout(id: $id) { phone name districtId thanaId cart { variantId name quantity } }
    }
`;
const FIND_VARIANT = `
    query FindVariant($search: String) { bdStock(search: $search, take: 20) { variantId name sku preview available price backorder } }
`;
const FIND_CUSTOMER = `
    query Find($search: String) { bdCustomers(search: $search, take: 1) { items { firstName customFields { phone alternatePhone } } } }
`;

interface Line {
    variant: PickedVariant;
    quantity: number;
    unitPrice: number | null;
}

interface Quote {
    subTotal: number;
    delivery: number;
    discount: number;
    codFee: number;
    total: number;
    paidNow: number;
    codDue: number;
    shippingMethodId: string | null;
    deliveryOptions: Array<{ id: string; name: string; price: number }>;
}

type QuoteResult = Quote | { reason: string; message: string; details: string[] };

/**
 * A phone, Messenger or WhatsApp order (roadmap phase 05): customer by phone, address, products,
 * delivery, discount and payment, with the totals worked out by the server as staff type.
 */
export function PhoneOrderPage() {
    const { messages: m } = useI18n();
    const o = m.phoneOrder;
    const { can } = useAuth();
    const format = useFormat();
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [alternatePhone, setAlternatePhone] = useState('');
    const [place, setPlace] = useState({ districtId: '', thanaId: '' });
    const [area, setArea] = useState('');
    const [street, setStreet] = useState('');
    const [landmark, setLandmark] = useState('');
    const [saveAddress, setSaveAddress] = useState(false);
    const [lines, setLines] = useState<Line[]>([]);
    const [discount, setDiscount] = useState<number | null>(null);
    const [deliveryCharge, setDeliveryCharge] = useState<number | null>(null);
    const [shippingMethodId, setShippingMethodId] = useState('');
    const [paymentType, setPaymentType] = useState<ManualPaymentType>('cod');
    const [method, setMethod] = useState<ManualPaymentMethod>('bkash');
    const [transactionId, setTransactionId] = useState('');
    const [advance, setAdvance] = useState<number | null>(null);
    const [source, setSource] = useState<OrderSource>('messenger');
    const [note, setNote] = useState('');
    const [sendSms, setSendSms] = useState(true);
    const [confirm, setConfirm] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // "Make an order" from Incomplete orders (phase 11): fill in what the shopper typed.
    const [searchParams] = useSearchParams();
    const incompleteId = searchParams.get('incomplete');
    const fromIncomplete = useQuery({
        queryKey: ['phoneOrderFromIncomplete', incompleteId],
        enabled: !!incompleteId,
        staleTime: Infinity,
        queryFn: async () => {
            const { bdIncompleteCheckout: record } = await adminApi<{
                bdIncompleteCheckout: {
                    phone: string | null;
                    name: string | null;
                    districtId: string | null;
                    thanaId: string | null;
                    cart: Array<{ variantId: string; name: string; quantity: number }> | null;
                } | null;
            }>(FROM_INCOMPLETE, { id: incompleteId });
            if (!record) return null;
            const found: Line[] = [];
            const unavailable: string[] = [];
            for (const line of record.cart ?? []) {
                const { bdStock } = await adminApi<{ bdStock: PickedVariant[] }>(FIND_VARIANT, { search: line.name });
                const variant = bdStock.find(candidate => candidate.variantId === line.variantId);
                if (variant && (variant.available > 0 || variant.backorder)) {
                    found.push({ variant, quantity: line.quantity, unitPrice: null });
                } else {
                    unavailable.push(line.name);
                }
            }
            setPhone(current => current || record.phone || '');
            setName(current => current || record.name || '');
            setPlace(current =>
                current.districtId ? current : { districtId: record.districtId ?? '', thanaId: record.thanaId ?? '' },
            );
            setLines(current => (current.length ? current : found));
            setSource('phone');
            return { unavailable };
        },
    });
    const e164 = useMemo(() => {
        const parsed = parseBdMobile(phone);
        return parsed.ok ? parsed.phone.e164 : null;
    }, [phone]);
    // A known phone fills the name, as phase 03 keys customers by phone.
    useQuery({
        queryKey: ['phoneOrderCustomer', e164],
        enabled: !!e164,
        queryFn: async () => {
            const { bdCustomers } = await adminApi<{
                bdCustomers: {
                    items: Array<{
                        firstName: string;
                        customFields: { phone: string; alternatePhone: string | null };
                    }>;
                };
            }>(FIND_CUSTOMER, { search: e164 });
            const found = bdCustomers.items.find(item => item.customFields.phone === e164);
            if (found) {
                setName(current => current || found.firstName);
                setAlternatePhone(current => current || found.customFields.alternatePhone || '');
            }
            return found ?? null;
        },
    });

    const input = {
        customer: { name, phone, alternatePhone: alternatePhone || null },
        address: {
            districtId: place.districtId,
            thanaId: place.thanaId,
            area: area || null,
            streetLine1: street,
            landmark: landmark || null,
        },
        saveAddress,
        lines: lines.map(line => ({
            variantId: line.variant.variantId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
        })),
        discount: discount || null,
        deliveryCharge,
        shippingMethodId: shippingMethodId || null,
        payment: {
            type: paymentType,
            method: paymentType === 'cod' ? null : method,
            transactionId: transactionId || null,
            amount: paymentType === 'advance' ? advance : null,
        },
        source,
        note: note || null,
        sendSms,
        confirm,
    };
    const quoteInput = useDebounced(JSON.stringify(input), 400);
    const ready = lines.length > 0 && place.districtId && place.thanaId && street.trim();
    const quote = useQuery({
        queryKey: ['manualOrderQuote', quoteInput],
        enabled: !!ready,
        queryFn: () =>
            adminApi<{ bdManualOrderQuote: QuoteResult }>(QUOTE, { input: JSON.parse(quoteInput) }).then(
                r => r.bdManualOrderQuote,
            ),
    });
    const totals = quote.data && 'total' in quote.data ? quote.data : null;
    const quoteError = quote.data && 'reason' in quote.data ? quote.data.message : null;

    const add = (variant: PickedVariant) =>
        setLines(current => {
            const existing = current.find(line => line.variant.variantId === variant.variantId);
            return existing
                ? current.map(line => (line === existing ? { ...line, quantity: line.quantity + 1 } : line))
                : [...current, { variant, quantity: 1, unitPrice: null }];
        });
    const quantity = (value: string) =>
        Math.max(1, Math.min(1000, Number(banglaToAsciiDigits(value.trim())) || 1));

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            const { createBdManualOrder } = await adminApi<{
                createBdManualOrder: { id: string } | { reason: string; message: string; details: string[] };
            }>(CREATE, { input });
            if ('id' in createBdManualOrder) {
                toast.success(o.created);
                void queryClient.invalidateQueries({ queryKey: ['orders'] });
                navigate(`/orders/${createBdManualOrder.id}`);
            } else {
                const details = createBdManualOrder.details.filter(Boolean).join(', ');
                setError(
                    details ? `${createBdManualOrder.message} (${details})` : createBdManualOrder.message,
                );
            }
        } catch {
            setError(m.errors.generic);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PageHeader title={o.title} description={o.description} />
            {fromIncomplete.data && (
                <div className="mb-4 space-y-2">
                    <Alert>{o.fromIncomplete}</Alert>
                    {fromIncomplete.data.unavailable.length > 0 && (
                        <Alert tone="warning">{o.unavailable(fromIncomplete.data.unavailable.join(', '))}</Alert>
                    )}
                </div>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    <Card>
                        <CardHeader title={o.customer} />
                        <CardBody>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={o.phone}>
                                    {control => (
                                        <PhoneInput
                                            {...control}
                                            autoFocus
                                            value={phone}
                                            onChange={setPhone}
                                        />
                                    )}
                                </Field>
                                <Field label={o.name}>
                                    {control => (
                                        <Input
                                            {...control}
                                            maxLength={100}
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                        />
                                    )}
                                </Field>
                                <Field label={o.alternatePhone} optional>
                                    {control => (
                                        <PhoneInput
                                            {...control}
                                            value={alternatePhone}
                                            onChange={setAlternatePhone}
                                        />
                                    )}
                                </Field>
                            </div>
                            <DistrictThanaPicker value={place} onChange={setPlace} />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={o.street}>
                                    {control => (
                                        <Input
                                            {...control}
                                            maxLength={255}
                                            value={street}
                                            onChange={e => setStreet(e.target.value)}
                                        />
                                    )}
                                </Field>
                                <Field label={o.area} optional={place.thanaId !== OTHER_THANA}>
                                    {control => (
                                        <Input
                                            {...control}
                                            maxLength={120}
                                            value={area}
                                            onChange={e => setArea(e.target.value)}
                                        />
                                    )}
                                </Field>
                                <Field label={o.landmark} optional>
                                    {control => (
                                        <Input
                                            {...control}
                                            maxLength={120}
                                            value={landmark}
                                            onChange={e => setLandmark(e.target.value)}
                                        />
                                    )}
                                </Field>
                            </div>
                            <Switch
                                label={o.saveAddress}
                                description={o.saveAddressHint}
                                checked={saveAddress}
                                onChange={setSaveAddress}
                            />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title={o.products} />
                        <CardBody>
                            <ProductPicker onPick={add} />
                            {lines.length > 0 && (
                                <ul className="divide-y divide-slate-100">
                                    {lines.map((line, index) => (
                                        <li
                                            key={line.variant.variantId}
                                            className="flex flex-wrap items-end gap-3 py-3"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium">{line.variant.name}</p>
                                                <p className="text-sm text-slate-600">
                                                    {format.money(line.variant.price)}
                                                </p>
                                            </div>
                                            <Field label={o.quantity}>
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        className="w-20"
                                                        inputMode="numeric"
                                                        value={String(line.quantity)}
                                                        onChange={e =>
                                                            setLines(
                                                                lines.map((l, i) =>
                                                                    i === index
                                                                        ? {
                                                                              ...l,
                                                                              quantity: quantity(
                                                                                  e.target.value,
                                                                              ),
                                                                          }
                                                                        : l,
                                                                ),
                                                            )
                                                        }
                                                    />
                                                )}
                                            </Field>
                                            {can('OverridePrice') && (
                                                <Field label={o.unitPrice} optional>
                                                    {control => (
                                                        <TakaInput
                                                            {...control}
                                                            value={line.unitPrice}
                                                            onChange={value =>
                                                                setLines(
                                                                    lines.map((l, i) =>
                                                                        i === index
                                                                            ? { ...l, unitPrice: value }
                                                                            : l,
                                                                    ),
                                                                )
                                                            }
                                                        />
                                                    )}
                                                </Field>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                aria-label={m.common.remove}
                                                onClick={() => setLines(lines.filter((_, i) => i !== index))}
                                            >
                                                <Trash2 className="size-4 text-red-700" aria-hidden />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title={o.deliveryPayment} />
                        <CardBody>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {totals && totals.deliveryOptions.length > 1 && (
                                    <Field label={o.deliveryMethod}>
                                        {control => (
                                            <Select
                                                {...control}
                                                value={shippingMethodId || totals.shippingMethodId || ''}
                                                onChange={e => setShippingMethodId(e.target.value)}
                                            >
                                                {totals.deliveryOptions.map(option => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name} · {format.money(option.price)}
                                                    </option>
                                                ))}
                                            </Select>
                                        )}
                                    </Field>
                                )}
                                {can('OverridePrice') && (
                                    <Field label={o.deliveryCharge} hint={o.deliveryChargeHint} optional>
                                        {control => (
                                            <TakaInput
                                                {...control}
                                                value={deliveryCharge}
                                                onChange={setDeliveryCharge}
                                            />
                                        )}
                                    </Field>
                                )}
                                {can('ApplyManualDiscount') && (
                                    <Field
                                        label={o.discount}
                                        hint={can('UnlimitedDiscount') ? undefined : o.discountHint}
                                        optional
                                    >
                                        {control => (
                                            <TakaInput {...control} value={discount} onChange={setDiscount} />
                                        )}
                                    </Field>
                                )}
                                <Field label={o.paymentType}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={paymentType}
                                            onChange={e =>
                                                setPaymentType(e.target.value as ManualPaymentType)
                                            }
                                        >
                                            {MANUAL_PAYMENT_TYPES.map(type => (
                                                <option key={type} value={type}>
                                                    {o.paymentTypes[type]}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                                {paymentType !== 'cod' && (
                                    <>
                                        <Field label={o.paidBy}>
                                            {control => (
                                                <Select
                                                    {...control}
                                                    value={method}
                                                    onChange={e =>
                                                        setMethod(e.target.value as ManualPaymentMethod)
                                                    }
                                                >
                                                    {MANUAL_PAYMENT_METHODS.map(code => (
                                                        <option key={code} value={code}>
                                                            {m.payments.refundMethods[code]}
                                                        </option>
                                                    ))}
                                                </Select>
                                            )}
                                        </Field>
                                        <Field
                                            label={o.transactionId}
                                            optional={method === 'cash' || method === 'bank'}
                                        >
                                            {control => (
                                                <Input
                                                    {...control}
                                                    maxLength={40}
                                                    value={transactionId}
                                                    onChange={e => setTransactionId(e.target.value)}
                                                />
                                            )}
                                        </Field>
                                    </>
                                )}
                                {paymentType === 'advance' && (
                                    <Field label={o.advanceAmount}>
                                        {control => (
                                            <TakaInput {...control} value={advance} onChange={setAdvance} />
                                        )}
                                    </Field>
                                )}
                                <Field label={o.source}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={source}
                                            onChange={e => setSource(e.target.value as OrderSource)}
                                        >
                                            {ORDER_SOURCES.map(code => (
                                                <option key={code} value={code}>
                                                    {o.sources[code]}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </Field>
                            </div>
                            <Field label={o.note} optional>
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
                            <div className="flex flex-wrap gap-x-8 gap-y-3">
                                <Switch
                                    label={o.confirm}
                                    description={o.confirmHint}
                                    checked={confirm}
                                    onChange={setConfirm}
                                />
                                <Switch label={o.sendSms} checked={sendSms} onChange={setSendSms} />
                            </div>
                        </CardBody>
                    </Card>
                </div>

                <div className="lg:sticky lg:top-4 lg:self-start">
                    <Card>
                        <CardHeader title={o.summary} />
                        <CardBody>
                            {!ready && <p className="text-sm text-slate-600">{o.summaryEmpty}</p>}
                            {quoteError && <Alert tone="warning">{quoteError}</Alert>}
                            {totals && (
                                <dl className="space-y-1 text-sm">
                                    <Row label={o.subtotal}>
                                        {format.money(totals.subTotal + totals.discount)}
                                    </Row>
                                    {totals.discount > 0 && (
                                        <Row label={o.discount}>-{format.money(totals.discount)}</Row>
                                    )}
                                    <Row label={o.delivery}>{format.money(totals.delivery)}</Row>
                                    {totals.codFee > 0 && (
                                        <Row label={m.payments.order.codFee}>
                                            {format.money(totals.codFee)}
                                        </Row>
                                    )}
                                    <Row label={o.total} strong>
                                        {format.money(totals.total)}
                                    </Row>
                                    {totals.paidNow > 0 && (
                                        <Row label={o.paidNow}>{format.money(totals.paidNow)}</Row>
                                    )}
                                    <div className="mt-2 rounded-md bg-amber-50 px-3 py-2">
                                        <p className="text-amber-900">{m.orders.codDue}</p>
                                        <p className="text-xl font-semibold tabular-nums text-amber-950">
                                            {format.money(totals.codDue)}
                                        </p>
                                    </div>
                                </dl>
                            )}
                            {error && <Alert tone="error">{error}</Alert>}
                            <Button
                                className="w-full"
                                loading={busy}
                                disabled={!ready || !e164 || !name.trim()}
                                onClick={() => void submit()}
                            >
                                {o.create}
                            </Button>
                        </CardBody>
                    </Card>
                </div>
            </div>
        </>
    );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
    return (
        <div
            className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-1 text-base font-semibold' : ''}`}
        >
            <dt>{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    );
}
