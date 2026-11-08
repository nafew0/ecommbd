import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { adminApi, adminUpload } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
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
const IMPORT_FILE =
    'mutation($input:[WooFileInput!]!,$hosts:[String!]){importWooFile(input:$input,imageHosts:$hosts)}';

/** How many failing URLs a sitemap check lists before "and N more" (one check covers up to 2,000). */
const FAILING_SHOWN = 50;

/** Busy state and an error message for one block's buttons. */
function useAction() {
    const { messages } = useI18n();
    const client = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function run(fn: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            setError(apiErrorMessage(messages.migration, cause));
        } finally {
            setBusy(false);
        }
    }
    return { busy, error, run };
}

const hostList = (value: FormDataEntryValue | null) =>
    String(value || '')
        .split(',')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean);

/** Numbered instructions for one way of connecting. */
function Steps({ items }: { items: readonly string[] }) {
    return (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {items.map(item => (
                <li key={item}>{item}</li>
            ))}
        </ol>
    );
}

/** "More options": the extra image hosts, which most stores never need. */
function MoreOptions({ name }: { name: string }) {
    const { messages } = useI18n();
    const m = messages.migration;
    return (
        <details className="rounded-md border border-slate-200 text-sm">
            <summary className="cursor-pointer px-3 py-2">{m.flow.moreOptions}</summary>
            <div className="space-y-1 border-t border-slate-200 p-3">
                <label>
                    {m.hosts}
                    <Input name={name} />
                </label>
                <p className="text-slate-600">{m.flow.hostsHint}</p>
            </div>
        </details>
    );
}

type Method = 'helper' | 'file' | 'rest';

/**
 * Step 1: connect the old store, one of three ways, each with its own short instructions: the
 * WordPress helper pairing (recommended), its export file for sites that can't reach us, or
 * WooCommerce REST API keys.
 */
