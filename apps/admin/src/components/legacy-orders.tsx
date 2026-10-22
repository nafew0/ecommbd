import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, Card, CardBody, CardHeader } from './ui/misc';
interface Legacy {
    id: string;
    number: string;
    status: string;
    currency: string;
    total: string;
    liveOrderId?: string;
    snapshot?: Record<string, unknown>;
}
const exactAmount = (minor: string) => {
    const sign = minor.startsWith('-') ? '-' : '';
    const digits = minor.replace(/^-/, '').padStart(3, '0');
    return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
export function LegacyOrders({ sourceId, customerId }: { sourceId?: string; customerId?: string }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const { can } = useAuth();
    const client = useQueryClient();
    const [search, setSearch] = useState('');
    const [skip, setSkip] = useState(0);
    const [selected, setSelected] = useState('');
    const [frozen, setFrozen] = useState(false);
    const [reduced, setReduced] = useState(false);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const [live, setLive] = useState('');
    const query = useQuery({
        queryKey: ['woo', 'history', sourceId, customerId, search, skip],
        queryFn: () =>
            adminApi<{ wooLegacyOrders: { items: Legacy[]; totalItems: number } }>(
                'query($sourceId:ID,$customerId:ID,$search:String,$skip:Int){wooLegacyOrders(sourceId:$sourceId,customerId:$customerId,search:$search,skip:$skip,take:10)}',
                { sourceId, customerId, search, skip },
            ).then(r => r.wooLegacyOrders),
    });
    const detail = useQuery({
        queryKey: ['woo', 'legacy', selected],
        enabled: !!selected,
        queryFn: () =>
            adminApi<{ wooLegacyOrder: Legacy }>('query($id:ID!){wooLegacyOrder(id:$id)}', {
                id: selected,
            }).then(r => r.wooLegacyOrder),
    });
    async function convert() {
        setBusy(true);
        setError(false);
        try {
            const result = await adminApi<{ convertWooOpenOrder: { id: string } }>(
                'mutation($legacyId:ID!,$input:JSON!){convertWooOpenOrder(legacyId:$legacyId,input:$input){id}}',
                { legacyId: selected, input: { sourceFrozen: frozen, inventoryAlreadyReduced: reduced } },
            );
            setLive(result.convertWooOpenOrder.id);
            await client.invalidateQueries({ queryKey: ['woo', 'history'] });
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Card>
            <CardHeader title={m.legacyTitle} />
            <CardBody>
                <p className="text-sm text-slate-600">{m.legacyIntro}</p>
                <Input
                    aria-label={m.search}
                    placeholder={m.search}
                    value={search}
                    onChange={e => {
                        setSearch(e.target.value);
                        setSkip(0);
                    }}
                />
                {(query.isError || detail.isError || error) && <Alert tone="warning">{m.failed}</Alert>}
                <ul className="divide-y">
                    {query.data?.items.map(order => (
                        <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={order.id}>
                            <span>
                                #{order.number} · {order.status} · {order.currency} {exactAmount(order.total)}
                            </span>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setSelected(order.id);
                                    setFrozen(false);
                                    setReduced(false);
                                    setLive('');
                                }}
                            >
                                {m.details}
                            </Button>
                        </li>
                    ))}
                </ul>
                {!query.data?.items.length && <p>{m.empty}</p>}
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        disabled={skip === 0}
                        onClick={() => setSkip(Math.max(0, skip - 10))}
                    >
                        {m.previous}
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={skip + 10 >= (query.data?.totalItems ?? 0)}
                        onClick={() => setSkip(skip + 10)}
                    >
                        {m.next}
                    </Button>
                </div>
                {selected && detail.data && (
                    <div className="space-y-3 border-t pt-3">
                        <Button variant="ghost" onClick={() => setSelected('')}>
                            {m.close}
                        </Button>
                        <h3>
                            {m.snapshot} #{detail.data.number}
                        </h3>
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(detail.data.snapshot, null, 2)}
                        </pre>
                        {can('RunMigration') &&
                            !detail.data.liveOrderId &&
                            ['pending', 'processing', 'on-hold'].includes(detail.data.status) && (
                                <>
                                    <p>{m.conversionHint}</p>
                                    <label className="flex gap-2">
                                        <input
                                            type="checkbox"
                                            checked={frozen}
                                            onChange={e => setFrozen(e.target.checked)}
                                        />
                                        {m.frozen}
                                    </label>
                                    <label className="flex gap-2">
                                        <input
                                            type="checkbox"
                                            checked={reduced}
                                            onChange={e => setReduced(e.target.checked)}
                                        />
                                        {m.reduced}
                                    </label>
                                    <Button disabled={!frozen} loading={busy} onClick={() => void convert()}>
                                        {m.open}
                                    </Button>
                                </>
                            )}
                        {live && (
                            <Link className="underline" to={`/orders/${live}`}>
                                {m.converted} {m.active}
                            </Link>
                        )}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
