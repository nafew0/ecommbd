import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { ImageUpload } from '../components/form/image-upload';
import { Input, Textarea } from '../components/ui/input';
import { CollapsibleCard } from '../components/ui/disclosure';
import { Page } from '../components/ui/layout';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

const FIELDS = 'id code name { bn en } description { bn en } logoAssetId logoPreview productCount';

interface Brand {
    id: string | null;
    code: string;
    name: { bn: string; en: string };
    description: { bn: string; en: string };
    logoAssetId: string | null;
    logoPreview: string | null;
    productCount: number;
}

const emptyBrand = (): Brand => ({
    id: null,
    code: '',
    name: { bn: '', en: '' },
    description: { bn: '', en: '' },
    logoAssetId: null,
    logoPreview: null,
    productCount: 0,
});

/** One brand (phase 55): names, logo and, under More, its address and description. */
export function BrandPage() {
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const { messages: m } = useI18n();
    const b = m.brands;
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateCatalog') || can(isNew ? 'CreateFacet' : 'UpdateFacet');
    const canDelete = can('DeleteCatalog') || can('DeleteFacet');
    const query = useQuery({
        queryKey: ['brands', 'one', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdBrand: Brand | null }>(`query ($id: ID!) { bdBrand(id: $id) { ${FIELDS} } }`, { id }).then(
                result => result.bdBrand,
            ),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Brand>(isNew ? emptyBrand() : null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!isNew && query.data && !draft) load(query.data);
    }, [isNew, query.data, draft]);
    const save = useMutation({
        mutationFn: (input: Brand) =>
            adminApi<{ saveBdBrand: { brand: Brand | null; errors: Array<{ path: string; code: string }> } }>(
                `mutation ($input: JSON!) { saveBdBrand(input: $input) { brand { ${FIELDS} } errors { path code } } }`,
                { input },
            ).then(result => result.saveBdBrand),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (!result.brand) {
                toast.error(m.settings.fixErrors);
                return;
            }
            load(result.brand);
            toast.success(b.saved);
            void queryClient.invalidateQueries({ queryKey: ['brands'] });
            if (isNew) navigate(`/products/brands/${result.brand.id}`, { replace: true });
        },
        onError: () => toast.error(m.errors.generic),
    });
    const remove = async () => {
        if (!draft?.id) return;
        const ok = await confirm({
            title: b.deleteTitle(draft.name.bn || draft.name.en),
            body: b.deleteBody,
            confirmLabel: m.common.delete,
            danger: true,
        });
        if (!ok) return;
        await adminApi(`mutation ($id: ID!) { deleteBdBrand(id: $id) }`, { id: draft.id }).then(
            () => {
                toast.success(b.deleted);
                void queryClient.invalidateQueries({ queryKey: ['brands'] });
                navigate('/products/brands');
            },
            () => toast.error(m.errors.generic),
        );
    };
    if (!isNew && query.data === null) {
        return (
            <Page width="narrow">
                <PageHeader back={{ to: '/products/brands', label: b.back }} title={b.title} />
                <Alert>{b.notFound}</Alert>
            </Page>
        );
    }
    if (!draft) return <PageSkeleton />;
    const setName = (language: 'bn' | 'en', value: string) =>
        setDraft({ ...draft, name: { ...draft.name, [language]: value } });
    const setDescription = (language: 'bn' | 'en', value: string) =>
        setDraft({ ...draft, description: { ...draft.description, [language]: value } });
    return (
        <Page width="narrow">
            <PageHeader
                back={{ to: '/products/brands', label: b.back }}
                title={isNew ? b.add : draft.name.bn || draft.name.en}
                description={isNew ? undefined : b.productCount(draft.productCount)}
                menu={
                    !isNew && canDelete
                        ? [
                              {
                                  label: m.common.delete,
                                  icon: <Trash2 className="size-4" aria-hidden />,
                                  tone: 'danger',
                                  onSelect: () => void remove(),
                              },
                          ]
                        : undefined
                }
            />
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
                    <CardHeader title={b.basics} />
                    <CardBody>
                        <Field label={b.nameBn} hint={b.nameHint} error={errors['name.bn']}>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={80}
                                    value={draft.name.bn}
                                    disabled={!canEdit}
                                    onChange={event => setName('bn', event.target.value)}
                                />
                            )}
                        </Field>
                        <Field label={b.nameEn} error={errors['name.en']} optional>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={80}
                                    value={draft.name.en}
                                    disabled={!canEdit}
                                    onChange={event => setName('en', event.target.value)}
                                />
                            )}
                        </Field>
                        <Field label={b.logo} error={errors.logoAssetId} optional>
                            {control => (
                                <ImageUpload
                                    {...control}
                                    maxMegabytes={2}
                                    disabled={!canEdit}
                                    value={
                                        draft.logoAssetId && draft.logoPreview
                                            ? { id: draft.logoAssetId, preview: draft.logoPreview }
                                            : null
                                    }
                                    onChange={image =>
                                        setDraft({
                                            ...draft,
                                            logoAssetId: image?.id ?? null,
                                            logoPreview: image?.preview ?? null,
                                        })
                                    }
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>
                <CollapsibleCard
                    title={b.more}
                    summary={draft.code ? `/brand/${draft.code}` : b.addressAuto}
                    forceOpen={!!errors.code || Object.keys(errors).some(key => key.startsWith('description.'))}
                >
                    <Field label={b.address} hint={b.addressHint} error={errors.code} optional>
                        {control => (
                            <Input
                                {...control}
                                maxLength={60}
                                value={draft.code}
                                disabled={!canEdit}
                                onChange={event => setDraft({ ...draft, code: event.target.value })}
                            />
                        )}
                    </Field>
                    {(['bn', 'en'] as const).map(language => (
                        <Field
                            key={language}
                            label={language === 'bn' ? b.descriptionBn : b.descriptionEn}
                            error={errors[`description.${language}`]}
                            optional
                        >
                            {control => (
                                <Textarea
                                    {...control}
                                    rows={3}
                                    maxLength={2000}
                                    value={draft.description[language]}
                                    disabled={!canEdit}
                                    onChange={event => setDescription(language, event.target.value)}
                                />
                            )}
                        </Field>
                    ))}
                </CollapsibleCard>
                {canEdit && <SaveBar dirty={dirty || isNew} saving={save.isPending} onDiscard={isNew ? undefined : discard} />}
            </form>
        </Page>
    );
}
