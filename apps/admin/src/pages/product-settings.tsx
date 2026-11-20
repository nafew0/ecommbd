import {
    DEFAULT_UNITS,
    defaultProductSettings,
    type ProductSettings,
    type ShippingClass,
    type ProductUnit,
} from '@ecommbd/shared/product-settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { TakaInput } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Input } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

const UPDATE = `
    mutation UpdateProductSettings($input: JSON!) {
        updateBdProductSettings(input: $input) { settings errors { path code } }
    }
`;

/**
 * Product settings (phase 55): shipping classes first (they change the delivery charge), then
 * the shop's own units and the SKU prefix behind More.
 */
export function ProductSettingsPage() {
    const { messages: m, language } = useI18n();
    const s = m.productSettings;
    const { can } = useAuth();
    const format = useFormat();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateCatalog') || can('UpdateProduct');
    const query = useQuery({
        queryKey: ['productSettings'],
        queryFn: () =>
            adminApi<{ bdProductSettings: ProductSettings }>('{ bdProductSettings }').then(r => r.bdProductSettings),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<ProductSettings>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) load(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: ProductSettings) =>
            adminApi<{
                updateBdProductSettings: {
                    settings: ProductSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdProductSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                load(result.settings);
                toast.success(s.saved);
                void queryClient.invalidateQueries({ queryKey: ['productSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const nameOf = (item: { name: { bn: string; en: string } }) =>
        item.name[language] || item.name.bn || item.name.en;
    const setClass = (index: number, patch: Partial<ShippingClass>) =>
        setDraft({
            ...draft,
            shippingClasses: draft.shippingClasses.map((item, i) => (i === index ? { ...item, ...patch } : item)),
        });
    const setUnit = (index: number, patch: Partial<ProductUnit>) =>
        setDraft({
            ...draft,
            customUnits: draft.customUnits.map((item, i) => (i === index ? { ...item, ...patch } : item)),
        });
    const nameFields = (
        prefix: string,
        item: { name: { bn: string; en: string } },
        onChange: (name: { bn: string; en: string }) => void,
    ) =>
        (['bn', 'en'] as const).map(lang => (
            <Field
                key={lang}
                label={lang === 'bn' ? s.nameBn : s.nameEn}
                error={errors[`${prefix}.name.${lang}`]}
                optional={lang === 'en'}
            >
                {control => (
                    <Input
                        {...control}
                        maxLength={40}
                        value={item.name[lang]}
                        disabled={!canEdit}
                        onChange={event => onChange({ ...item.name, [lang]: event.target.value })}
                    />
                )}
            </Field>
        ));
    return (
        <Page width="narrow">
            <PageHeader title={s.title} description={s.description} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{m.settings.readOnly}</Alert>
                </div>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={s.classesTitle} description={s.classesHint} />
                    <CardBody>
                        {draft.shippingClasses.length === 0 && <p className="text-sm text-ink-muted">{s.noClasses}</p>}
                        {draft.shippingClasses.map((item, index) => (
                            <div
                                key={`${item.code}-${index}`}
                                className="grid items-end gap-3 border-b border-line pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_1fr_8rem_auto]"
                            >
                                {nameFields(`shippingClasses.${index}`, item, name => setClass(index, { name }))}
                                <Field label={s.charge} error={errors[`shippingClasses.${index}.charge`]}>
                                    {control => (
                                        <TakaInput
                                            {...control}
                                            value={item.charge}
                                            disabled={!canEdit}
                                            onChange={value => setClass(index, { charge: value ?? 0 })}
                                        />
                                    )}
                                </Field>
                                {canEdit && (
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        aria-label={s.remove(nameOf(item))}
                                        onClick={() =>
                                            setDraft({
                                                ...draft,
                                                shippingClasses: draft.shippingClasses.filter((_, i) => i !== index),
                                            })
                                        }
                                    >
                                        <X className="size-4" aria-hidden />
                                    </Button>
                                )}
                            </div>
                        ))}
                        {canEdit && (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        shippingClasses: [
                                            ...draft.shippingClasses,
                                            { code: '', name: { bn: '', en: '' }, charge: 0 },
                                        ],
                                    })
                                }
                            >
                                <Plus className="size-4" aria-hidden /> {s.addClass}
                            </Button>
                        )}
                    </CardBody>
                </Card>

                <CollapsibleCard
                    title={s.unitsTitle}
                    summary={s.unitsSummary(DEFAULT_UNITS.length + draft.customUnits.length)}
                    forceOpen={Object.keys(errors).some(key => key.startsWith('customUnits'))}
                >
                    <p className="text-sm text-ink-muted">
                        {s.builtIn}: {DEFAULT_UNITS.map(nameOf).join(', ')}
                    </p>
                    {draft.customUnits.map((unit, index) => (
                        <div
                            key={`${unit.code}-${index}`}
                            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                            {nameFields(`customUnits.${index}`, unit, name => setUnit(index, { name }))}
                            {canEdit && (
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label={s.remove(nameOf(unit))}
                                    onClick={() =>
                                        setDraft({
                                            ...draft,
                                            customUnits: draft.customUnits.filter((_, i) => i !== index),
                                        })
                                    }
                                >
                                    <X className="size-4" aria-hidden />
                                </Button>
                            )}
                        </div>
                    ))}
                    {canEdit && (
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                                setDraft({
                                    ...draft,
                                    customUnits: [...draft.customUnits, { code: '', name: { bn: '', en: '' } }],
                                })
                            }
                        >
                            <Plus className="size-4" aria-hidden /> {s.addUnit}
                        </Button>
                    )}
                </CollapsibleCard>

                <CollapsibleCard
                    title={s.skuTitle}
                    summary={s.skuExample(draft.skuPrefix || defaultProductSettings().skuPrefix)}
                    forceOpen={!!errors.skuPrefix}
                >
                    <Field label={s.skuPrefix} hint={s.skuHint} error={errors.skuPrefix}>
                        {control => (
                            <Input
                                {...control}
                                maxLength={6}
                                value={draft.skuPrefix}
                                disabled={!canEdit}
                                onChange={event => setDraft({ ...draft, skuPrefix: event.target.value.toUpperCase() })}
                            />
                        )}
                    </Field>
                </CollapsibleCard>
                {draft.shippingClasses.some(item => item.charge > 0) && (
                    <p className="text-sm text-ink-muted">
                        {s.classesExample(
                            nameOf(draft.shippingClasses.find(item => item.charge > 0)!),
                            format.money(draft.shippingClasses.find(item => item.charge > 0)!.charge),
                        )}
                    </p>
                )}
                {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={discard} />}
            </form>
        </Page>
    );
}