export function WooConnect({ onConnected }: { onConnected: (sourceId: string, message: string) => void }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const f = m.flow;
    const { busy, error, run } = useAction();
    const [method, setMethod] = useState<Method>('helper');
    const [pairing, setPairing] = useState('');
    /** Share of the export file uploaded so far, while it uploads. */
    const [progress, setProgress] = useState<number | null>(null);
    return (
        <Card>
            <CardHeader title={f.connectTitle} />
            <CardBody className="space-y-4">
                <p className="text-sm text-slate-600">{f.connectIntro}</p>
                <div role="radiogroup" aria-label={f.connectTitle} className="grid gap-2 sm:grid-cols-3">
                    {(['helper', 'file', 'rest'] as const).map(key => (
                        <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={method === key}
                            onClick={() => setMethod(key)}
                            className={`rounded-md border p-3 text-left transition-colors ${
                                method === key
                                    ? 'border-teal-700 bg-teal-50 ring-1 ring-teal-700'
                                    : 'border-slate-200 hover:border-slate-400'
                            }`}
                        >
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                                {f.methods[key].title}
                                {key === 'helper' && <Badge tone="green">{f.methods.helper.badge}</Badge>}
                            </span>
                            <span className="mt-1 block text-sm text-slate-600">{f.methods[key].hint}</span>
                        </button>
                    ))}
                </div>
                {error && <Alert tone="warning">{error}</Alert>}
                {method === 'helper' && (
                    <form
                        className="space-y-3"
                        onSubmit={e => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            void run(async () => {
                                const result = await adminApi<{ createWooPairing: { pairing: string } }>(
                                    'mutation($input:JSON!){createWooPairing(input:$input)}',
                                    {
                                        input: {
                                            url: data.get('url'),
                                            imageHosts: hostList(data.get('hosts')),
                                        },
                                    },
                                );
                                setPairing(result.createWooPairing.pairing);
                            });
                        }}
                    >
                        <Steps items={f.helperSteps} />
                        <label>
                            {m.url}
                            <Input name="url" type="url" required placeholder="https://shop.example.com" />
                        </label>
                        <MoreOptions name="hosts" />
                        <Button type="submit" loading={busy}>
                            {m.createPairing}
                        </Button>
                        {pairing && (
                            <label>
                                {m.pairingDetails}
                                <textarea
                                    aria-label={m.pairingDetails}
                                    readOnly
                                    value={pairing}
                                    onFocus={e => e.currentTarget.select()}
                                    className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                                    rows={4}
                                />
                            </label>
                        )}
                    </form>
                )}
                {method === 'file' && (
                    <form
                        className="space-y-3"
                        onSubmit={e => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            const file = data.get('file');
                            if (!(file instanceof File) || file.size === 0) return;
                            void run(async () => {
                                try {
                                    const result = await adminUpload<{
                                        importWooFile: { sourceId: string; counts: Record<string, number> };
                                    }>(IMPORT_FILE, file, setProgress, {
                                        hosts: hostList(data.get('fileHosts')),
                                    });
                                    const { sourceId, counts } = result.importWooFile;
                                    onConnected(
                                        String(sourceId),
                                        m.fileImported(
                                            counts.products ?? 0,
                                            counts.customers ?? 0,
                                            counts.orders ?? 0,
                                        ),
                                    );
                                } finally {
                                    setProgress(null);
                                }
                            });
                        }}
                    >
                        <Steps items={f.fileSteps} />
                        <label>
                            {m.exportFile}
                            <Input name="file" type="file" accept=".jsonl,.gz,application/gzip" required />
                        </label>
                        <MoreOptions name="fileHosts" />
                        <Button type="submit" loading={busy}>
                            {m.importFile}
                        </Button>
                        {progress !== null && (
                            <p role="status">{m.fileUploading(Math.round(progress * 100))}</p>
                        )}
                    </form>
                )}
                {method === 'rest' && (
                    <form
                        className="space-y-3"
                        onSubmit={e => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const data = new FormData(form);
                            void run(async () => {
                                const { connectWooSource: s } = await adminApi<{
                                    connectWooSource: { id: string };
                                }>('mutation($input:JSON!){connectWooSource(input:$input)}', {
                                    input: {
                                        url: data.get('url'),
                                        key: data.get('key'),
                                        secret: data.get('secret'),
                                        imageHosts: hostList(data.get('hosts')),
                                        pricesIncludeTax: data.get('tax') === 'on',
                                        weightUnit: data.get('weight'),
                                    },
                                });
                                form.reset();
                                onConnected(String(s.id), m.connected);
                            });
                        }}
                    >
                        <Steps items={f.restSteps} />
                        <label>
                            {m.url}
                            <Input name="url" type="url" required placeholder="https://shop.example.com" />
                        </label>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label>
                                {m.key}
                                <Input name="key" required autoComplete="off" />
                            </label>
                            <label>
                                {m.secret}
                                <Input name="secret" type="password" required autoComplete="off" />
                            </label>
                            <label>
                                {m.weight}
                                <Select name="weight" defaultValue="kg">
                                    <option>kg</option>
                                    <option>g</option>
                                    <option>lbs</option>
                                    <option>oz</option>
                                </Select>
                            </label>
                            <label className="flex items-center gap-2 sm:mt-6">
                                <input type="checkbox" name="tax" defaultChecked />
                                {m.tax}
                            </label>
                        </div>
                        <MoreOptions name="hosts" />
                        <Button type="submit" loading={busy}>
                            {m.connect}
                        </Button>
                    </form>
                )}
            </CardBody>
        </Card>
    );
}

/**
 * Step 4: old addresses. Redirect rules (most made by the import), the most-visited missing
 * pages with a one-click "Redirect", and the old sitemap check.
 */
