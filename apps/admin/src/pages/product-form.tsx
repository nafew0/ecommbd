import {
    emptyProductForm,
    emptyVariant,
    type ProductForm,
    type ProductFormVariant,
    VARIATION_TYPES,
    type VariationType,
} from '@ecommbd/shared/catalog';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { ImageUpload } from '../components/form/image-upload';
import { TakaInput, useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/input';
import { CollapsibleCard, MoreFields } from '../components/ui/disclosure';
import { Page, TwoColumn } from '../components/ui/layout';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const FORM = `query ProductForm($id: ID!) { bdProductForm(id: $id) }`;
const SAVE = `
    mutation SaveProduct($input: JSON!) {
        saveBdProduct(input: $input) { product errors { path code } }
    }
`;
const CATEGORIES = `{ bdCategories { id name { bn en } } }`;
const PREVIEWS = `
    query Previews($ids: [String!]!) {
        assets(options: { filter: { id: { in: $ids } }, take: 100 }) { items { id preview } }
    }
`;

interface Category {
    id: string;
    name: { bn: string; en: string };
}

/** Previews for the asset IDs in the form (the form itself only keeps IDs). */
function usePreviews(ids: string[], extra: Record<string, string>) {
    const query = useQuery({
        queryKey: ['assetPreviews', [...ids].sort().join(',')],
        enabled: ids.length > 0,
        queryFn: () =>
            adminApi<{ assets: { items: Array<{ id: string; preview: string }> } }>(PREVIEWS, { ids }).then(
                r => Object.fromEntries(r.assets.items.map(asset => [asset.id, asset.preview])),
            ),
        staleTime: Infinity,
    });
    return (id: string | null) => (id ? (extra[id] ?? query.data?.[id] ?? null) : null);
}

/**
 * The one-page product form (roadmap phase 05, fields from docs/research/reference-bd-admin.md):
 * names in Bangla and English, images, price and stock, category, delivery for this product and
 * variations, with SKU, weight and SEO tucked under "More".
 */
export function ProductFormPage() {
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const { messages: m, language } = useI18n();
    const f = m.productForm;
    const { can } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const digits = useDigits();
    const canEdit = can(isNew ? 'CreateProduct' : 'UpdateProduct') || can('UpdateCatalog');
    const loaded = useQuery({
        queryKey: ['productForm', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdProductForm: ProductForm | null }>(FORM, { id }).then(r => r.bdProductForm),
    });
    const categories = useQuery({
        queryKey: ['categories'],
        queryFn: () => adminApi<{ bdCategories: Category[] }>(CATEGORIES).then(r => r.bdCategories),
    });
    const [draft, setDraftState] = useState<ProductForm | null>(isNew ? emptyProductForm() : null);
    // What was last loaded or saved: the save bar shows when the form differs from it.
    const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
    const setDraft = (next: ProductForm) => setDraftState(next);
    const load = (next: ProductForm) => {
        setDraftState(next);
        setBaseline(JSON.stringify(next));
    };
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [uploaded, setUploaded] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!isNew && loaded.data && !draft) load(loaded.data);
    }, [isNew, loaded.data, draft]);
    const preview = usePreviews(
        draft
            ? [
                  draft.featuredAssetId,
                  ...draft.galleryAssetIds,
                  ...draft.feedbackAssetIds,
                  ...draft.variants.map(v => v.assetId),
              ].filter((value): value is string => !!value)
            : [],
        uploaded,
    );
    const save = useMutation({
        mutationFn: (input: ProductForm) =>
            adminApi<{
                saveBdProduct: { product: ProductForm | null; errors: Array<{ path: string; code: string }> };
            }>(SAVE, { input }).then(r => r.saveBdProduct),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.product) {
                toast.success(f.saved);
                void queryClient.invalidateQueries({ queryKey: ['products'] });
                queryClient.setQueryData(['productForm', result.product.id], result.product);
                load(result.product);
                if (isNew) navigate(`/products/${result.product.id}`, { replace: true });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });

    if (!isNew && loaded.isSuccess && !loaded.data) {
        return <Alert tone="warning">{f.notFound}</Alert>;
    }
    if (!draft) return <PageSkeleton />;

    const set = (patch: Partial<ProductForm>) => setDraft({ ...draft, ...patch });
    const setVariant = (index: number, patch: Partial<ProductFormVariant>) =>
        set({ variants: draft.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) });
    const bilingual = (
        key: 'name' | 'shortDescription' | 'description',
        language: 'bn' | 'en',
        value: string,
    ) => set({ [key]: { ...draft[key], [language]: value } } as Partial<ProductForm>);
    const keep = (image: { id: string; preview: string }) =>
        setUploaded(current => ({ ...current, [image.id]: image.preview }));
    const number = (value: string) => {
        const text = banglaToAsciiDigits(value.trim());
        return text ? Number(text) : null;
    };
    const single = draft.variationType === 'none';
    const ownDelivery =
        draft.delivery.insideDhaka !== null ||
        draft.delivery.outsideDhaka !== null ||
        draft.delivery.surcharge > 0;
    const first = draft.variants[0]!;
    const changeType = (type: VariationType) =>
        set({
            variationType: type,
            variants:
                type === 'none'
                    ? [{ ...first, option: { bn: '', en: '' }, isDefault: true }]
                    : draft.variationType === 'none'
                      ? [{ ...first, isDefault: true }]
                      : draft.variants,
        });
    const categoryName = (category: Category) =>
        category.name[language] || category.name.bn || category.name.en;

    return (
        <Page width="wide">
            <PageHeader
                back={{ to: '/products', label: f.back }}
                title={isNew ? f.newTitle : draft.name[language] || draft.name.bn || draft.name.en}
                badges={!isNew && !draft.enabled && <Badge>{f.hidden}</Badge>}
            />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{f.readOnly}</Alert>
                </div>
            )}
            <form
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <TwoColumn
                    main={
                        <>
                            <Card>
                                <CardHeader title={f.basics} />
                                <CardBody>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field label={f.nameBn} error={errors['name.bn']} hint={f.nameHint}>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    value={draft.name.bn}
                                                    maxLength={150}
                                                    disabled={!canEdit}
                                                    onChange={e => bilingual('name', 'bn', e.target.value)}
                                                />
                                            )}
                                        </Field>
                                        <Field label={f.nameEn} error={errors['name.en']} optional>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    value={draft.name.en}
                                                    maxLength={150}
                                                    disabled={!canEdit}
                                                    onChange={e => bilingual('name', 'en', e.target.value)}
                                                />
                                            )}
                                        </Field>
                                        <Field label={f.descriptionBn} optional>
                                            {control => (
                                                <Textarea
                                                    {...control}
                                                    rows={5}
                                                    value={draft.description.bn}
                                                    disabled={!canEdit}
                                                    onChange={e =>
                                                        bilingual('description', 'bn', e.target.value)
                                                    }
                                                />
                                            )}
                                        </Field>
                                        <Field label={f.descriptionEn} optional>
                                            {control => (
                                                <Textarea
                                                    {...control}
                                                    rows={5}
                                                    value={draft.description.en}
                                                    disabled={!canEdit}
                                                    onChange={e =>
                                                        bilingual('description', 'en', e.target.value)
                                                    }
                                                />
                                            )}
                                        </Field>
                                    </div>
                                    <MoreFields
                                        summary={f.moreShort}
                                        forceOpen={!!(draft.shortDescription.bn || draft.shortDescription.en)}
                                    >
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Field label={f.shortBn} hint={f.shortHint} optional>
                                                {control => (
                                                    <Textarea
                                                        {...control}
                                                        rows={2}
                                                        maxLength={300}
                                                        value={draft.shortDescription.bn}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            bilingual(
                                                                'shortDescription',
                                                                'bn',
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                )}
                                            </Field>
                                            <Field label={f.shortEn} optional>
                                                {control => (
                                                    <Textarea
                                                        {...control}
                                                        rows={2}
                                                        maxLength={300}
                                                        value={draft.shortDescription.en}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            bilingual(
                                                                'shortDescription',
                                                                'en',
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        </div>
                                    </MoreFields>
                                </CardBody>
                            </Card>

                            <Card>
                                <CardHeader title={f.images} description={f.imagesHint} />
                                <CardBody>
                                    <Field label={f.mainImage} optional>
                                        {control => (
                                            <ImageUpload
                                                {...control}
                                                maxMegabytes={15}
                                                disabled={!canEdit}
                                                value={
                                                    draft.featuredAssetId
                                                        ? {
                                                              id: draft.featuredAssetId,
                                                              preview: preview(draft.featuredAssetId) ?? '',
                                                          }
                                                        : null
                                                }
                                                onChange={image => {
                                                    if (image) keep(image);
                                                    set({ featuredAssetId: image?.id ?? null });
                                                }}
                                            />
                                        )}
                                    </Field>
                                    <ImageList
                                        label={f.gallery}
                                        hint={f.galleryHint(10)}
                                        ids={draft.galleryAssetIds}
                                        max={10}
                                        preview={preview}
                                        disabled={!canEdit}
                                        error={errors.galleryAssetIds}
                                        onAdd={image => (
                                            keep(image),
                                            set({ galleryAssetIds: [...draft.galleryAssetIds, image.id] })
                                        )}
                                        onRemove={id =>
                                            set({
                                                galleryAssetIds: draft.galleryAssetIds.filter(
                                                    other => other !== id,
                                                ),
                                            })
                                        }
                                    />
                                    <MoreFields
                                        summary={f.moreMedia}
                                        forceOpen={
                                            draft.feedbackAssetIds.length > 0 ||
                                            !!draft.youtubeUrl ||
                                            !!errors.youtubeUrl ||
                                            !!errors.feedbackAssetIds
                                        }
                                    >
                                        <ImageList
                                            label={f.feedback}
                                            hint={f.feedbackHint(20)}
                                            ids={draft.feedbackAssetIds}
                                            max={20}
                                            preview={preview}
                                            disabled={!canEdit}
                                            error={errors.feedbackAssetIds}
                                            onAdd={image => (
                                                keep(image),
                                                set({
                                                    feedbackAssetIds: [...draft.feedbackAssetIds, image.id],
                                                })
                                            )}
                                            onRemove={id =>
                                                set({
                                                    feedbackAssetIds: draft.feedbackAssetIds.filter(
                                                        other => other !== id,
                                                    ),
                                                })
                                            }
                                        />
                                        <Field label={f.youtube} error={errors.youtubeUrl} optional>
                                            {control => (
                                                <Input
                                                    {...control}
                                                    type="url"
                                                    inputMode="url"
                                                    placeholder="https://youtu.be/…"
                                                    value={draft.youtubeUrl}
                                                    disabled={!canEdit}
                                                    onChange={e => set({ youtubeUrl: e.target.value })}
                                                />
                                            )}
                                        </Field>
                                    </MoreFields>
                                </CardBody>
                            </Card>

                            {single && (
                                <Card>
                                    <CardHeader title={f.priceStock} />
                                    <CardBody>
                                        <div className="grid gap-4 sm:grid-cols-3">
                                            <Field label={f.price} error={errors['variants.0.price']}>
                                                {control => (
                                                    <TakaInput
                                                        {...control}
                                                        value={first.price || null}
                                                        disabled={!canEdit}
                                                        onChange={v => setVariant(0, { price: v ?? 0 })}
                                                    />
                                                )}
                                            </Field>
                                            <Field
                                                label={f.oldPrice}
                                                hint={f.oldPriceHint}
                                                error={errors['variants.0.oldPrice']}
                                                optional
                                            >
                                                {control => (
                                                    <TakaInput
                                                        {...control}
                                                        value={first.oldPrice}
                                                        disabled={!canEdit}
                                                        onChange={v => setVariant(0, { oldPrice: v })}
                                                    />
                                                )}
                                            </Field>
                                            <Field label={f.stock} error={errors['variants.0.stock']}>
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        inputMode="numeric"
                                                        value={digits(first.stock)}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            setVariant(0, {
                                                                stock: number(e.target.value) ?? 0,
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        </div>
                                    </CardBody>
                                </Card>
                            )}

                            <CollapsibleCard
                                title={f.delivery}
                                summary={
                                    draft.delivery.free
                                        ? f.freeDelivery
                                        : ownDelivery
                                          ? f.deliveryOwn
                                          : f.deliveryDefault
                                }
                                forceOpen={
                                    draft.delivery.free ||
                                    ownDelivery ||
                                    Object.keys(errors).some(key => key.startsWith('delivery.'))
                                }
                            >
                                <p className="text-[13px] text-ink-muted">{f.deliveryHint}</p>
                                <Switch
                                    label={f.freeDelivery}
                                    checked={draft.delivery.free}
                                    disabled={!canEdit}
                                    onChange={free => set({ delivery: { ...draft.delivery, free } })}
                                />
                                {!draft.delivery.free && (
                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <Field
                                            label={f.insideDhaka}
                                            hint={f.blankDefault}
                                            error={errors['delivery.insideDhaka']}
                                            optional
                                        >
                                            {control => (
                                                <TakaInput
                                                    {...control}
                                                    value={draft.delivery.insideDhaka}
                                                    disabled={!canEdit}
                                                    onChange={v =>
                                                        set({
                                                            delivery: { ...draft.delivery, insideDhaka: v },
                                                        })
                                                    }
                                                />
                                            )}
                                        </Field>
                                        <Field
                                            label={f.outsideDhaka}
                                            hint={f.blankDefault}
                                            error={errors['delivery.outsideDhaka']}
                                            optional
                                        >
                                            {control => (
                                                <TakaInput
                                                    {...control}
                                                    value={draft.delivery.outsideDhaka}
                                                    disabled={!canEdit}
                                                    onChange={v =>
                                                        set({
                                                            delivery: { ...draft.delivery, outsideDhaka: v },
                                                        })
                                                    }
                                                />
                                            )}
                                        </Field>
                                        <Field
                                            label={f.surcharge}
                                            hint={f.surchargeHint}
                                            error={errors['delivery.surcharge']}
                                            optional
                                        >
                                            {control => (
                                                <TakaInput
                                                    {...control}
                                                    value={draft.delivery.surcharge || null}
                                                    disabled={!canEdit}
                                                    onChange={v =>
                                                        set({
                                                            delivery: {
                                                                ...draft.delivery,
                                                                surcharge: v ?? 0,
                                                            },
                                                        })
                                                    }
                                                />
                                            )}
                                        </Field>
                                    </div>
                                )}
                            </CollapsibleCard>

                            <Card>
                                <CardHeader title={f.variations} description={f.variationsHint} />
                                <CardBody>
                                    <Field label={f.variationType}>
                                        {control => (
                                            <Select
                                                {...control}
                                                value={draft.variationType}
                                                disabled={!canEdit}
                                                onChange={e => changeType(e.target.value as VariationType)}
                                            >
                                                {VARIATION_TYPES.map(type => (
                                                    <option key={type} value={type}>
                                                        {f.variationTypes[type]}
                                                    </option>
                                                ))}
                                            </Select>
                                        )}
                                    </Field>
                                    {!isNew &&
                                        loaded.data &&
                                        loaded.data.variationType !== 'none' &&
                                        draft.variationType !== loaded.data.variationType && (
                                            <Alert tone="warning">{f.typeChangeWarning}</Alert>
                                        )}
                                    {draft.variationType === 'custom' && (
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Field label={f.customNameBn} error={errors['variationName.bn']}>
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        value={draft.variationName.bn}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            set({
                                                                variationName: {
                                                                    ...draft.variationName,
                                                                    bn: e.target.value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                            <Field label={f.customNameEn} optional>
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        value={draft.variationName.en}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            set({
                                                                variationName: {
                                                                    ...draft.variationName,
                                                                    en: e.target.value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        </div>
                                    )}
                                    {!single && (
                                        <ul className="space-y-3">
                                            {draft.variants.map((variant, index) => (
                                                <li
                                                    key={variant.id ?? `new-${index}`}
                                                    className="space-y-3 rounded-md border border-line p-3"
                                                >
                                                    <div className="grid gap-3 sm:grid-cols-2">
                                                        <Field
                                                            label={f.optionBn}
                                                            error={errors[`variants.${index}.option.bn`]}
                                                        >
                                                            {control => (
                                                                <Input
                                                                    {...control}
                                                                    value={variant.option.bn}
                                                                    disabled={!canEdit}
                                                                    onChange={e =>
                                                                        setVariant(index, {
                                                                            option: {
                                                                                ...variant.option,
                                                                                bn: e.target.value,
                                                                            },
                                                                        })
                                                                    }
                                                                />
                                                            )}
                                                        </Field>
                                                        <Field label={f.optionEn} optional>
                                                            {control => (
                                                                <Input
                                                                    {...control}
                                                                    value={variant.option.en}
                                                                    disabled={!canEdit}
                                                                    onChange={e =>
                                                                        setVariant(index, {
                                                                            option: {
                                                                                ...variant.option,
                                                                                en: e.target.value,
                                                                            },
                                                                        })
                                                                    }
                                                                />
                                                            )}
                                                        </Field>
                                                    </div>
                                                    <div className="grid gap-3 sm:grid-cols-3">
                                                        <Field
                                                            label={f.price}
                                                            error={errors[`variants.${index}.price`]}
                                                        >
                                                            {control => (
                                                                <TakaInput
                                                                    {...control}
                                                                    value={variant.price || null}
                                                                    disabled={!canEdit}
                                                                    onChange={v =>
                                                                        setVariant(index, { price: v ?? 0 })
                                                                    }
                                                                />
                                                            )}
                                                        </Field>
                                                        <Field
                                                            label={f.oldPrice}
                                                            error={errors[`variants.${index}.oldPrice`]}
                                                            optional
                                                        >
                                                            {control => (
                                                                <TakaInput
                                                                    {...control}
                                                                    value={variant.oldPrice}
                                                                    disabled={!canEdit}
                                                                    onChange={v =>
                                                                        setVariant(index, { oldPrice: v })
                                                                    }
                                                                />
                                                            )}
                                                        </Field>
                                                        <Field
                                                            label={f.stock}
                                                            error={errors[`variants.${index}.stock`]}
                                                        >
                                                            {control => (
                                                                <Input
                                                                    {...control}
                                                                    inputMode="numeric"
                                                                    value={digits(variant.stock)}
                                                                    disabled={!canEdit}
                                                                    onChange={e =>
                                                                        setVariant(index, {
                                                                            stock:
                                                                                number(e.target.value) ?? 0,
                                                                        })
                                                                    }
                                                                />
                                                            )}
                                                        </Field>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                                                        <label className="flex items-center gap-2 text-sm">
                                                            <input
                                                                type="radio"
                                                                name="default-variant"
                                                                className="size-4"
                                                                checked={variant.isDefault}
                                                                disabled={!canEdit}
                                                                onChange={() =>
                                                                    set({
                                                                        variants: draft.variants.map(
                                                                            (v, i) => ({
                                                                                ...v,
                                                                                isDefault: i === index,
                                                                            }),
                                                                        ),
                                                                    })
                                                                }
                                                            />
                                                            {f.isDefault}
                                                        </label>
                                                        <Switch
                                                            label={f.variantEnabled}
                                                            checked={variant.enabled}
                                                            disabled={!canEdit}
                                                            onChange={enabled =>
                                                                setVariant(index, { enabled })
                                                            }
                                                        />
                                                        <Switch
                                                            label={f.backorder}
                                                            checked={variant.allowBackorder}
                                                            disabled={!canEdit}
                                                            onChange={allowBackorder =>
                                                                setVariant(index, { allowBackorder })
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap items-end justify-between gap-3">
                                                        <Field label={f.variantImage} optional>
                                                            {control => (
                                                                <ImageUpload
                                                                    {...control}
                                                                    maxMegabytes={15}
                                                                    disabled={!canEdit}
                                                                    value={
                                                                        variant.assetId
                                                                            ? {
                                                                                  id: variant.assetId,
                                                                                  preview:
                                                                                      preview(
                                                                                          variant.assetId,
                                                                                      ) ?? '',
                                                                              }
                                                                            : null
                                                                    }
                                                                    onChange={image => {
                                                                        if (image) keep(image);
                                                                        setVariant(index, {
                                                                            assetId: image?.id ?? null,
                                                                        });
                                                                    }}
                                                                />
                                                            )}
                                                        </Field>
                                                        {canEdit && draft.variants.length > 1 && (
                                                            <Button
                                                                variant="ghost"
                                                                className="text-danger"
                                                                onClick={() =>
                                                                    set({
                                                                        variants: draft.variants.filter(
                                                                            (_, i) => i !== index,
                                                                        ),
                                                                    })
                                                                }
                                                            >
                                                                <Trash2 className="size-4" aria-hidden />{' '}
                                                                {f.removeVariant}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {!single && canEdit && draft.variants.length < 50 && (
                                        <Button
                                            variant="secondary"
                                            onClick={() =>
                                                set({
                                                    variants: [
                                                        ...draft.variants,
                                                        { ...emptyVariant(), price: first.price },
                                                    ],
                                                })
                                            }
                                        >
                                            <Plus className="size-4" aria-hidden /> {f.addVariant}
                                        </Button>
                                    )}
                                    {errors.variants && (
                                        <p className="text-sm text-danger">{f.variantsInvalid}</p>
                                    )}
                                </CardBody>
                            </Card>

                            <CollapsibleCard
                                title={f.more}
                                forceOpen={Object.keys(errors).some(
                                    key => key.startsWith('seo.') || key.endsWith('weightGrams'),
                                )}
                            >
                                <div className="space-y-4">
                                    {draft.variants.map((variant, index) => (
                                        <div
                                            key={variant.id ?? `more-${index}`}
                                            className="grid gap-3 sm:grid-cols-3"
                                        >
                                            <p className="self-center text-sm font-medium sm:col-span-1">
                                                {single
                                                    ? f.thisProduct
                                                    : variant.option[language] ||
                                                      variant.option.bn ||
                                                      variant.option.en ||
                                                      f.unnamed}
                                            </p>
                                            <Field label={f.sku} optional>
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        maxLength={64}
                                                        value={variant.sku}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            setVariant(index, { sku: e.target.value })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                            <Field
                                                label={f.weight}
                                                error={errors[`variants.${index}.weightGrams`]}
                                                optional
                                            >
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        inputMode="numeric"
                                                        value={
                                                            variant.weightGrams === null
                                                                ? ''
                                                                : digits(variant.weightGrams)
                                                        }
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            setVariant(index, {
                                                                weightGrams: number(e.target.value),
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        </div>
                                    ))}
                                    {single && (
                                        <Switch
                                            label={f.backorder}
                                            checked={first.allowBackorder}
                                            disabled={!canEdit}
                                            onChange={allowBackorder => setVariant(0, { allowBackorder })}
                                        />
                                    )}
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {(['bn', 'en'] as const).map(lang => (
                                            <Field
                                                key={`title-${lang}`}
                                                label={f.seoTitle(
                                                    lang === 'bn' ? m.language.bn : m.language.en,
                                                )}
                                                hint={f.seoTitleHint}
                                                optional
                                            >
                                                {control => (
                                                    <Input
                                                        {...control}
                                                        maxLength={70}
                                                        value={draft.seo.title[lang]}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            set({
                                                                seo: {
                                                                    ...draft.seo,
                                                                    title: {
                                                                        ...draft.seo.title,
                                                                        [lang]: e.target.value,
                                                                    },
                                                                },
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        ))}
                                        {(['bn', 'en'] as const).map(lang => (
                                            <Field
                                                key={`description-${lang}`}
                                                label={f.seoDescription(
                                                    lang === 'bn' ? m.language.bn : m.language.en,
                                                )}
                                                optional
                                            >
                                                {control => (
                                                    <Textarea
                                                        {...control}
                                                        rows={2}
                                                        maxLength={160}
                                                        value={draft.seo.description[lang]}
                                                        disabled={!canEdit}
                                                        onChange={e =>
                                                            set({
                                                                seo: {
                                                                    ...draft.seo,
                                                                    description: {
                                                                        ...draft.seo.description,
                                                                        [lang]: e.target.value,
                                                                    },
                                                                },
                                                            })
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        ))}
                                    </div>
                                </div>
                            </CollapsibleCard>
                        </>
                    }
                    side={
                        <>
                            <Card>
                                <CardHeader title={f.visibility} />
                                <CardBody>
                                    <div className="space-y-4">
                                        <Switch
                                            label={f.featured}
                                            checked={draft.featured}
                                            disabled={!canEdit}
                                            onChange={featured => set({ featured })}
                                        />
                                        <Switch
                                            label={f.isNew}
                                            checked={draft.isNew}
                                            disabled={!canEdit}
                                            onChange={isNew => set({ isNew })}
                                        />
                                        <Switch
                                            label={f.enabled}
                                            description={f.enabledHint}
                                            checked={draft.enabled}
                                            disabled={!canEdit}
                                            onChange={enabled => set({ enabled })}
                                        />
                                    </div>
                                </CardBody>
                            </Card>
                            <Card>
                                <CardBody>
                                    <Field label={f.category} error={errors.categoryId} optional>
                                        {control => (
                                            <Select
                                                {...control}
                                                value={draft.categoryId ?? ''}
                                                disabled={!canEdit}
                                                onChange={e => set({ categoryId: e.target.value || null })}
                                            >
                                                <option value="">{f.noCategory}</option>
                                                {categories.data?.map(category => (
                                                    <option key={category.id} value={category.id}>
                                                        {categoryName(category)}
                                                    </option>
                                                ))}
                                            </Select>
                                        )}
                                    </Field>
                                </CardBody>
                            </Card>
                        </>
                    }
                />
                {canEdit && (
                    <SaveBar
                        dirty={JSON.stringify(draft) !== baseline}
                        saving={save.isPending}
                        saveLabel={f.save}
                        onSave={() => save.mutate(draft)}
                        onDiscard={isNew ? undefined : () => setDraft(JSON.parse(baseline) as ProductForm)}
                    />
                )}
            </form>
        </Page>
    );
}

/** A row of uploaded images with remove buttons and one more upload slot. */
function ImageList({
    label,
    hint,
    ids,
    max,
    preview,
    disabled,
    error,
    onAdd,
    onRemove,
}: {
    label: string;
    hint: string;
    ids: string[];
    max: number;
    preview(id: string): string | null;
    disabled: boolean;
    error?: string;
    onAdd(image: { id: string; preview: string }): void;
    onRemove(id: string): void;
}) {
    const { messages: m } = useI18n();
    return (
        <Field label={label} hint={hint} error={error} optional>
            {control => (
                <div className="flex flex-wrap gap-3">
                    {ids.map(id => (
                        <div key={id} className="relative">
                            {preview(id) ? (
                                <img
                                    src={`${preview(id)}?preset=thumb`}
                                    alt=""
                                    className="size-24 rounded object-cover"
                                />
                            ) : (
                                <div className="size-24 rounded bg-surface-muted" />
                            )}
                            {!disabled && (
                                <button
                                    type="button"
                                    className="absolute -right-2 -top-2 rounded-full bg-surface p-1 shadow"
                                    aria-label={m.common.remove}
                                    onClick={() => onRemove(id)}
                                >
                                    <X className="size-4" aria-hidden />
                                </button>
                            )}
                        </div>
                    ))}
                    {!disabled && ids.length < max && (
                        <ImageUpload
                            {...control}
                            maxMegabytes={15}
                            value={null}
                            onChange={image => image && onAdd(image)}
                        />
                    )}
                </div>
            )}
        </Field>
    );
}
