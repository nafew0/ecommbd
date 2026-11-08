import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useI18n } from '../lib/i18n';
import {
    CutoverChecklist,
    RollbackExport,
    SourceSettings,
    WooConnect,
    WooLinks,
} from '../components/woo-cutover';
import {
    apiErrorMessage,
    type CrawlResult,
    type SourceReference,
    type WooRun,
} from '../components/woo-migration-format';
import {
    RunCounts,
    RunError,
    RunIssues,
    RunProgress,
    VerificationReport,
} from '../components/woo-run-report';

interface Source {
    id: string;
    url: string;
    completed: boolean;
    settings: {
        currency?: string;
        weightUnit?: string;
        cutover?: { checked: string[] };
        reference?: SourceReference;
        /** The last sitemap check, so its result is still there after a reload. */
        crawl?: CrawlResult;
    };
}
const RUNS = 'query($sourceId: ID!) { wooRuns(sourceId: $sourceId) }';
const STEPS = ['connect', 'check', 'import', 'links', 'live'] as const;
type Step = (typeof STEPS)[number];
/** A run that has finished reading: its report can be trusted. */
const finished = (run: WooRun) => ['completed', 'needsReview'].includes(run.status);
const working = (run?: WooRun) => !!run && ['queued', 'running'].includes(run.status);

