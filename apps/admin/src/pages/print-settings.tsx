import {
    INVOICE_SIZES,
    PRINT_LANGUAGES,
    type PrintSettings,
    STICKER_SIZES,
} from '@ecommbd/shared/print-settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdatePrintSettings($input: JSON!) {
        updateBdPrintSettings(input: $input) { settings errors { path code } }
    }
`;

/** Settings → Invoices and stickers (roadmap phase 06): paper sizes, what shows, language, digits, footer. */
export function PrintSettingsPage() {
    const { messages: m } = useI18n();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['printSettings'],
        queryFn: () =>
            adminApi<{ bdPrintSettings: PrintSettings }>('{ bdPrintSettings }').then(r => r.bdPrintSettings),
    });
    const [draft, setDraft] = useState<PrintSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: PrintSettings) =>
            adminApi<{
                updateBdPrintSettings: {
                    settings: PrintSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdPrintSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(m.printSettings.saved);
                void queryClient.invalidateQueries({ queryKey: ['printSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const s = m.printSettings;
    const invoice = (patch: Partial<PrintSettings['invoice']>) =>
        setDraft({ ...draft, invoice: { ...draft.invoice, ...patch } });
    const sticker = (patch: Partial<PrintSettings['sticker']>) =>
        setDraft({ ...draft, sticker: { ...draft.sticker, ...patch } });
    return (
        <>
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
                    <CardHeader title={s.invoice} />
                    <CardBody>
                        <Field label={s.invoiceSize}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.invoice.size}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        invoice({
                                            size: event.target.value as PrintSettings['invoice']['size'],
                                        })
                                    }
                                    className="w-48"
                                >
                                    {INVOICE_SIZES.map(size => (
                                        <option key={size} value={size}>
                                            {m.print.sizes[size]}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Switch
                            label={s.showLogo}
                            checked={draft.invoice.showLogo}
                            disabled={!canEdit}
                            onChange={value => invoice({ showLogo: value })}
                        />
                        <Switch
                            label={s.showStoreAddress}
                            checked={draft.invoice.showStoreAddress}
                            disabled={!canEdit}
                            onChange={value => invoice({ showStoreAddress: value })}
                        />
                        <Switch
                            label={s.showNote}
                            checked={draft.invoice.showNote}
                            disabled={!canEdit}
                            onChange={value => invoice({ showNote: value })}
                        />
                        <Switch
                            label={s.showReturnPolicy}
                            checked={draft.invoice.showReturnPolicy}
                            disabled={!canEdit}
                            onChange={value => invoice({ showReturnPolicy: value })}
                        />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={s.sticker} />
                    <CardBody>
                        <Field label={s.stickerSize} hint={s.stickerSizeHint}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.sticker.size}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        sticker({
                                            size: event.target.value as PrintSettings['sticker']['size'],
                                        })
                                    }
                                    className="w-56"
                                >
                                    {STICKER_SIZES.map(size => (
                                        <option key={size} value={size}>
                                            {m.print.sizes[size]}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Switch
                            label={s.showItems}
                            checked={draft.sticker.showItems}
                            disabled={!canEdit}
                            onChange={value => sticker({ showItems: value })}
                        />
                        <Switch
                            label={s.showSender}
                            checked={draft.sticker.showSender}
                            disabled={!canEdit}
                            onChange={value => sticker({ showSender: value })}
                        />
                        <Switch
                            label={s.showStickerNote}
                            checked={draft.sticker.showNote}
                            disabled={!canEdit}
                            onChange={value => sticker({ showNote: value })}
                        />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title={s.language} />
                    <CardBody>
                        <Field label={s.language}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.language}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        setDraft({
                                            ...draft,
                                            language: event.target.value as PrintSettings['language'],
                                        })
                                    }
                                    className="w-48"
                                >
                                    {PRINT_LANGUAGES.map(language => (
                                        <option key={language} value={language}>
                                            {s.languages[language]}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Switch
                            label={s.banglaDigits}
                            description={s.banglaDigitsHint}
                            checked={draft.banglaDigits}
                            disabled={!canEdit}
                            onChange={value => setDraft({ ...draft, banglaDigits: value })}
                        />
                        <p className="text-sm text-slate-600">{s.footerHint}</p>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {(['bn', 'en'] as const).map(language => (
                                <Field
                                    key={language}
                                    label={language === 'bn' ? s.footerBn : s.footerEn}
                                    error={errors[`footerText.${language}`]}
                                    optional
                                >
                                    {control => (
                                        <Input
                                            {...control}
                                            value={draft.footerText[language]}
                                            maxLength={300}
                                            disabled={!canEdit}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    footerText: {
                                                        ...draft.footerText,
                                                        [language]: event.target.value,
                                                    },
                                                })
                                            }
                                        />
                                    )}
                                </Field>
                            ))}
                        </div>
                    </CardBody>
                </Card>
                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>
        </>
    );
}
