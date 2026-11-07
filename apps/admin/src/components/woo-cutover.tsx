import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { adminApi } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, Badge, Card, CardBody, CardHeader } from './ui/misc';
import {
    apiErrorMessage,
    crawlStatusLabel,
    readablePath,
    type CrawlResult,
    type SourceReference,
    type WooRedirect,
    zoneLocations,
} from './woo-migration-format';

const URL_REVIEW = 'query($id:ID!){wooUrlReview(sourceId:$id)}';
const SAVE_REDIRECT =
    'mutation($id:ID!,$path:String!,$target:String!){saveWooRedirect(sourceId:$id,path:$path,target:$target)}';
const DELETE_REDIRECT = 'mutation($id:ID!){wooDeleteRedirect(id:$id)}';

/** How many failing URLs a sitemap check lists before "and N more" (one check covers up to 2,000). */
const FAILING_SHOWN = 50;

/**
 * The WordPress helper pairing and everything around the switch-over (roadmap phase 22): old
 * address rules and the most-visited missing pages, the sitemap check, the old store's settings
 * for reference, the cutover checklist and the rollback export.
 */
export function WooCutover({
    sourceId,
    checked = [],
    reference,
    lastCrawl,
}: {
    sourceId: string;
    checked?: string[];
    reference?: SourceReference;
    lastCrawl?: CrawlResult;
}) {
    const { messages } = useI18n();
    const m = messages.migration;
    const client = useQueryClient();
    const confirm = useConfirm();
    const [pairing, setPairing] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [steps, setSteps] = useState(checked);
    const [crawl, setCrawl] = useState<CrawlResult | undefined>(lastCrawl);
    // The redirect form is controlled so a missing page's "Redirect" button can fill it in.
    const [redirectPath, setRedirectPath] = useState('');
    const [redirectTarget, setRedirectTarget] = useState('');
    const targetInput = useRef<HTMLInputElement>(null);
    const review = useQuery({
        queryKey: ['woo', 'urls', sourceId],
        enabled: !!sourceId,
        queryFn: () =>
            adminApi<{
                wooUrlReview: {
                    redirects: WooRedirect[];
                    misses: Array<{ id: string; path: string; hits: number }>;
                };
            }>(URL_REVIEW, { id: sourceId }).then(r => r.wooUrlReview),
    });
    const redirected = new Set(review.data?.redirects.map(rule => rule.path));
    async function action(fn: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            setError(apiErrorMessage(m, cause));
        } finally {
            setBusy(false);
        }
    }
    /** "Redirect" on a missing page: its path goes into the form, ready for the new address. */
    function redirectMissing(path: string) {
        setRedirectPath(path);
        setRedirectTarget('');
        // Focusing the new-address field also scrolls the form into view on a phone.
        targetInput.current?.focus();
    }
    async function removeRedirect(rule: WooRedirect) {
        const yes = await confirm({
            title: m.deleteRedirectTitle,
            body: m.deleteRedirectBody(readablePath(rule.path)),
            confirmLabel: messages.common.delete,
            danger: true,
        });
        if (yes)
            await action(async () => {
                await adminApi(DELETE_REDIRECT, { id: rule.id });
            });
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
                        <h3 className="font-medium">{m.redirectTitle}</h3>
                        <form
                            className="space-y-2"
                            onSubmit={e => {
                                e.preventDefault();
                                void action(async () => {
                                    await adminApi(SAVE_REDIRECT, {
                                        id: sourceId,
                                        path: redirectPath,
                                        target: redirectTarget,
                                    });
                                    setRedirectPath('');
                                    setRedirectTarget('');
                                });
                            }}
                        >
                            <label>
                                {m.oldPath}
                                <Input
                                    name="path"
                                    required
                                    placeholder="/old-page/"
                                    value={redirectPath}
                                    onChange={e => setRedirectPath(e.target.value)}
                                />
                            </label>
                            <label>
                                {m.targetPath}
                                <Input
                                    ref={targetInput}
                                    name="target"
                                    required
                                    placeholder="/product/example/"
                                    value={redirectTarget}
                                    onChange={e => setRedirectTarget(e.target.value)}
                                />
                            </label>
                            <Button type="submit" disabled={busy}>
                                {m.saveRedirect}
                            </Button>
                        </form>
                        <p className="text-sm text-slate-600">{m.editedByStaffHint}</p>
                        {review.data && review.data.redirects.length === 0 && (
                            <p className="text-sm text-slate-600">{m.noRedirects}</p>
                        )}
                        <ul className="divide-y divide-slate-100">
                            {review.data?.redirects.map(rule => (
                                <li key={rule.id} className="flex items-start justify-between gap-3 py-2">
                                    <div className="min-w-0 text-sm">
                                        {/* A rule with no target answers 410 Gone: the page was removed on purpose. */}
                                        <p className="break-all">
                                            {readablePath(rule.path)} →{' '}
                                            {rule.target ? readablePath(rule.target) : m.gone}
                                        </p>
                                        <p className="flex flex-wrap items-center gap-2 text-slate-600">
                                            {m.visits(rule.hits)}
                                            {rule.manual && <Badge tone="sky">{m.editedByStaff}</Badge>}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="shrink-0"
                                        disabled={busy}
                                        aria-label={m.deleteRedirectLabel(readablePath(rule.path))}
                                        onClick={() => void removeRedirect(rule)}
                                    >
                                        {messages.common.delete}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                        <h3 className="font-medium">{m.missingUrls}</h3>
                        <p className="text-sm text-slate-600">{m.missingHint}</p>
                        {review.data && review.data.misses.length === 0 && (
                            <p className="text-sm text-slate-600">{m.noMisses}</p>
                        )}
                        <ul className="divide-y divide-slate-100">
                            {review.data?.misses.map(miss => (
                                <li key={miss.id} className="flex items-center justify-between gap-3 py-2">
                                    <div className="min-w-0 text-sm">
                                        <p className="break-all">{readablePath(miss.path)}</p>
                                        <p className="text-slate-600">{m.visits(miss.hits)}</p>
                                    </div>
                                    {/* A path counted before its rule was saved stays in the list; don't offer it twice. */}
                                    {redirected.has(miss.path) ? (
                                        <span className="shrink-0 text-sm text-slate-600">{m.hasRule}</span>
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="shrink-0"
                                            aria-label={m.redirectMissLabel(readablePath(miss.path))}
                                            onClick={() => redirectMissing(readablePath(miss.path))}
                                        >
                                            {m.redirectMiss}
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <h3 className="font-medium">{m.crawler}</h3>
                        <form
                            className="space-y-2"
                            onSubmit={e => {
                                e.preventDefault();
                                const data = new FormData(e.currentTarget);
                                void action(async () => {
                                    const r = await adminApi<{ crawlWooSitemap: CrawlResult }>(
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
                        {crawl && <CrawlReport crawl={crawl} />}
                        <h3 className="font-medium">{m.cutoverTitle}</h3>
                        {reference && <SourceSettings reference={reference} />}
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

/**
 * The sitemap check in words: did every old URL open, which ones didn't (path and why), and
 * whether the check was cut short (then "all passed" only covers what was checked).
 */
function CrawlReport({ crawl }: { crawl: CrawlResult }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const format = useFormat();
    const results = crawl.results ?? [];
    const failing = results.filter(result => !result.ok);
    const checked = crawl.checked ?? results.length;
    return (
        <div className="space-y-2 text-sm">
            {checked === 0 ? (
                <Alert tone="warning">{m.crawlEmpty}</Alert>
            ) : failing.length === 0 ? (
                <Alert>{m.crawlPassed(checked)}</Alert>
            ) : (
                <Alert tone="warning">{m.crawlFailed(failing.length, checked)}</Alert>
            )}
            {crawl.truncated && <Alert tone="warning">{m.crawlTruncated}</Alert>}
            {crawl.at && (
                <p className="text-xs text-slate-500">{m.crawlCheckedAt(format.dateTime(crawl.at))}</p>
            )}
            {failing.length > 0 && (
                <>
                    <h4 className="font-medium">{m.failingUrls}</h4>
                    <ul className="divide-y divide-slate-100">
                        {failing.slice(0, FAILING_SHOWN).map(result => (
                            <li key={result.path} className="flex justify-between gap-3 py-1.5">
                                <span className="min-w-0 break-all">{readablePath(result.path)}</span>
                                {/* At most half the row, so a long Bangla reason wraps instead of squeezing the path. */}
                                <span className="max-w-1/2 shrink-0 text-right text-slate-600">
                                    {crawlStatusLabel(m, result.status)}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {failing.length > FAILING_SHOWN && (
                        <p className="text-slate-600">{m.more(failing.length - FAILING_SHOWN)}</p>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * The old store's settings kept for reference (from the helper upload), as short lists: the Meta
 * Pixel ID, whether prices included tax, the shipping zones and the old link format. Folded away,
 * because it's only needed while setting up delivery, payments and tracking here.
 */
function SourceSettings({ reference }: { reference: SourceReference }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const zones = reference.shippingZones ?? [];
    const permalinks = reference.permalinks ?? {};
    const redirects = reference.redirects?.length ?? 0;
    return (
        <details className="rounded-md border border-slate-200 text-sm">
            <summary className="cursor-pointer px-3 py-2">{m.sourceReference}</summary>
            <div className="space-y-3 border-t border-slate-200 p-3">
                <p>
                    {m.importedPixel}: {reference.pixelId || '—'}
                </p>
                {typeof reference.pricesIncludeTax === 'boolean' && (
                    <p>
                        {m.pricesIncludedTax}: {reference.pricesIncludeTax ? m.yes : m.no}
                    </p>
                )}
                <p className="text-slate-600">{m.referenceHint}</p>
                <div>
                    <h4 className="font-medium">{m.shippingZones}</h4>
                    {zones.length === 0 ? (
                        <p className="text-slate-600">{m.noShippingZones}</p>
                    ) : (
                        <ul className="space-y-1">
                            {zones.map((zone, index) => {
                                const locations = zoneLocations(m, zone.locations);
                                return (
                                    <li key={String(zone.id ?? index)}>
                                        <span className="font-medium">{zone.name || '—'}</span>
                                        <span className="block text-slate-600">
                                            {locations.length ? locations.join(' · ') : m.zoneNoLocations}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <div>
                    <h4 className="font-medium">{m.permalinks}</h4>
                    <dl className="space-y-0.5">
                        {Object.entries(m.permalinkKinds).map(([key, label]) => (
                            <div key={key} className="flex flex-wrap justify-between gap-x-3">
                                <dt className="text-slate-600">{label}</dt>
                                {/* An empty base means WooCommerce's own (/product/, /product-category/…). */}
                                <dd className="break-all">{permalinks[key] || m.permalinkDefault}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
                {redirects > 0 && <p>{m.importedRedirects(redirects)}</p>}
            </div>
        </details>
    );
}
