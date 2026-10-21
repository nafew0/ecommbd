import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { DistrictThanaPicker } from '../address/district-thana-picker';
import { Field } from '../form/field';
import { TakaInput } from '../form/inputs';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Textarea } from '../ui/input';
import { Switch } from '../ui/switch';
import { type PickedVariant, ProductPicker } from './product-picker';

const EDIT = `
    mutation Edit($input: BdEditOrderInput!) {
        editBdOrder(input: $input) {
            ... on Order { id }
            ... on BdManualOrderError { reason message details }
        }
    }
`;

export interface EditableOrder {
    id: string;
    status: string;
    lines: Array<{
        id: string;
        quantity: number;
        linePriceWithTax: number;
        productVariant: { id: string; name: string };
    }>;
}

interface Line {
    orderLineId: string | null;
    variantId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    /** Set only when staff typed a new price. */
    newPrice: number | null;
}

/**
 * Edit an order before it ships (roadmap phase 05): quantities, products, prices, delivery charge,
 * discount and address. The server recalculates and points the COD amount at the new total.
 */
export function EditOrderDialog({
    order,
    open,
    onClose,
    onSaved,
}: {
    order: EditableOrder;
    open: boolean;
    onClose(): void;
    onSaved(): void;
}) {
    const { messages: m } = useI18n();
    const e = m.editOrder;
    const { can } = useAuth();
    const format = useFormat();
    const toast = useToast();
    const [lines, setLines] = useState<Line[]>([]);
    const [deliveryCharge, setDeliveryCharge] = useState<number | null | undefined>(undefined);
    const [discount, setDiscount] = useState<number | null | undefined>(undefined);
    const [changeAddress, setChangeAddress] = useState(false);
    const [place, setPlace] = useState({ districtId: '', thanaId: '' });
    const [street, setStreet] = useState('');
    const [area, setArea] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setLines(
            order.lines
                .filter(line => line.quantity > 0)
                .map(line => ({
                    orderLineId: line.id,
                    variantId: line.productVariant.id,
                    name: line.productVariant.name,
                    quantity: line.quantity,
                    unitPrice: Math.round(line.linePriceWithTax / line.quantity),
                    newPrice: null,
                })),
        );
        setDeliveryCharge(undefined);
        setDiscount(undefined);
        setChangeAddress(false);
        setNote('');
        setError(null);
    }, [open, order]);

    const add = (variant: PickedVariant) =>
        setLines(current =>
            current.some(line => line.variantId === variant.variantId)
                ? current.map(line =>
                      line.variantId === variant.variantId ? { ...line, quantity: line.quantity + 1 } : line,
                  )
                : [
                      ...current,
                      {
                          orderLineId: null,
                          variantId: variant.variantId,
                          name: variant.name,
                          quantity: 1,
                          unitPrice: variant.price,
                          newPrice: null,
                      },
                  ],
        );

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const input: Record<string, unknown> = {
                orderId: order.id,
                expectedStatus: order.status,
                lines: lines.map(line => ({
                    orderLineId: line.orderLineId,
                    variantId: line.orderLineId ? null : line.variantId,
                    quantity: line.quantity,
                    ...(line.newPrice !== null ? { unitPrice: line.newPrice } : {}),
                })),
                note: note || null,
            };
            if (deliveryCharge !== undefined) input.deliveryCharge = deliveryCharge;
            if (discount !== undefined) input.discount = discount ?? 0;
            if (changeAddress) {
                input.address = {
                    districtId: place.districtId,
                    thanaId: place.thanaId,
                    streetLine1: street,
                    area: area || null,
                };
            }
            const { editBdOrder } = await adminApi<{
                editBdOrder: { id: string } | { reason: string; message: string; details: string[] };
            }>(EDIT, { input });
            if ('id' in editBdOrder) {
                toast.success(e.saved);
                onSaved();
            } else {
                setError(
                    editBdOrder.details.length && editBdOrder.reason === 'INSUFFICIENT_STOCK'
                        ? `${editBdOrder.message} ${editBdOrder.details.join(', ')}`
                        : editBdOrder.message,
                );
            }
        } catch {
            setError(m.errors.generic);
        } finally {
            setBusy(false);
        }
    };

    const quantity = (value: string) =>
        Math.max(0, Math.min(1000, Number(banglaToAsciiDigits(value.trim())) || 0));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            dismissible={!busy}
            title={e.title}
            description={e.description}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        disabled={!lines.some(line => line.quantity > 0)}
                        onClick={() => void save()}
                    >
                        {e.save}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <ul className="divide-y divide-slate-100">
                    {lines.map((line, index) => (
                        <li
                            key={line.orderLineId ?? `new-${line.variantId}`}
                            className="flex flex-wrap items-end gap-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="font-medium">{line.name}</p>
                                <p className="text-sm text-slate-600">
                                    {format.money(line.newPrice ?? line.unitPrice)}
                                </p>
                            </div>
                            <Field label={e.quantity}>
                                {control => (
                                    <Input
                                        {...control}
                                        className="w-20"
                                        inputMode="numeric"
                                        value={String(line.quantity)}
                                        onChange={event =>
                                            setLines(
                                                lines.map((l, i) =>
                                                    i === index
                                                        ? { ...l, quantity: quantity(event.target.value) }
                                                        : l,
                                                ),
                                            )
                                        }
                                    />
                                )}
                            </Field>
                            {can('OverridePrice') && (
                                <Field label={e.price} optional>
                                    {control => (
                                        <TakaInput
                                            {...control}
                                            value={line.newPrice}
                                            onChange={value =>
                                                setLines(
                                                    lines.map((l, i) =>
                                                        i === index ? { ...l, newPrice: value } : l,
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
                                onClick={() =>
                                    setLines(lines.map((l, i) => (i === index ? { ...l, quantity: 0 } : l)))
                                }
                            >
                                <Trash2 className="size-4 text-red-700" aria-hidden />
                            </Button>
                        </li>
                    ))}
                </ul>
                <ProductPicker onPick={add} />
                <div className="grid gap-4 sm:grid-cols-2">
                    {can('OverridePrice') && (
                        <Field label={e.deliveryCharge} hint={e.deliveryChargeHint} optional>
                            {control => (
                                <TakaInput
                                    {...control}
                                    value={deliveryCharge ?? null}
                                    onChange={value => setDeliveryCharge(value)}
                                />
                            )}
                        </Field>
                    )}
                    {can('ApplyManualDiscount') && (
                        <Field label={e.discount} hint={e.discountHint} optional>
                            {control => (
                                <TakaInput
                                    {...control}
                                    value={discount ?? null}
                                    onChange={value => setDiscount(value)}
                                />
                            )}
                        </Field>
                    )}
                </div>
                <Switch label={e.changeAddress} checked={changeAddress} onChange={setChangeAddress} />
                {changeAddress && (
                    <div className="space-y-4">
                        <DistrictThanaPicker value={place} onChange={setPlace} />
                        <Field label={e.street}>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={255}
                                    value={street}
                                    onChange={event => setStreet(event.target.value)}
                                />
                            )}
                        </Field>
                        <Field label={e.area} optional>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={120}
                                    value={area}
                                    onChange={event => setArea(event.target.value)}
                                />
                            )}
                        </Field>
                    </div>
                )}
                <Field label={e.note} optional>
                    {control => (
                        <Textarea
                            {...control}
                            rows={2}
                            maxLength={500}
                            value={note}
                            onChange={event => setNote(event.target.value)}
                        />
                    )}
                </Field>
                {error && (
                    <p role="alert" className="text-sm text-red-700">
                        {error}
                    </p>
                )}
            </div>
        </Dialog>
    );
}
