import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, Card, CardBody, CardHeader } from './ui/misc';

export function WooCutover({
    sourceId,
    checked = [],
    reference,
}: {
    sourceId: string;
    checked?: string[];
    reference?: { pixelId?: string; shippingZones?: unknown; permalinks?: unknown };
}) {
    const { messages } = useI18n();
    const m = messages.migration;
    const client = useQueryClient();
    const [pairing, setPairing] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [steps, setSteps] = useState(checked);
    const [crawl, setCrawl] = useState<unknown>();
    const review = useQuery({
        queryKey: ['woo', 'urls', sourceId],
        enabled: !!sourceId,
        queryFn: () =>
            adminApi<{
                wooUrlReview: {
                    redirects: Array<{ id: string; path: string; target: string | null; hits: number }>;
                    misses: Array<{ id: string; path: string; hits: number }>;
                };
            }>('query($id:ID!){wooUrlReview(sourceId:$id)}', { id: sourceId }).then(r => r.wooUrlReview),
    });
    async function action(fn: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            setError(
                cause instanceof ApiError && cause.code === 'USER_INPUT_ERROR' ? cause.message : m.failed,
            );
        } finally {
            setBusy(false);
        }
    }
    return (
        <Card>
            <CardHeader title={m.helperTitle} />
            <CardBody>
                {error && <Alert tone="warning">{error}</Alert>}
                <p>{m.helperHint}</p>
                <form
                    className="space-y-3"
                    onSubmit={e => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        void action(async () => {
                            const result = await adminApi<{ createWooPairing: { pairing: string } }>(
                                'mutation($input:JSON!){createWooPairing(input:$input)}',
                                {
                                    input: {
                                        url: data.get('url'),
                                        imageHosts: String(data.get('hosts') || '')
                                            .split(',')
                                            .map(h => h.trim())
                                            .filter(Boolean),
                                    },
                                },
                            );
                            setPairing(result.createWooPairing.pairing);
                        });
                    }}
                >
                    <label>
                        {m.url}
                        <Input name="url" type="url" required />
                    </label>
                    <label>
                        {m.hosts}
                        <Input name="hosts" />
                    </label>
                    <Button type="submit" loading={busy}>
                        {m.createPairing}
                    </Button>
                </form>
                {pairing && (
                    <label>
                        {m.pairingDetails}
                        <textarea
                            aria-label={m.pairingDetails}
                            readOnly
                            value={pairing}
                            className="w-full border p-2"
                            rows={4}
                        />
                    </label>
                )}
                {sourceId && (
                    <div className="mt-5 space-y-4">
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                                void action(async () => {
                                    await adminApi('mutation($id:ID!){revokeWooHelper(sourceId:$id)}', {
                                        id: sourceId,
                                    });
                                    setPairing('');
                                })
                            }
                        >
                            {m.revokeHelper}
                        </Button>
                        <h3>{m.redirectTitle}</h3>
                        <form
                            className="space-y-2"
                            onSubmit={e => {
                                e.preventDefault();
                                const data = new FormData(e.currentTarget);
                                void action(async () => {
                                    await adminApi(
                                        'mutation($id:ID!,$path:String!,$target:String!){saveWooRedirect(sourceId:$id,path:$path,target:$target)}',
                                        { id: sourceId, path: data.get('path'), target: data.get('target') },
                                    );
                                });
                            }}
                        >
                            <label>
                                {m.oldPath}
                                <Input name="path" required placeholder="/old-page/" />
                            </label>
                            <label>
                                {m.targetPath}
                                <Input name="target" required placeholder="/product/example/" />
                            </label>
                            <Button type="submit" disabled={busy}>
                                {m.saveRedirect}
                            </Button>
                        </form>
                        <ul>
                            {review.data?.redirects.map(r => (
                                <li key={r.id}>
                                    {r.path} → {r.target ?? '410'} · {r.hits}
                                </li>
                            ))}
                        </ul>
                        <h3>{m.missingUrls}</h3>
                        <ul>
                            {review.data?.misses.map(r => (
                                <li key={r.id}>
                                    {r.path} · {r.hits}
                                </li>
                            ))}
                        </ul>
                        <h3>{m.crawler}</h3>
                        <form
                            className="space-y-2"
                            onSubmit={e => {
                                e.preventDefault();
                                const data = new FormData(e.currentTarget);
                                void action(async () => {
                                    const r = await adminApi<{ crawlWooSitemap: unknown }>(
                                        'mutation($id:ID!,$sitemap:String!,$destination:String!){crawlWooSitemap(sourceId:$id,sitemap:$sitemap,destination:$destination)}',
                                        {
                                            id: sourceId,
                                            sitemap: data.get('sitemap'),
                                            destination: data.get('destination'),
                                        },
                                    );
                                    setCrawl(r.crawlWooSitemap);
                                });
                            }}
                        >
                            <label>
                                {m.sitemap}
                                <Input name="sitemap" type="url" required />
                            </label>
                            <label>
                                {m.destination}
                                <Input name="destination" type="url" required />
                            </label>
                            <Button type="submit" disabled={busy}>
                                {m.runCrawl}
                            </Button>
                        </form>
                        {crawl !== undefined && (
                            <pre className="max-h-64 overflow-auto text-xs">
                                {JSON.stringify(crawl, null, 2)}
                            </pre>
                        )}
                        <h3>{m.cutoverTitle}</h3>
                        {reference && (
                            <details>
                                <summary>{m.sourceReference}</summary>
                                <p>
                                    {m.importedPixel}: {reference.pixelId || '—'}
                                </p>
                                <p>{m.referenceHint}</p>
                                <pre className="max-h-48 overflow-auto text-xs">
                                    {JSON.stringify(
                                        {
                                            shippingZones: reference.shippingZones,
                                            permalinks: reference.permalinks,
                                        },
                                        null,
                                        2,
                                    )}
                                </pre>
                            </details>
                        )}
                        <p>{m.cutoverHint}</p>
                        {Object.entries(m.cutoverSteps).map(([key, label]) => (
                            <label key={key} className="flex gap-2">
                                <input
                                    type="checkbox"
                                    checked={steps.includes(key)}
                                    onChange={e =>
                                        setSteps(
                                            e.target.checked ? [...steps, key] : steps.filter(s => s !== key),
                                        )
                                    }
                                />
                                {label}
                            </label>
                        ))}
                        <Button
                            disabled={busy}
                            onClick={() =>
                                void action(async () => {
                                    await adminApi(
                                        'mutation($id:ID!,$checked:[String!]!){saveWooCutover(sourceId:$id,checked:$checked)}',
                                        { id: sourceId, checked: steps },
                                    );
                                })
                            }
                        >
                            {m.saveChecklist}
                        </Button>
                        <form
                            className="space-y-2"
                            onSubmit={e => {
                                e.preventDefault();
                                const data = new FormData(e.currentTarget);
                                void action(async () => {
                                    const since = new Date(String(data.get('since'))).toISOString();
                                    const items: unknown[] = [];
                                    let total = 1;
                                    while (items.length < total) {
                                        const result = await adminApi<{
                                            wooRollbackOrders: { items: unknown[]; totalItems: number };
                                        }>(
                                            'query($since:DateTime!,$skip:Int){wooRollbackOrders(since:$since,skip:$skip)}',
                                            { since, skip: items.length },
                                        );
                                        total = result.wooRollbackOrders.totalItems;
                                        if (total > 5000) throw new Error('EXPORT_TOO_LARGE');
                                        items.push(...result.wooRollbackOrders.items);
                                        if (!result.wooRollbackOrders.items.length) break;
                                    }
                                    const url = URL.createObjectURL(
                                        new Blob([JSON.stringify({ since, orders: items }, null, 2)], {
                                            type: 'application/json',
                                        }),
                                    );
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = 'private-rollback-orders.json';
                                    link.click();
                                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                                });
                            }}
                        >
                            <p>{m.rollbackHint}</p>
                            <label>
                                {m.ordersSince}
                                <Input name="since" type="datetime-local" required />
                            </label>
                            <Button type="submit" disabled={busy}>
                                {m.exportRollback}
                            </Button>
                        </form>
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