const escape = (value: unknown) =>
    String(value).replace(
        /[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
function download(content: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * WooCommerce migration (roadmap phases 21–22) as five steps: connect the old store, check it
 * (dry run), import, keep the old links working, then switch over. One step is shown at a time,
 * and the page opens on the step the store has reached. Imported orders are on their own page
 * (Orders → WooCommerce orders). The pieces live in components/woo-cutover.tsx and
 * components/woo-run-report.tsx.
 */
export function WooMigrationPage() {
    const { messages } = useI18n();
    const m = messages.migration;
    const f = m.flow;
    const client = useQueryClient();
    const confirm = useConfirm();
    const [chosenSource, setChosenSource] = useState('');
    const [adding, setAdding] = useState(false);
    const [chosenStep, setChosenStep] = useState<Step | ''>('');
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [notice, setNotice] = useState('');
    const [ack, setAck] = useState(false);
    const sources = useQuery({
        queryKey: ['woo', 'sources'],
        queryFn: () => adminApi<{ wooSources: Source[] }>('{ wooSources }').then(r => r.wooSources),
    });
    // The newest connected store (listed first) is selected on its own: most stores migrate from one site.
    const sourceId = adding ? '' : chosenSource || (sources.data?.[0]?.id ?? '');
    const source = sources.data?.find(s => String(s.id) === String(sourceId));
    const runs = useQuery({
        queryKey: ['woo', 'runs', sourceId],
        enabled: !!sourceId,
        refetchInterval: query => (query.state.data?.some(working) ? 3000 : 15000),
        queryFn: () => adminApi<{ wooRuns: WooRun[] }>(RUNS, { sourceId }).then(r => r.wooRuns),
    });
    const checks = runs.data?.filter(r => r.mode === 'dryRun') ?? [];
    const imports = runs.data?.filter(r => r.mode !== 'dryRun') ?? [];
    const checked = checks.some(finished);
    const imported = imports.some(finished);
    const done: Record<Step, boolean> = {
        connect: !!sourceId,
        check: checked,
        import: imported,
        links: false,
        live: !!source?.completed,
    };
    // Opens on the step the store has reached; the step bar moves freely after that.
    const step: Step = !sourceId ? 'connect' : chosenStep || (!checked ? 'check' : 'import');
    async function action(fn: () => Promise<unknown>) {
        setBusy(true);
        setErrorMessage('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            setErrorMessage(apiErrorMessage(m, cause));
        } finally {
            setBusy(false);
        }
    }
    function selectSource(id: string) {
        setChosenSource(id);
        setAdding(false);
        setChosenStep('');
        setAck(false);
    }
    async function start(mode: 'dryRun' | 'import' | 'catchUp') {
        // Stay on this step while it runs: otherwise a finished check would jump to Import
        // before its results were seen.
        setChosenStep(mode === 'dryRun' ? 'check' : mode === 'import' ? 'import' : 'live');
        await action(() =>
            adminApi(
                'mutation($sourceId:ID!,$mode:String!,$acknowledge:Boolean){startWooImport(sourceId:$sourceId,mode:$mode,acknowledge:$acknowledge)}',
                { sourceId, mode, acknowledge: ack },
            ),
        );
    }
    const ackBox = (
        <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={ack} onChange={e => setAck(e.target.checked)} />
            {m.acknowledge}
        </label>
    );
    return (
        <>
            <PageHeader title={m.title} description={m.intro} />
            <div className="space-y-4">
                {(errorMessage || sources.isError || runs.isError) && (
                    <Alert tone="warning">{errorMessage || m.failed}</Alert>
                )}
                {notice && <Alert>{notice}</Alert>}
                {!!sources.data?.length && (
                    <Card>
                        <CardBody className="flex flex-wrap items-end gap-3">
                            <label className="w-full min-w-0 sm:w-auto sm:flex-1">
                                {f.oldStore}
                                <Select
                                    aria-label={m.source}
                                    value={sourceId}
                                    onChange={event => selectSource(event.target.value)}
                                >
                                    {adding && <option value="">{m.select}</option>}
                                    {sources.data.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.url}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            {adding ? (
                                <Button variant="ghost" onClick={() => setAdding(false)}>
                                    {f.cancelAdd}
                                </Button>
                            ) : (
                                <Button variant="secondary" onClick={() => setAdding(true)}>
                                    {f.addStore}
                                </Button>
                            )}
                            {source && (
                                <p className="w-full text-sm text-slate-600">
                                    {m.currency}: {source.settings.currency || '—'} · {m.weight}:{' '}
                                    {source.settings.weightUnit || '—'}
                                </p>
                            )}
                        </CardBody>
                    </Card>
                )}
                {sourceId && (
                    <StepBar
                        current={step}
                        done={done}
                        onSelect={next => setChosenStep(next === 'connect' ? '' : next)}
                        onConnect={() => setAdding(true)}
                    />
                )}
                {step === 'connect' && (
                    <WooConnect
                        onConnected={(id, message) => {
                            selectSource(id);
                            setNotice(message);
                        }}
                    />
                )}
                {step === 'check' && (
                    <Card>
                        <CardHeader title={f.checkTitle} />
                        <CardBody className="space-y-4">
                            <p className="text-sm text-slate-600">{f.checkHint}</p>
                            <Button
                                variant={checked ? 'secondary' : 'primary'}
                                disabled={busy || working(checks[0])}
                                onClick={() => void start('dryRun')}
                            >
                                {checked ? f.checkAgain : m.dryRun}
                            </Button>
                            <RunPanel runs={checks} onError={setErrorMessage} />
                            {checked && <Button onClick={() => setChosenStep('import')}>{f.next}</Button>}
                        </CardBody>
                    </Card>
                )}
                {step === 'import' && (
                    <Card>
                        <CardHeader title={f.importTitle} />
                        <CardBody className="space-y-4">
                            <p className="text-sm text-slate-600">{f.importHint}</p>
                            {!checked ? (
                                <Alert tone="warning">{f.checkFirst}</Alert>
                            ) : (
                                <>
                                    {ackBox}
                                    <Button
                                        variant={imported ? 'secondary' : 'primary'}
                                        disabled={busy || !ack || working(imports[0])}
                                        onClick={() => void start('import')}
                                    >
                                        {m.import}
                                    </Button>
                                </>
                            )}
                            <RunPanel runs={imports} onError={setErrorMessage} />
                            {imported && (
                                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                                    <Link className="font-medium underline" to="/orders/woocommerce">
                                        {f.seeOrders}
                                    </Link>
                                    <Link className="font-medium underline" to="/products">
                                        {f.seeProducts}
                                    </Link>
                                    <Link className="font-medium underline" to="/customers">
                                        {f.seeCustomers}
                                    </Link>
                                </div>
                            )}
                            {imported && <Button onClick={() => setChosenStep('links')}>{f.next}</Button>}
                        </CardBody>
                    </Card>
                )}
                {step === 'links' && sourceId && (
                    <>
                        <Card>
                            <CardHeader title={f.linksTitle} />
                            <CardBody>
                                <p className="text-sm text-slate-600">{f.linksHint}</p>
                            </CardBody>
                        </Card>
                        <WooLinks key={sourceId} sourceId={sourceId} lastCrawl={source?.settings.crawl} />
                        <Button onClick={() => setChosenStep('live')}>{f.next}</Button>
                    </>
                )}
                {step === 'live' && sourceId && (
                    <Card>
                        <CardHeader title={f.liveTitle} />
                        <CardBody className="space-y-6">
                            <p className="text-sm text-slate-600">{f.liveHint}</p>
                            {source?.settings.reference && (
                                <SourceSettings reference={source.settings.reference} />
                            )}
                            <CutoverChecklist
                                key={sourceId}
                                sourceId={sourceId}
                                checked={source?.settings.cutover?.checked}
                            />
                            <section className="space-y-2">
                                <h3 className="font-medium">{f.syncTitle}</h3>
                                <p className="text-sm text-slate-600">{f.syncHint}</p>
                                {ackBox}
                                <Button
                                    variant="secondary"
                                    disabled={busy || !ack || !imported || working(imports[0])}
                                    onClick={() => void start('catchUp')}
                                >
                                    {m.catchUp}
                                </Button>
                                {working(imports[0]) && <RunPanel runs={imports} onError={setErrorMessage} />}
                            </section>
                            <RollbackExport />
                            <section className="space-y-2">
                                <h3 className="font-medium">{f.finishTitle}</h3>
                                <p className="text-sm text-slate-600">{f.finishHint}</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="secondary"
                                        disabled={busy}
                                        onClick={() =>
                                            void action(() =>
                                                adminApi('mutation($id:ID!){revokeWooHelper(sourceId:$id)}', {
                                                    id: sourceId,
                                                }),
                                            )
                                        }
                                    >
                                        {m.revokeHelper}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        disabled={busy}
                                        onClick={() =>
                                            void action(async () => {
                                                if (
                                                    await confirm({ title: m.complete, body: m.completeBody })
                                                ) {
                                                    await adminApi(
                                                        'mutation($sourceId:ID!){completeWooMigration(sourceId:$sourceId)}',
                                                        { sourceId },
                                                    );
                                                    setNotice(m.credentialsRemoved);
                                                }
                                            })
                                        }
                                    >
                                        {m.complete}
                                    </Button>
                                </div>
                            </section>
                        </CardBody>
                    </Card>
                )}
            </div>
        </>
    );
}

/**
 * The five steps as a bar: number (a tick once done) and name. The current step is marked for
 * screen readers too. "Connect" goes to adding another store, since this one is connected.
 */
function StepBar({
    current,
    done,
    onSelect,
    onConnect,
}: {
    current: Step;
    done: Record<Step, boolean>;
    onSelect: (step: Step) => void;
    onConnect: () => void;
}) {
    const { messages } = useI18n();
    const f = messages.migration.flow;
    return (
        <nav aria-label={messages.migration.title}>
            <ol className="grid grid-cols-5 gap-1 sm:gap-2">
                {STEPS.map((key, index) => {
                    const active = key === current;
                    return (
                        <li key={key}>
                            <button
                                type="button"
                                aria-current={active ? 'step' : undefined}
                                onClick={() => (key === 'connect' ? onConnect() : onSelect(key))}
                                className={`flex w-full flex-col items-center gap-1 rounded-md border px-1 py-2 text-center text-xs sm:flex-row sm:gap-2 sm:px-3 sm:text-left sm:text-sm ${
                                    active
                                        ? 'border-teal-700 bg-teal-50 font-medium text-teal-900'
                                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                            >
                                <span
                                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                                        done[key]
                                            ? 'bg-teal-700 text-white'
                                            : active
                                              ? 'border border-teal-700 text-teal-900'
                                              : 'border border-slate-300 text-slate-600'
                                    }`}
                                >
                                    {done[key] ? (
                                        <Check aria-label={f.done} className="size-3.5" />
                                    ) : (
                                        messages.common.number(index + 1)
                                    )}
                                </span>
                                <span className="min-w-0 break-words">{f.steps[key]}</span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/**
 * One step's runs: the latest (or a chosen earlier one) with its progress, status, counts,
 * verification, issues and report downloads. Refreshes every few seconds while it works.
 */
function RunPanel({ runs, onError }: { runs: WooRun[]; onError: (message: string) => void }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const f = m.flow;
    const client = useQueryClient();
    const [chosen, setChosen] = useState('');
    const [busy, setBusy] = useState(false);
    const id = runs.some(r => r.id === chosen) ? chosen : runs[0]?.id;
    const run = useQuery({
        queryKey: ['woo', 'run', id],
        enabled: !!id,
        refetchInterval: query => (working(query.state.data) || !query.state.data ? 3000 : false),
        queryFn: () =>
            adminApi<{ wooRun: WooRun }>('query($id:ID!){wooRun(id:$id)}', { id }).then(r => r.wooRun),
    });
    const status = run.data?.status;
    useEffect(() => {
        if (status && !working(run.data)) {
            void client.invalidateQueries({ queryKey: ['woo', 'history'] });
            void client.invalidateQueries({ queryKey: ['woo', 'sources'] });
            void client.invalidateQueries({ queryKey: ['woo', 'runs'] });
        }
    }, [id, status, client]);
    async function act(fn: () => Promise<unknown>) {
        setBusy(true);
        onError('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            onError(apiErrorMessage(m, cause));
        } finally {
            setBusy(false);
        }
    }
    async function report(format: 'csv' | 'html') {
        await act(async () => {
            const { wooMigrationReport: r } = await adminApi<{ wooMigrationReport: Record<string, unknown> }>(
                'query($runId:ID!){wooMigrationReport(runId:$runId)}',
                { runId: id },
            );
            const rows = Object.entries(r).map(([key, value]) => [
                key,
                typeof value === 'object' ? JSON.stringify(value) : String(value),
            ]);
            if (format === 'html')
                download(
                    `<!doctype html><meta charset="utf-8"><title>${escape(m.title)}</title><h1>${escape(m.title)}</h1><table>${rows.map(row => `<tr><th>${escape(row[0])}</th><td><pre>${escape(row[1])}</pre></td></tr>`).join('')}</table>`,
                    'migration-report.html',
                    'text/html;charset=utf-8',
                );
            else
                download(
                    '﻿' +
                        rows
                            .map(row =>
                                row
                                    .map(
                                        value =>
                                            '"' +
                                            (/^[=+@\-\t\r]/.test(value) ? "'" : '') +
                                            value.replace(/"/g, '""') +
                                            '"',
                                    )
                                    .join(','),
                            )
                            .join('\r\n'),
                    'migration-report.csv',
                    'text/csv;charset=utf-8',
                );
        });
    }
    if (!runs.length) return <p className="text-sm text-slate-600">{f.notRun}</p>;
    return (
        <section className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{f.latestRun}</h3>
                {runs.length > 1 && (
                    <Select
                        aria-label={f.earlierRuns}
                        className="w-auto"
                        value={id}
                        onChange={e => setChosen(e.target.value)}
                    >
                        {runs.map(r => (
                            <option key={r.id} value={r.id}>
                                #{messages.common.number(Number(r.id))} ·{' '}
                                {m.modes[r.mode as keyof typeof m.modes] ?? r.mode} ·{' '}
                                {m.states[r.status as keyof typeof m.states] ?? r.status}
                            </option>
                        ))}
                    </Select>
                )}
            </div>
            {run.data && (
                <>
                    <p>
                        {m.status}: {m.states[run.data.status as keyof typeof m.states] ?? run.data.status}
                    </p>
                    {working(run.data) && <p className="text-sm text-slate-600">{f.running}</p>}
                    <RunProgress run={run.data} />
                    {run.data.error && <RunError code={run.data.error} />}
                    {/* A run a restart stopped continues by itself (the server checks every five
                        minutes), so the button is only for one that stopped on an error. */}
                    {run.data.status === 'failed' && (
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                                void act(() =>
                                    adminApi('mutation($runId:ID!){resumeWooImport(runId:$runId)}', {
                                        runId: id,
                                    }),
                                )
                            }
                        >
                            {m.resume}
                        </Button>
                    )}
                    <RunCounts counts={run.data.counts} />
                    <VerificationReport run={run.data} />
                    <RunIssues issues={run.data.issues ?? []} />
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void report('csv')}>
                            {m.csv}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void report('html')}>
                            {m.html}
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}
