import {
    SHIPPING_ZONES,
    type ShippingSettings,
    type ShippingZone,
    SUGGESTED_FREE_ABOVE,
} from '@ecommbd/shared/shipping';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DistrictThanaPicker, usePlaces } from '../components/address/district-thana-picker';
import { DistrictName, PlaceName } from '../components/address/place-name';
import { Field } from '../components/form/field';
import { TakaInput, useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdateShippingSettings($input: JSON!) {
        updateBdShippingSettings(input: $input) { settings errors { path code } }
    }
`;

const MISSING_WEIGHT = `{ bdProductsMissingWeight(take: 10) { totalItems items { variantId name sku } } }`;

interface MissingWeight {
    totalItems: number;
    items: Array<{ variantId: string; name: string; sku: string }>;
}

/** The zones the merchant prices separately; Chattogram city only when they choose to. */
const STANDARD_ZONES: ShippingZone[] = ['dhaka_city', 'dhaka_suburb', 'outside_dhaka'];

/** Delivery charges (roadmap phase 07), in merchant language: "Inside Dhaka ৳60". */
export function DeliverySettingsPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const format = useFormat();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateShippingMethod');
    const query = useQuery({
        queryKey: ['shippingSettings'],
        queryFn: () =>
            adminApi<{ bdShippingSettings: ShippingSettings }>('{ bdShippingSettings }').then(
                r => r.bdShippingSettings,
            ),
    });
    const [draft, setDraft] = useState<ShippingSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const missingWeight = useQuery({
        queryKey: ['productsMissingWeight'],
        enabled: Boolean(draft?.weight.enabled) && can('ReadProduct'),
        queryFn: () =>
            adminApi<{ bdProductsMissingWeight: MissingWeight }>(MISSING_WEIGHT).then(
                r => r.bdProductsMissingWeight,
            ),
    });
    const save = useMutation({
        mutationFn: (input: ShippingSettings) =>
            adminApi<{
                updateBdShippingSettings: {
                    settings: ShippingSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdShippingSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(m.delivery.saved);
                void queryClient.invalidateQueries({ queryKey: ['shippingSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const d = m.delivery;
    const zoneName = (zone: ShippingZone) => d.zones[zone];
    const set = (patch: Partial<ShippingSettings>) => setDraft({ ...draft, ...patch });
    const number = (value: string) => Number(banglaToAsciiDigits(value.trim()) || 0);
    const pricedZones: ShippingZone[] = draft.standard.chattogramCityRate
        ? [...STANDARD_ZONES.slice(0, 2), 'chattogram_city', 'outside_dhaka']
        : STANDARD_ZONES;

    return (
        <>
            <PageHeader title={d.title} description={d.description} />
            <div className="mb-4 space-y-3">
                {!canEdit && <Alert>{d.readOnly}</Alert>}
                {!draft.confirmed && canEdit && <Alert tone="warning">{d.suggested}</Alert>}
            </div>
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={d.charges} description={d.chargesHint} />
                    <CardBody>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {pricedZones.map(zone => (
                                <Field
                                    key={zone}
                                    label={zoneName(zone)}
                                    hint={zone === 'dhaka_suburb' ? d.suburbHint : undefined}
                                    error={errors[`standard.rates.${zone}`]}
                                >
                                    {control => (
                                        <TakaInput
                                            {...control}
                                            value={draft.standard.rates[zone]}
                                            disabled={!canEdit}
                                            onChange={value =>
                                                set({
                                                    standard: {
                                                        ...draft.standard,
                                                        rates: {
                                                            ...draft.standard.rates,
                                                            [zone]: value ?? 0,
                                                        },
                                                    },
                                                })
                                            }
                                        />
                                    )}
                                </Field>
                            ))}
                        </div>
                        <Switch
                            label={d.chattogramCity}
                            description={d.chattogramCityHint}
                            checked={draft.standard.chattogramCityRate}
                            disabled={!canEdit}
                            onChange={checked =>
                                set({ standard: { ...draft.standard, chattogramCityRate: checked } })
                            }
                        />
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={d.free} description={d.freeHint} />
                    <CardBody>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {pricedZones.map(zone => {
                                const threshold = draft.freeAbove[zone];
                                return (
                                    <div key={zone} className="space-y-2">
                                        <Switch
                                            label={d.freeIn(zoneName(zone))}
                                            checked={threshold !== null}
                                            disabled={!canEdit}
                                            onChange={checked =>
                                                set({
                                                    freeAbove: {
                                                        ...draft.freeAbove,
                                                        [zone]: checked ? SUGGESTED_FREE_ABOVE : null,
                                                    },
                                                })
                                            }
                                        />
                                        {threshold !== null && (
                                            <Field label={d.freeAbove} error={errors[`freeAbove.${zone}`]}>
                                                {control => (
                                                    <TakaInput
                                                        {...control}
                                                        value={threshold}
                                                        disabled={!canEdit}
                                                        onChange={value =>
                                                            set({
                                                                freeAbove: {
                                                                    ...draft.freeAbove,
                                                                    [zone]: value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={d.methods} />
                    <CardBody>
                        <Switch
                            label={d.express}
                            description={d.expressHint}
                            checked={draft.express.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ express: { ...draft.express, enabled: checked } })}
                        />
                        {draft.express.enabled && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                {pricedZones.map(zone => (
                                    <Field
                                        key={zone}
                                        label={d.expressIn(zoneName(zone))}
                                        hint={d.expressBlank}
                                        error={errors[`express.rates.${zone}`]}
                                        optional
                                    >
                                        {control => (
                                            <TakaInput
                                                {...control}
                                                value={draft.express.rates[zone]}
                                                disabled={!canEdit}
                                                onChange={value =>
                                                    set({
                                                        express: {
                                                            ...draft.express,
                                                            rates: { ...draft.express.rates, [zone]: value },
                                                        },
                                                    })
                                                }
                                            />
                                        )}
                                    </Field>
                                ))}
                            </div>
                        )}
                        <Switch
                            label={d.pickup}
                            description={d.pickupHint}
                            checked={draft.pickup.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ pickup: { enabled: checked } })}
                        />
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={d.weight} />
                    <CardBody>
                        <Switch
                            label={d.weightOn}
                            description={d.weightHint}
                            checked={draft.weight.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ weight: { ...draft.weight, enabled: checked } })}
                        />
                        {draft.weight.enabled && (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field label={d.includedGrams} error={errors['weight.includedGrams']}>
                                        {control => (
                                            <Input
                                                {...control}
                                                inputMode="numeric"
                                                value={digits(draft.weight.includedGrams)}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    set({
                                                        weight: {
                                                            ...draft.weight,
                                                            includedGrams: number(event.target.value),
                                                        },
                                                    })
                                                }
                                            />
                                        )}
                                    </Field>
                                    <Field label={d.perKg} error={errors['weight.perKg']}>
                                        {control => (
                                            <TakaInput
                                                {...control}
                                                value={draft.weight.perKg}
                                                disabled={!canEdit}
                                                onChange={value =>
                                                    set({ weight: { ...draft.weight, perKg: value ?? 0 } })
                                                }
                                            />
                                        )}
                                    </Field>
                                </div>
                                {missingWeight.data && missingWeight.data.totalItems > 0 && (
                                    <Alert tone="warning">
                                        <p>{d.missingWeight(missingWeight.data.totalItems)}</p>
                                        <ul className="mt-2 list-disc pl-5">
                                            {missingWeight.data.items.map(item => (
                                                <li key={item.variantId}>
                                                    {item.name}{' '}
                                                    <span className="text-amber-700">({item.sku})</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </Alert>
                                )}
                            </>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={d.codFee} />
                    <CardBody>
                        <Switch
                            label={d.codFeeOn}
                            description={d.codFeeHint}
                            checked={draft.codFee.enabled}
                            disabled={!canEdit}
                            onChange={checked => set({ codFee: { ...draft.codFee, enabled: checked } })}
                        />
                        {draft.codFee.enabled && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={d.codFeeType}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={draft.codFee.type}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                set({
                                                    codFee: {
                                                        ...draft.codFee,
                                                        type: event.target.value as 'flat' | 'percent',
                                                    },
                                                })
                                            }
                                        >
                                            <option value="flat">{d.codFeeFlat}</option>
                                            <option value="percent">{d.codFeePercent}</option>
                                        </Select>
                                    )}
                                </Field>
                                {draft.codFee.type === 'flat' ? (
                                    <Field label={d.codFeeAmount} error={errors['codFee.flat']}>
                                        {control => (
                                            <TakaInput
                                                {...control}
                                                value={draft.codFee.flat}
                                                disabled={!canEdit}
                                                onChange={value =>
                                                    set({ codFee: { ...draft.codFee, flat: value ?? 0 } })
                                                }
                                            />
                                        )}
                                    </Field>
                                ) : (
                                    <Field
                                        label={d.codFeePercentOf}
                                        hint={d.codFeeExample(format.money(1350_00), format.money(14_00))}
                                        error={errors['codFee.percent']}
                                    >
                                        {control => (
                                            <Input
                                                {...control}
                                                inputMode="decimal"
                                                value={digits(draft.codFee.percent)}
                                                disabled={!canEdit}
                                                onChange={event =>
                                                    set({
                                                        codFee: {
                                                            ...draft.codFee,
                                                            percent: Number(
                                                                banglaToAsciiDigits(
                                                                    event.target.value.trim(),
                                                                ) || 0,
                                                            ),
                                                        },
                                                    })
                                                }
                                            />
                                        )}
                                    </Field>
                                )}
                            </div>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={d.coverage} />
                    <CardBody>
                        <fieldset>
                            <legend className="mb-2 text-sm font-medium">{d.coverageZones}</legend>
                            <div className="flex flex-wrap gap-x-6 gap-y-2">
                                {SHIPPING_ZONES.map(zone => (
                                    <label key={zone} className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            className="size-4"
                                            checked={draft.coverage.zones.includes(zone)}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                set({
                                                    coverage: {
                                                        ...draft.coverage,
                                                        zones: event.target.checked
                                                            ? [...draft.coverage.zones, zone]
                                                            : draft.coverage.zones.filter(z => z !== zone),
                                                    },
                                                })
                                            }
                                        />
                                        {zoneName(zone)}
                                    </label>
                                ))}
                            </div>
                            {errors['coverage.zones'] && (
                                <p className="mt-1 text-sm text-red-700">{d.coverageZonesRequired}</p>
                            )}
                        </fieldset>
                        <CoverageDistricts
                            value={draft.coverage.districtIds}
                            disabled={!canEdit}
                            onChange={districtIds => set({ coverage: { ...draft.coverage, districtIds } })}
                        />
                        <Field
                            label={d.maxWeight}
                            hint={d.maxWeightHint}
                            error={errors['coverage.maxWeightGrams']}
                            optional
                        >
                            {control => (
                                <Input
                                    {...control}
                                    inputMode="numeric"
                                    className="w-40"
                                    value={
                                        draft.coverage.maxWeightGrams === null
                                            ? ''
                                            : digits(draft.coverage.maxWeightGrams)
                                    }
                                    disabled={!canEdit}
                                    onChange={event => {
                                        const text = event.target.value.trim();
                                        set({
                                            coverage: {
                                                ...draft.coverage,
                                                maxWeightGrams: text ? number(text) : null,
                                            },
                                        });
                                    }}
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>

                <details className="rounded-lg border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-3 font-medium">{d.overrides}</summary>
                    <div className="space-y-4 border-t border-slate-200 p-4">
                        <p className="text-sm text-slate-600">{d.overridesHint}</p>
                        <Overrides
                            value={draft.overrides}
                            errors={errors}
                            disabled={!canEdit}
                            onChange={overrides => set({ overrides })}
                        />
                    </div>
                </details>

                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>
        </>
    );
}

type Override = ShippingSettings['overrides'][number];

/** District and thana rates: pick a place, type its charge, add. */
function Overrides({
    value,
    errors,
    disabled,
    onChange,
}: {
    value: Override[];
    errors: Record<string, string>;
    disabled: boolean;
    onChange(value: Override[]): void;
}) {
    const { messages: m } = useI18n();
    const d = m.delivery;
    const format = useFormat();
    const [place, setPlace] = useState({ districtId: '', thanaId: '' });
    const [rate, setRate] = useState<number | null>(null);
    const add = () => {
        if (!place.districtId || rate === null) return;
        const override: Override = place.thanaId
            ? { kind: 'thana', id: place.thanaId, rate }
            : { kind: 'district', id: place.districtId, rate };
        onChange([
            ...value.filter(existing => !(existing.kind === override.kind && existing.id === override.id)),
            override,
        ]);
        setPlace({ districtId: '', thanaId: '' });
        setRate(null);
    };
    return (
        <>
            {value.length > 0 && (
                <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                    {value.map((override, index) => (
                        <li
                            key={`${override.kind}:${override.id}`}
                            className="flex items-center gap-3 px-3 py-2"
                        >
                            <span className="min-w-0 flex-1">
                                {override.kind === 'district' ? (
                                    <DistrictName districtId={override.id} />
                                ) : (
                                    <ThanaLabel thanaId={override.id} />
                                )}
                                {errors[`overrides.${index}.id`] && (
                                    <span className="ml-2 text-sm text-red-700">{d.unknownPlace}</span>
                                )}
                            </span>
                            <span className="font-medium">{format.money(override.rate)}</span>
                            {!disabled && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={m.common.remove}
                                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                                >
                                    <Trash2 className="size-4" aria-hidden />
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {!disabled && (
                <div className="space-y-3">
                    <DistrictThanaPicker value={place} onChange={setPlace} allowOther={false} />
                    <p className="text-sm text-slate-600">{d.overrideThanaHint}</p>
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label={d.overrideRate}>
                            {control => <TakaInput {...control} value={rate} onChange={setRate} />}
                        </Field>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={!place.districtId || rate === null}
                            onClick={add}
                        >
                            {d.addOverride}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}

/** A thana's name with its district: the thana ID starts with the district's (BD3026M26 → BD3026). */
function ThanaLabel({ thanaId }: { thanaId: string }) {
    return <PlaceName districtId={thanaId.slice(0, 6)} thanaId={thanaId} />;
}

/** "Only these districts": empty means every district in the chosen zones. */
function CoverageDistricts({
    value,
    disabled,
    onChange,
}: {
    value: string[];
    disabled: boolean;
    onChange(value: string[]): void;
}) {
    const { messages: m } = useI18n();
    const d = m.delivery;
    const { districts } = usePlaces('');
    const nameOf = (id: string) => districts.data?.find(district => district.id === id)?.name ?? id;
    return (
        <Field label={d.coverageDistricts} hint={d.coverageDistrictsHint} optional>
            {control => (
                <div className="space-y-2">
                    {value.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                            {value.map(id => (
                                <li
                                    key={id}
                                    className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm"
                                >
                                    {nameOf(id)}
                                    {!disabled && (
                                        <button
                                            type="button"
                                            className="rounded-full p-1 hover:bg-slate-200"
                                            aria-label={`${m.common.remove}: ${nameOf(id)}`}
                                            onClick={() => onChange(value.filter(other => other !== id))}
                                        >
                                            <Trash2 className="size-3.5" aria-hidden />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {!disabled && (
                        <Select
                            {...control}
                            value=""
                            onChange={event => {
                                if (event.target.value) onChange([...value, event.target.value]);
                            }}
                        >
                            <option value="">{d.addDistrict}</option>
                            {districts.data
                                ?.filter(district => !value.includes(district.id))
                                .map(district => (
                                    <option key={district.id} value={district.id}>
                                        {district.name}
                                    </option>
                                ))}
                        </Select>
                    )}
                </div>
            )}
        </Field>
    );
}
