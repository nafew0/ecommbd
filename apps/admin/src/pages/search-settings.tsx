import { SEARCH_LIMITS, type SearchSettings } from '@ecommbd/shared/search';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, SearchX, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
    Alert,
    Card,
    CardBody,
    CardHeader,
    EmptyState,
    PageHeader,
    PageSkeleton,
} from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDigits } from '../components/form/inputs';
import { errorMap } from '../lib/form';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdateSearchSettings($input: JSON!) {
        updateBdSearchSettings(input: $input) { settings errors { path code } }
    }
`;

interface Miss {
    term: string;
    count: number;
    lastSearchedAt: string;
}

/** One group as the merchant types it: words separated by commas. */
const toText = (group: string[]) => group.join(', ');
const toTerms = (text: string) =>
    text
        .split(/[,،]/)
        .map(term => term.trim())
        .filter(Boolean);

/**
 * Online store → Search (roadmap phase 13): synonyms (words that find each other, like
 * "panjabi, পাঞ্জাবি") and the searches that found nothing in the last 30 days.
 */
export function SearchSettingsPage() {
    const { messages: m } = useI18n();
    const s = m.search;
    const { can } = useAuth();
    const toast = useToast();
    const format = useFormat();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('ManageContent');
    const settings = useQuery({
        queryKey: ['searchSettings'],
        queryFn: () =>
            adminApi<{ bdSearchSettings: SearchSettings }>('{ bdSearchSettings }').then(
                r => r.bdSearchSettings,
            ),
    });
    const misses = useQuery({
        queryKey: ['searchMisses'],
        queryFn: () =>
            adminApi<{ bdSearchMisses: Miss[] }>('{ bdSearchMisses { term count lastSearchedAt } }').then(
                r => r.bdSearchMisses,
            ),
    });
    const [groups, setGroups] = useState<string[] | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (settings.data && !groups) setGroups(settings.data.synonyms.map(toText));
    }, [settings.data, groups]);
    const save = useMutation({
        mutationFn: (input: SearchSettings) =>
            adminApi<{
                updateBdSearchSettings: {
                    settings: SearchSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdSearchSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setGroups(result.settings.synonyms.map(toText));
                toast.success(s.saved);
                void queryClient.invalidateQueries({ queryKey: ['searchSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!groups) return <PageSkeleton />;
    const update = (index: number, text: string) =>
        setGroups(groups.map((group, i) => (i === index ? text : group)));
    const remove = (index: number) => setGroups(groups.filter((_, i) => i !== index));
    const add = (text = '') => setGroups([...groups, text]);
    const groupError = (index: number) => {
        const key = Object.keys(errors).find(
            path => path === `synonyms.${index}` || path.startsWith(`synonyms.${index}.`),
        );
        return key ? errors[key] : undefined;
    };

    return (
        <>
            <PageHeader title={s.title} description={s.description} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{s.readOnly}</Alert>
                </div>
            )}
            <div className="space-y-4">
                <form
                    onSubmit={event => {
                        event.preventDefault();
                        // Empty rows are left out; the server checks the rest.
                        const synonyms = groups.map(toTerms).filter(terms => terms.length);
                        save.mutate({ synonyms });
                    }}
                >
                    <Card>
                        <CardHeader title={s.synonyms} description={s.synonymsHint} />
                        <CardBody>
                            {groups.length === 0 && <p className="text-sm text-slate-600">{s.noSynonyms}</p>}
                            {groups.map((group, index) => (
                                <Field
                                    key={index}
                                    label={s.group(digits(index + 1))}
                                    error={groupError(index)}
                                >
                                    {control => (
                                        <div className="flex gap-2">
                                            <Input
                                                {...control}
                                                value={group}
                                                placeholder={s.placeholder}
                                                maxLength={
                                                    SEARCH_LIMITS.synonymTerms *
                                                    (SEARCH_LIMITS.synonymTerm + 2)
                                                }
                                                readOnly={!canEdit}
                                                onChange={event => update(index, event.target.value)}
                                            />
                                            {canEdit && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    aria-label={s.remove}
                                                    title={s.remove}
                                                    onClick={() => remove(index)}
                                                >
                                                    <Trash2 className="size-4" aria-hidden />
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </Field>
                            ))}
                            {canEdit && (
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={groups.length >= SEARCH_LIMITS.synonymGroups}
                                        onClick={() => add()}
                                    >
                                        <Plus className="size-4" aria-hidden />
                                        {s.addGroup}
                                    </Button>
                                    <Button type="submit" loading={save.isPending}>
                                        {m.settings.save}
                                    </Button>
                                </div>
                            )}
                        </CardBody>
                    </Card>
                </form>

                <Card>
                    <CardHeader title={s.misses} description={s.missesHint} />
                    {misses.data && misses.data.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-left text-slate-600">
                                    <tr>
                                        <th className="px-4 py-2 font-medium">{s.term}</th>
                                        <th className="px-4 py-2 font-medium">{s.times}</th>
                                        <th className="hidden px-4 py-2 font-medium sm:table-cell">
                                            {s.lastSearched}
                                        </th>
                                        <th className="px-4 py-2">
                                            <span className="sr-only">{s.addAsSynonym}</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {misses.data.map(miss => (
                                        <tr key={miss.term} className="border-t border-slate-100">
                                            <td className="px-4 py-2 font-medium">{miss.term}</td>
                                            <td className="px-4 py-2">{digits(miss.count)}</td>
                                            <td className="hidden px-4 py-2 text-slate-600 sm:table-cell">
                                                {format.dateTime(miss.lastSearchedAt)}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {canEdit && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        onClick={() => add(`${miss.term}, `)}
                                                    >
                                                        {s.addAsSynonym}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <EmptyState
                            icon={<SearchX className="size-6" aria-hidden />}
                            title={s.noMisses}
                            body={s.noMissesBody}
                        />
                    )}
                </Card>
            </div>
        </>
    );
}
