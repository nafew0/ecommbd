import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquare, Phone, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Page } from '../components/ui/layout';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const PAGE_SIZE = 25;

const LIST = `
    query Messages($skip: Int, $take: Int, $handled: Boolean) {
        bdContactMessages(skip: $skip, take: $take, handled: $handled) {
            totalItems
            items { id createdAt name phone message page handled }
        }
        bdContactMessagesWaiting
    }
`;

interface Row {
    id: string;
    createdAt: string;
    name: string;
    phone: string;
    message: string;
    page: string;
    handled: boolean;
}

type Tab = 'waiting' | 'done' | 'all';

/**
 * Messages from the contact form element (roadmap phase 61): who wrote, their number and what
 * they said. One press to call or to open WhatsApp, one to mark it answered.
 */
export function ContactMessagesPage() {
    const { messages: m } = useI18n();
    const t = m.contactMessages;
    const format = useFormat();
    const { can } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateCustomer');
    const [tab, setTab] = useState<Tab>('waiting');
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ['contactMessages', tab, page],
        queryFn: () =>
            adminApi<{
                bdContactMessages: { totalItems: number; items: Row[] };
                bdContactMessagesWaiting: number;
            }>(LIST, {
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
                handled: tab === 'all' ? null : tab === 'done',
            }),
        placeholderData: keepPreviousData,
    });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contactMessages'] });
    const setHandled = useMutation({
        mutationFn: (input: { id: string; handled: boolean }) =>
            adminApi(
                `mutation ($id: ID!, $handled: Boolean!) { setBdContactMessageHandled(id: $id, handled: $handled) }`,
                input,
            ),
        onSuccess: (_result, input) => {
            toast.success(input.handled ? t.markedDone : t.markedWaiting);
            refresh();
        },
        onError: () => toast.error(m.errors.generic),
    });
    const remove = useMutation({
        mutationFn: (id: string) =>
            adminApi(`mutation ($id: ID!) { deleteBdContactMessage(id: $id) }`, { id }),
        onSuccess: () => {
            toast.success(t.deleted);
            refresh();
        },
        onError: () => toast.error(m.errors.generic),
    });
    const columns: Column<Row>[] = [
        {
            key: 'from',
            header: t.columns.from,
            cell: row => (
                <div>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-sm text-ink-muted tabular-nums">{format.phone(row.phone)}</div>
                </div>
            ),
        },
        {
            key: 'message',
            header: t.columns.message,
            cell: row => (
                <div className="max-w-xl">
                    <p className="break-words whitespace-pre-line">{row.message || t.noMessage}</p>
                    {row.page && (
                        <p className="mt-1 text-sm text-ink-muted">{`${t.fromPage}: ${row.page}`}</p>
                    )}
                </div>
            ),
        },
        {
            key: 'when',
            header: t.columns.when,
            hideOnMobile: true,
            cell: row => <span className="text-ink-muted">{format.dateTime(row.createdAt)}</span>,
        },
        {
            key: 'actions',
            header: '',
            cell: row => (
                <div className="flex flex-wrap justify-end gap-2">
                    <a
                        href={`tel:${row.phone}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 text-sm font-medium hover:bg-surface-muted"
                    >
                        <Phone className="size-4" aria-hidden /> {t.call}
                    </a>
                    <a
                        href={`https://wa.me/${row.phone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center rounded border border-line-strong px-2.5 text-sm font-medium hover:bg-surface-muted"
                    >
                        WhatsApp
                    </a>
                    {canEdit && (
                        <>
                            <Button
                                size="sm"
                                variant={row.handled ? 'secondary' : 'primary'}
                                onClick={() => setHandled.mutate({ id: row.id, handled: !row.handled })}
                            >
                                {row.handled ? (
                                    <RotateCcw className="size-4" aria-hidden />
                                ) : (
                                    <Check className="size-4" aria-hidden />
                                )}
                                {row.handled ? t.markWaiting : t.markDone}
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                aria-label={`${t.delete}: ${row.name}`}
                                title={t.delete}
                                onClick={() => {
                                    if (window.confirm(t.deleteConfirm)) remove.mutate(row.id);
                                }}
                            >
                                <Trash2 className="size-4" aria-hidden />
                            </Button>
                        </>
                    )}
                </div>
            ),
        },
    ];
    const data = query.data?.bdContactMessages;
    return (
        <Page width="full">
            <PageHeader title={t.title} description={t.description} />
            <ListPage
                rows={data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isLoading}
                tabs={{
                    items: [
                        {
                            key: 'waiting',
                            label: t.tabs.waiting,
                            count: query.data?.bdContactMessagesWaiting,
                        },
                        { key: 'done', label: t.tabs.done },
                        { key: 'all', label: t.tabs.all },
                    ],
                    active: tab,
                    onChange: key => {
                        setTab(key as Tab);
                        setPage(1);
                    },
                }}
                pagination={{ page, pageSize: PAGE_SIZE, total: data?.totalItems ?? 0, onChange: setPage }}
                empty={
                    <EmptyState
                        icon={<MessageSquare className="size-6" aria-hidden />}
                        title={tab === 'waiting' ? t.emptyWaiting : t.empty}
                        body={t.emptyBody}
                    />
                }
            />
        </Page>
    );
}
