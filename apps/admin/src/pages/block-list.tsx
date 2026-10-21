import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldBan } from 'lucide-react';
import { useState } from 'react';
import { BLOCK, UNBLOCK, UnblockDialog } from '../components/block-dialogs';
import { Field } from '../components/form/field';
import { DhakaDateTimeInput } from '../components/form/inputs';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';
import type { Messages } from '../messages/en';

const PAGE_SIZE = 30;

const LIST = `
    query Blocked($search: String, $skip: Int, $take: Int) {
        bdBlockList(search: $search, skip: $skip, take: $take) {
            totalItems
            items { id createdAt kind value expiresAt note addedBy }
        }
    }
`;
type BlockError = keyof Messages['blockList']['errors'];

export interface BlockRow {
    id: string;
    createdAt: string;
    kind: 'phone' | 'ip';
    value: string;
    expiresAt: string | null;
    note: string;
    addedBy: string;
}

/**
 * The block list (roadmap phase 11): phones (for good or until a date) and IPs (30 days at most,
 * with the carrier-NAT warning). Blocked shoppers see a polite "not available"; staff can still
 * enter their orders. Unblocking asks why, and keeps it.
 */
export function BlockListPage() {
    const { messages: m } = useI18n();
    const t = m.blockList;
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateCustomer');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [kind, setKind] = useState<'phone' | 'ip'>('phone');
    const [value, setValue] = useState('');
    const [until, setUntil] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [error, setError] = useState<BlockError | null>(null);
    const [unblocking, setUnblocking] = useState<BlockRow | null>(null);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['blockList', term, page],
        queryFn: () =>
            adminApi<{ bdBlockList: { totalItems: number; items: BlockRow[] } }>(LIST, {
                search: term || null,
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }).then(result => result.bdBlockList),
        placeholderData: keepPreviousData,
    });
    const block = useMutation({
        mutationFn: () =>
            adminApi<{ blockBdContact: { entry: { id: string } | null; error: BlockError | null } }>(BLOCK, {
                input: { kind, value, expiresAt: until, note: note.trim() || null },
            }).then(result => result.blockBdContact),
        onSuccess: result => {
            setError(result.error);
            if (result.entry) {
                toast.success(t.blocked);
                setValue('');
                setUntil(null);
                setNote('');
                void queryClient.invalidateQueries({ queryKey: ['blockList'] });
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    const columns: Column<BlockRow>[] = [
        {
            key: 'value',
            header: t.columns.value,
            cell: row => (
                <div>
                    <div className="font-medium tabular-nums">{row.kind === 'phone' ? format.phone(row.value) : row.value}</div>
                    <div className="text-sm text-slate-600">{t.kinds[row.kind]}</div>
                </div>
            ),
        },
        {
            key: 'until',
            header: t.columns.until,
            cell: row => (row.expiresAt ? format.dateTime(row.expiresAt) : t.forever),
        },
        { key: 'note', header: t.columns.note, cell: row => row.note, hideOnMobile: true },
        {
            key: 'addedBy',
            header: t.columns.addedBy,
            cell: row => `${row.addedBy} · ${format.date(row.createdAt)}`,
            hideOnMobile: true,
        },
        {
            key: 'actions',
            header: '',
            cell: row =>
                canEdit ? (
                    <Button size="sm" variant="secondary" onClick={() => setUnblocking(row)}>
                        {t.unblock}
                    </Button>
                ) : null,
        },
    ];
    return (
        <>
            <PageHeader title={t.title} description={t.description} />
            {canEdit && (
                <Card className="mb-4">
                    <CardHeader title={t.add} />
                    <CardBody>
                        <form
                            className="space-y-4"
                            onSubmit={event => {
                                event.preventDefault();
                                block.mutate();
                            }}
                        >
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={t.kind}>
                                    {control => (
                                        <Select
                                            {...control}
                                            value={kind}
                                            onChange={event => {
                                                setKind(event.target.value as 'phone' | 'ip');
                                                setError(null);
                                            }}
                                        >
                                            <option value="phone">{t.kinds.phone}</option>
                                            <option value="ip">{t.kinds.ip}</option>
                                        </Select>
                                    )}
                                </Field>
                                <Field label={t.value}>
                                    {control => (
                                        <Input
                                            {...control}
                                            inputMode={kind === 'phone' ? 'tel' : 'text'}
                                            value={value}
                                            onChange={event => setValue(event.target.value)}
                                        />
                                    )}
                                </Field>
                                <Field
                                    label={t.until}
                                    hint={kind === 'ip' ? t.untilHintIp : t.untilHintPhone}
                                    optional={kind === 'phone'}
                                >
                                    {control => <DhakaDateTimeInput {...control} value={until} onChange={setUntil} />}
                                </Field>
                                <Field label={t.note} optional>
                                    {control => (
                                        <Textarea
                                            {...control}
                                            rows={2}
                                            maxLength={500}
                                            placeholder={t.notePlaceholder}
                                            value={note}
                                            onChange={event => setNote(event.target.value)}
                                        />
                                    )}
                                </Field>
                            </div>
                            {error && <Alert tone="warning">{t.errors[error]}</Alert>}
                            <Button type="submit" variant="danger" loading={block.isPending} disabled={!value.trim()}>
                                {t.block}
                            </Button>
                        </form>
                    </CardBody>
                </Card>
            )}
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                search={{
                    value: search,
                    onChange: next => {
                        setSearch(next);
                        setPage(1);
                    },
                    placeholder: t.search,
                }}
                pagination={{ page, pageSize: PAGE_SIZE, total: query.data?.totalItems ?? 0, onChange: setPage }}
                empty={<EmptyState icon={<ShieldBan aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />}
            />
            <UnblockDialog
                open={Boolean(unblocking)}
                onClose={() => setUnblocking(null)}
                onUnblock={async reason => {
                    try {
                        await adminApi(UNBLOCK, { id: unblocking!.id, reason });
                        toast.success(t.unblocked);
                        setUnblocking(null);
                        void queryClient.invalidateQueries({ queryKey: ['blockList'] });
                    } catch {
                        toast.error(m.errors.generic);
                    }
                }}
            />
        </>
    );
}
