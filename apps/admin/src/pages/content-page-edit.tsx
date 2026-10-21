import { CONTENT_LIMITS } from '@ecommbd/shared/content';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { RichTextEditor } from '../components/form/rich-text-editor';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { type ContentPage, PAGE_FIELDS } from './content-pages';

type Lang = 'bn' | 'en';
interface Text {
    title: string;
    slug: string;
    body: string;
    seoTitle: string;
    seoDescription: string;
}
interface Draft {
    enabled: boolean;
    translations: Record<Lang, Text>;
}

const emptyText = (): Text => ({ title: '', slug: '', body: '', seoTitle: '', seoDescription: '' });

function toDraft(page: ContentPage | null): Draft {
    const text = (language: Lang): Text => {
        const found = page?.translations.find(t => t.languageCode === language);
        return found ? { ...found, slug: found.slug.normalize('NFC') } : emptyText();
    };
    return { enabled: page?.enabled ?? true, translations: { bn: text('bn'), en: text('en') } };
}

const SAVE = `
    mutation SavePage($id: ID, $input: JSON!) {
        saveBdPage(id: $id, input: $input) { page { ${PAGE_FIELDS} } errors { path code } }
    }
`;

/** Online store → Pages → a page (roadmap phase 12): title, address, text and Google fields per language. */
export function ContentPageEditPage() {
    const { id } = useParams();
    const isNew = id === 'new';
    const { messages: m } = useI18n();
    const c = m.content;
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['contentPage', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdPage: ContentPage | null }>(
                `query ($id: ID!) { bdPage(id: $id) { ${PAGE_FIELDS} } }`,
                {
                    id,
                },
            ).then(result => result.bdPage),
    });
    const [draft, setDraft] = useState<Draft | null>(isNew ? toDraft(null) : null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!isNew && query.data !== undefined && !draft) setDraft(toDraft(query.data));
    }, [isNew, query.data, draft]);

    const save = useMutation({
        mutationFn: (input: Draft) =>
            adminApi<{
                saveBdPage: { page: ContentPage | null; errors: Array<{ path: string; code: string }> };
            }>(SAVE, {
                id: isNew ? null : id,
                input,
            }).then(result => result.saveBdPage),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (!result.page) {
                toast.error(m.settings.fixErrors);
                return;
            }
            toast.success(c.saved);
            void queryClient.invalidateQueries({ queryKey: ['contentPages'] });
            setDraft(toDraft(result.page));
            if (isNew) void navigate(`/store/pages/${result.page.id}`, { replace: true });
        },
        onError: () => toast.error(m.errors.generic),
    });
    const remove = useMutation({
        mutationFn: () => adminApi(`mutation ($id: ID!) { deleteBdPage(id: $id) }`, { id }),
        onSuccess: () => {
            toast.success(c.deleted);
            void queryClient.invalidateQueries({ queryKey: ['contentPages'] });
            void navigate('/store/pages');
        },
        onError: () => toast.error(m.errors.generic),
    });

    if (!draft) return <PageSkeleton />;
    const set = (language: Lang, patch: Partial<Text>) =>
        setDraft({
            ...draft,
            translations: {
                ...draft.translations,
                [language]: { ...draft.translations[language], ...patch },
            },
        });
    const error = (language: Lang, field: keyof Text) => errors[`translations.${language}.${field}`];

    return (
        <>
            <Link
                to="/store/pages"
                className="mb-3 inline-flex items-center gap-1 text-sm text-teal-800 hover:underline"
            >
                <ArrowLeft className="size-4" aria-hidden />
                {c.back}
            </Link>
            <PageHeader title={isNew ? c.newPage : c.editPage} description={c.languageHint} />
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardBody>
                        <Switch
                            label={c.enabled}
                            checked={draft.enabled}
                            onChange={value => setDraft({ ...draft, enabled: value })}
                        />
                    </CardBody>
                </Card>
                {(['bn', 'en'] as const).map(language => {
                    const text = draft.translations[language];
                    return (
                        <Card key={language}>
                            <CardHeader title={language === 'bn' ? c.bangla : c.english} />
                            <CardBody className="space-y-4">
                                <Field label={c.title} error={error(language, 'title')}>
                                    {control => (
                                        <Input
                                            {...control}
                                            lang={language}
                                            value={text.title}
                                            maxLength={CONTENT_LIMITS.title}
                                            onChange={event => set(language, { title: event.target.value })}
                                        />
                                    )}
                                </Field>
                                <Field
                                    label={c.slug}
                                    hint={c.slugHint}
                                    error={error(language, 'slug')}
                                    optional
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            lang={language}
                                            value={text.slug}
                                            maxLength={CONTENT_LIMITS.slug}
                                            onChange={event => set(language, { slug: event.target.value })}
                                        />
                                    )}
                                </Field>
                                <Field label={c.body} error={error(language, 'body')} optional>
                                    {control => (
                                        <RichTextEditor
                                            {...control}
                                            label={c.body}
                                            lang={language}
                                            value={text.body}
                                            onChange={body => set(language, { body })}
                                        />
                                    )}
                                </Field>
                                <details className="rounded-md border border-slate-200 p-3">
                                    <summary className="cursor-pointer font-medium">{c.seo}</summary>
                                    <div className="mt-3 space-y-4">
                                        <Field
                                            label={c.seoTitle}
                                            hint={c.seoTitleHint}
                                            error={error(language, 'seoTitle')}
                                            optional
                                        >
                                            {control => (
                                                <Input
                                                    {...control}
                                                    lang={language}
                                                    value={text.seoTitle}
                                                    maxLength={CONTENT_LIMITS.seoTitle}
                                                    onChange={event =>
                                                        set(language, { seoTitle: event.target.value })
                                                    }
                                                />
                                            )}
                                        </Field>
                                        <Field
                                            label={c.seoDescription}
                                            hint={c.seoDescriptionHint}
                                            error={error(language, 'seoDescription')}
                                            optional
                                        >
                                            {control => (
                                                <Textarea
                                                    {...control}
                                                    lang={language}
                                                    rows={3}
                                                    value={text.seoDescription}
                                                    maxLength={CONTENT_LIMITS.seoDescription}
                                                    onChange={event =>
                                                        set(language, { seoDescription: event.target.value })
                                                    }
                                                />
                                            )}
                                        </Field>
                                    </div>
                                </details>
                            </CardBody>
                        </Card>
                    );
                })}
                <div className="flex flex-wrap justify-between gap-3">
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                    {!isNew && (
                        <Button
                            variant="danger"
                            loading={remove.isPending}
                            onClick={async () => {
                                if (
                                    await confirm({
                                        title: c.deleteConfirm,
                                        confirmLabel: c.delete,
                                        danger: true,
                                    })
                                ) {
                                    remove.mutate();
                                }
                            }}
                        >
                            {c.delete}
                        </Button>
                    )}
                </div>
            </form>
        </>
    );
}
