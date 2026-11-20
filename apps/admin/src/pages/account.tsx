import { dhakaDateKey } from '@ecommbd/shared/time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Field } from '../components/form/field';
import { TakaInput } from '../components/form/inputs';
import type { ActionItem } from '../components/ui/action-menu';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input, Select, Textarea } from '../components/ui/input';
import { Page } from '../components/ui/layout';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { SaveBar } from '../components/ui/save-bar';
import { ApiError, adminApi } from '../lib/api';
import { errorMap } from '../lib/form';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDraft } from '../lib/use-draft';

type Kind = 'cash' | 'bank' | 'wallet' | 'courier';

interface Draft {
    name: string;
    kind: Kind;
    openingBalance: number | null;
}

interface AccountRow {
    id: string;
    name: string;
    kind: Kind;
    openingBalance: number;
    balance: number;
}

interface Movement {
    id: string;
    date: string;
    direction: string;
    amount: number;
    source: 'order' | 'purchase' | 'expense' | 'transfer' | 'manual';
    note: string;
}

const empty = (): Draft => ({ name: '', kind: 'cash', openingBalance: 0 });

/** One account: name, kind, opening balance, and the latest movements (phase 53). */
export function AccountPage() {
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const { messages: m } = useI18n();
    const a = m.accounts;
    const format = useFormat();
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['account', id],
        enabled: !isNew,
        queryFn: () =>
            adminApi<{ bdAccount: AccountRow | null; bdTransactions: { items: Movement[] } }>(
                `query ($id: ID!) {
                    bdAccount(id: $id) { id name kind openingBalance balance }
                    bdTransactions(accountId: $id, take: 8) { items { id date direction amount source note } }
                }`,
                { id },
            ),
    });
    const { draft, setDraft, load, dirty, discard } = useDraft<Draft>(isNew ? empty() : null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [dialog, setDialog] = useState<'transfer' | 'manual' | null>(null);
    useEffect(() => {
        if (query.data?.bdAccount && !draft) {
            const row = query.data.bdAccount;
            load({ name: row.name, kind: row.kind, openingBalance: row.openingBalance });
        }
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: Draft) =>
            adminApi<{
                saveBdAccount: {
                    account: { id: string } | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(
                `mutation ($id: ID, $input: JSON!) {
                    saveBdAccount(id: $id, input: $input) { account { id } errors { path code } }
                }`,
                { id: isNew ? null : id, input },
            ).then(result => result.saveBdAccount),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.account) {
                load(draft!);
                toast.success(a.saved);
                void queryClient.invalidateQueries({ queryKey: ['accounts'] });
                if (isNew) navigate(`/accounts/${result.account.id}`, { replace: true });
                else void queryClient.invalidateQueries({ queryKey: ['account', id] });
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft || (!isNew && query.isLoading)) return <PageSkeleton />;
    if (!isNew && query.data && !query.data.bdAccount) return <PageSkeleton />;
    const menu: ActionItem[] = isNew
        ? []
        : [
              { label: a.transfer, onSelect: () => setDialog('transfer') },
              { label: a.manual, onSelect: () => setDialog('manual') },
          ];
    return (
        <Page width="narrow">
            <PageHeader
                title={isNew ? a.newTitle : draft.name || a.formTitle}
                description={a.formDescription}
                back={{ to: '/accounts', label: a.listTitle }}
                menu={menu}
            />
            {!isNew && query.data?.bdAccount && (
                <p className="mb-4 text-sm text-ink-muted">
                    {a.balance}:{' '}
                    <span className="font-semibold text-ink">
                        {format.money(query.data.bdAccount.balance)}
                    </span>
                </p>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    if (draft.openingBalance == null) {
                        setErrors({ openingBalance: 'invalid' });
                        return;
                    }
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardBody>
                        <div className="space-y-4">
                            <Field label={a.name} error={errors.name}>
                                {control => (
                                    <Input
                                        {...control}
                                        value={draft.name}
                                        onChange={event => setDraft({ ...draft, name: event.target.value })}
                                    />
                                )}
                            </Field>
                            <Field label={a.kind} error={errors.kind}>
                                {control => (
                                    <Select
                                        {...control}
                                        value={draft.kind}
                                        onChange={event =>
                                            setDraft({ ...draft, kind: event.target.value as Kind })
                                        }
                                    >
                                        {(Object.keys(a.kinds) as Kind[]).map(kind => (
                                            <option key={kind} value={kind}>
                                                {a.kinds[kind]}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </Field>
                            <Field label={a.opening} hint={a.openingHint} error={errors.openingBalance}>
                                {control => (
                                    <TakaInput
                                        {...control}
                                        value={draft.openingBalance}
                                        onChange={openingBalance => setDraft({ ...draft, openingBalance })}
                                    />
                                )}
                            </Field>
                        </div>
                    </CardBody>
                </Card>
                <SaveBar dirty={dirty} saving={save.isPending} onDiscard={isNew ? undefined : discard} />
            </form>
            {!isNew && (
                <Card className="mt-4">
                    <CardHeader title={a.recent} />
                    <CardBody>
                        {(query.data?.bdTransactions.items.length ?? 0) === 0 ? (
                            <p className="text-sm text-ink-muted">{a.noMovements}</p>
                        ) : (
                            <ul className="divide-y divide-line text-sm">
                                {query.data?.bdTransactions.items.map(row => (
                                    <li
                                        key={row.id}
                                        className="flex items-baseline justify-between gap-3 py-2"
                                    >
                                        <span>
                                            {format.date(`${row.date}T06:00:00Z`)} · {a.sources[row.source]}
                                            {row.note ? (
                                                <span className="text-ink-muted"> · {row.note}</span>
                                            ) : null}
                                        </span>
                                        <span className="tabular-nums">
                                            {row.direction === 'out' ? '−' : ''}
                                            {format.money(row.amount)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>
            )}
            {dialog && id && (
                <MovementDialog
                    mode={dialog}
                    accountId={id}
                    onClose={() => setDialog(null)}
                    onSaved={() => {
                        setDialog(null);
                        void queryClient.invalidateQueries({ queryKey: ['account', id] });
                        void queryClient.invalidateQueries({ queryKey: ['accounts'] });
                    }}
                />
            )}
        </Page>
    );
}

function MovementDialog({
    mode,
    accountId,
    onClose,
    onSaved,
}: {
    mode: 'transfer' | 'manual';
    accountId: string;
    onClose(): void;
    onSaved(): void;
}) {
    const { messages: m } = useI18n();
    const a = m.accounts;
    const toast = useToast();
    const accounts = useQuery({
        queryKey: ['accountOptions'],
        queryFn: () =>
            adminApi<{ bdAccounts: { items: Array<{ id: string; name: string }> } }>(
                `{ bdAccounts(take: 100) { items { id name } } }`,
            ).then(result => result.bdAccounts.items),
    });
    const [amount, setAmount] = useState<number | null>(null);
    const [day, setDay] = useState(dhakaDateKey(new Date()));
    const [note, setNote] = useState('');
    const [to, setTo] = useState('');
    const [direction, setDirection] = useState<'in' | 'out'>('out');
    const save = useMutation({
        mutationFn: () => {
            if (mode === 'transfer') {
                return adminApi(`mutation ($input: JSON!) { transferBdMoney(input: $input) { id } }`, {
                    input: { fromAccountId: accountId, toAccountId: to, amount, day, note },
                });
            }
            return adminApi(`mutation ($input: JSON!) { recordBdManualEntry(input: $input) { id } }`, {
                input: { accountId, direction, amount, day, note },
            });
        },
        onSuccess: () => {
            toast.success(mode === 'transfer' ? a.transferSaved : a.manualSaved);
            onSaved();
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : m.errors.generic),
    });
    const others = (accounts.data ?? []).filter(account => account.id !== accountId);
    return (
        <Dialog
            open
            onClose={onClose}
            title={mode === 'transfer' ? a.transfer : a.manual}
            footer={
                <Button
                    type="button"
                    disabled={!amount || (mode === 'transfer' && !to) || save.isPending}
                    onClick={() => save.mutate()}
                >
                    {m.common.save}
                </Button>
            }
        >
            <div className="space-y-4">
                {mode === 'transfer' ? (
                    <Field label={a.to}>
                        {control => (
                            <Select {...control} value={to} onChange={event => setTo(event.target.value)}>
                                <option value="">{a.none}</option>
                                {others.map(account => (
                                    <option key={account.id} value={account.id}>
                                        {account.name}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                ) : (
                    <Field label={a.direction}>
                        {control => (
                            <Select
                                {...control}
                                value={direction}
                                onChange={event => setDirection(event.target.value as 'in' | 'out')}
                            >
                                <option value="in">{a.in}</option>
                                <option value="out">{a.out}</option>
                            </Select>
                        )}
                    </Field>
                )}
                <Field label={a.amount}>
                    {control => <TakaInput {...control} value={amount} onChange={setAmount} />}
                </Field>
                <Field label={a.date}>
                    {control => (
                        <Input
                            {...control}
                            type="date"
                            value={day}
                            onChange={event => setDay(event.target.value)}
                        />
                    )}
                </Field>
                <Field label={a.note} optional>
                    {control => (
                        <Textarea {...control} value={note} onChange={event => setNote(event.target.value)} />
                    )}
                </Field>
            </div>
        </Dialog>
    );
}