export function WooLinks({ sourceId, lastCrawl }: { sourceId: string; lastCrawl?: CrawlResult }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const confirm = useConfirm();
    const { busy, error, run } = useAction();
    const [crawl, setCrawl] = useState<CrawlResult | undefined>(lastCrawl);
    // The redirect form is controlled so a missing page's "Redirect" button can fill it in.
    const [redirectPath, setRedirectPath] = useState('');
    const [redirectTarget, setRedirectTarget] = useState('');
    const targetInput = useRef<HTMLInputElement>(null);
    const review = useQuery({
        queryKey: ['woo', 'urls', sourceId],
        queryFn: () =>
            adminApi<{
                wooUrlReview: {
                    redirects: WooRedirect[];
                    misses: Array<{ id: string; path: string; hits: number }>;
                };
            }>(URL_REVIEW, { id: sourceId }).then(r => r.wooUrlReview),
    });
    const redirected = new Set(review.data?.redirects.map(rule => rule.path));
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
            await run(async () => {
                await adminApi(DELETE_REDIRECT, { id: rule.id });
            });
    }
    return (
        <>
            {error && <Alert tone="warning">{error}</Alert>}
            <Card>
                <CardHeader title={m.redirectTitle} />
                <CardBody className="space-y-3">
                    <form
                        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                        onSubmit={e => {
                            e.preventDefault();
                            void run(async () => {
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
                    {/* Hundreds of rules after an import: the list scrolls instead of filling the page. */}
                    <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
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
                </CardBody>
            </Card>
            <Card>
                <CardHeader title={m.missingUrls} />
                <CardBody className="space-y-2">
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
                </CardBody>
            </Card>
            <Card>
                <CardHeader title={m.crawler} />
                <CardBody className="space-y-3">
                    <form
                        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                        onSubmit={e => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            void run(async () => {
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
                </CardBody>
            </Card>
        </>
    );
}

/** The cutover checklist: ticks that record the review (they change nothing by themselves). */
export function CutoverChecklist({ sourceId, checked = [] }: { sourceId: string; checked?: string[] }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const { busy, error, run } = useAction();
    const [steps, setSteps] = useState(checked);
    return (
        <div className="space-y-2">
            <h3 className="font-medium">{m.cutoverTitle}</h3>
            <p className="text-sm text-slate-600">{m.cutoverHint}</p>
            {error && <Alert tone="warning">{error}</Alert>}
            {Object.entries(m.cutoverSteps).map(([key, label]) => (
                <label key={key} className="flex gap-2">
                    <input
                        type="checkbox"
                        checked={steps.includes(key)}
                        onChange={e =>
                            setSteps(e.target.checked ? [...steps, key] : steps.filter(s => s !== key))
                        }
                    />
                    {label}
                </label>
            ))}
            <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                    void run(async () => {
                        await adminApi(
                            'mutation($id:ID!,$checked:[String!]!){saveWooCutover(sourceId:$id,checked:$checked)}',
                            { id: sourceId, checked: steps },
                        );
                    })
                }
            >
                {m.saveChecklist}
            </Button>
        </div>
    );
}

/** The private export of orders placed here since a date, in case the store has to go back. */
export function RollbackExport() {
    const { messages } = useI18n();
    const m = messages.migration;
    const { busy, error, run } = useAction();
    return (
        <form
            className="space-y-2"
            onSubmit={e => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                    const since = new Date(String(data.get('since'))).toISOString();
                    const items: unknown[] = [];
                    let total = 1;
                    while (items.length < total) {
                        const result = await adminApi<{
                            wooRollbackOrders: { items: unknown[]; totalItems: number };
                        }>('query($since:DateTime!,$skip:Int){wooRollbackOrders(since:$since,skip:$skip)}', {
                            since,
                            skip: items.length,
                        });
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
            <h3 className="font-medium">{m.flow.rollbackTitle}</h3>
            <p className="text-sm text-slate-600">{m.rollbackHint}</p>
            {error && <Alert tone="warning">{error}</Alert>}
            <label>
                {m.ordersSince}
                <Input name="since" type="datetime-local" required />
            </label>
            <Button type="submit" variant="secondary" disabled={busy}>
                {m.exportRollback}
            </Button>
        </form>
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
export function SourceSettings({ reference }: { reference: SourceReference }) {
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
