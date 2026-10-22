import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '../components/ui/misc';
import { adminApi, ApiError } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useI18n } from '../lib/i18n';
import { LegacyOrders } from '../components/legacy-orders';

interface Source {
    id: string;
    url: string;
    completed: boolean;
    settings: { currency?: string; weightUnit?: string };
}
interface Run {
    id: string;
    status: string;
    mode: string;
    cursor: { stage: number; offset: number };
    counts: Record<string, number>;
    verification: Record<string, unknown>;
    error?: string;
    issues?: Array<{ id: string; code: string; kind: string; sourceKey: string; severity: string }>;
}
const RUNS = 'query($sourceId: ID!) { wooRuns(sourceId: $sourceId) }';
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
export function WooMigrationPage() {
    const { messages } = useI18n();
    const m = messages.migration;
    const client = useQueryClient();
    const confirm = useConfirm();
    const [sourceId, setSourceId] = useState('');
    const [runId, setRunId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [notice, setNotice] = useState('');
    const [ack, setAck] = useState(false);
    const sources = useQuery({
        queryKey: ['woo', 'sources'],
        queryFn: () => adminApi<{ wooSources: Source[] }>('{ wooSources }').then(r => r.wooSources),
    });
    const runs = useQuery({
        queryKey: ['woo', 'runs', sourceId],
        enabled: !!sourceId,
        refetchInterval: 3000,
        queryFn: () => adminApi<{ wooRuns: Run[] }>(RUNS, { sourceId }).then(r => r.wooRuns),
    });
    const activeId = runId || runs.data?.[0]?.id;
    const selectedSource = sources.data?.find(s => String(s.id) === String(sourceId));
    const run = useQuery({
        queryKey: ['woo', 'run', activeId],
        enabled: !!activeId,
        refetchInterval: 3000,
        queryFn: () =>
            adminApi<{ wooRun: Run }>('query($id:ID!){wooRun(id:$id)}', { id: activeId }).then(r => r.wooRun),
    });
    async function action(fn: () => Promise<unknown>) {
        setBusy(true);
        setError(false);
        setErrorMessage('');
        try {
            await fn();
            await client.invalidateQueries({ queryKey: ['woo'] });
        } catch (cause) {
            setError(true);
            if (cause instanceof ApiError && cause.code === 'USER_INPUT_ERROR')
                setErrorMessage(cause.message);
        } finally {
            setBusy(false);
        }
    }
    async function connect(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        await action(async () => {
            const { connectWooSource: s } = await adminApi<{ connectWooSource: Source }>(
                'mutation($input:JSON!){connectWooSource(input:$input)}',
                {
                    input: {
                        url: data.get('url'),
                        key: data.get('key'),
                        secret: data.get('secret'),
                        imageHosts: String(data.get('hosts') || '')
                            .split(',')
                            .map(h => h.trim().toLowerCase())
                            .filter(Boolean),
                        pricesIncludeTax: data.get('tax') === 'on',
                        weightUnit: data.get('weight'),
                    },
                },
            );
            setSourceId(s.id);
            setRunId('');
            setNotice(m.connected);
            form.reset();
        });
    }
    async function start(mode: string) {
        await action(async () => {
            const result = await adminApi<{ startWooImport: Run }>(
                'mutation($sourceId:ID!,$mode:String!,$acknowledge:Boolean){startWooImport(sourceId:$sourceId,mode:$mode,acknowledge:$acknowledge)}',
                { sourceId, mode, acknowledge: ack },
            );
            setRunId(result.startWooImport.id);
        });
    }
    async function report(format: 'csv' | 'html') {
        await action(async () => {
            const { wooMigrationReport: r } = await adminApi<{ wooMigrationReport: Record<string, unknown> }>(
                'query($runId:ID!){wooMigrationReport(runId:$runId)}',
                { runId: activeId },
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
                    '\ufeff' +
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
    return (
        <>
            <PageHeader title={m.title} description={m.intro} />
            {(error || sources.isError || runs.isError || run.isError) && (
                <Alert tone="warning">{errorMessage || m.failed}</Alert>
            )}
            {notice && <Alert>{notice}</Alert>}
            <div className="space-y-4">
                <Card>
                    <CardHeader title={m.source} />
                    <CardBody>
                        <form onSubmit={connect} className="grid gap-3 sm:grid-cols-2">
                            <label>
                                {m.url}
                                <Input
                                    name="url"
                                    type="url"
                                    required
                                    placeholder="https://shop.example.com"
                                />
                            </label>
                            <label>
                                {m.hosts}
                                <Input name="hosts" />
                            </label>
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
                            <label className="flex items-center gap-2">
                                <input type="checkbox" name="tax" defaultChecked />
                                {m.tax}
                            </label>
                            <Button type="submit" loading={busy}>
                                {m.connect}
                            </Button>
                        </form>
                    </CardBody>
                </Card>
                <Select
                    aria-label={m.source}
                    value={sourceId}
                    onChange={event => {
                        setSourceId(event.target.value);
                        setRunId('');
                        setAck(false);
                    }}
                >
                    <option value="">{m.select}</option>
                    {sources.data?.map(s => (
                        <option key={s.id} value={s.id}>
                            {s.url}
                        </option>
                    ))}
                </Select>
                {sourceId && (
                    <>
                        <p>
                            {m.currency}: {selectedSource?.settings.currency} · {m.weight}:{' '}
                            {selectedSource?.settings.weightUnit}
                        </p>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                            {m.acknowledge}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <Button disabled={busy} onClick={() => void start('dryRun')}>
                                {m.dryRun}
                            </Button>
                            <Button disabled={busy || !ack} onClick={() => void start('import')}>
                                {m.import}
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={busy || !ack}
                                onClick={() => void start('catchUp')}
                            >
                                {m.catchUp}
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                    void action(async () => {
                                        if (await confirm({ title: m.complete, body: m.completeBody })) {
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
                        <Card>
                            <CardHeader title={m.runs} />
                            <CardBody>
                                <Select
                                    aria-label={m.runs}
                                    value={activeId ?? ''}
                                    onChange={e => setRunId(e.target.value)}
                                >
                                    {!runs.data?.length && <option>{m.noRuns}</option>}
                                    {runs.data?.map(r => (
                                        <option key={r.id} value={r.id}>
                                            {m.modes[r.mode as keyof typeof m.modes] ?? r.mode} ·{' '}
                                            {m.states[r.status as keyof typeof m.states] ?? r.status}
                                        </option>
                                    ))}
                                </Select>
                                {run.data && (
                                    <>
                                        {run.data.status === 'running' &&
                                            run.data.cursor.stage < 5 &&
                                            (() => {
                                                const kind = [
                                                    'categories',
                                                    'tags',
                                                    'products',
                                                    'customers',
                                                    'orders',
                                                ][run.data.cursor.stage] as keyof typeof m.stages;
                                                const total = (
                                                    run.data.verification.sourceCounts as
                                                        Record<string, number> | undefined
                                                )?.[kind];
                                                return (
                                                    <div>
                                                        <p>
                                                            {m.stages[kind]} · {run.data.cursor.offset}
                                                            {total != null ? ` / ${total}` : ''}
                                                        </p>
                                                        <progress
                                                            className="w-full"
                                                            aria-label={m.counts}
                                                            value={
                                                                total == null
                                                                    ? undefined
                                                                    : run.data.cursor.offset
                                                            }
                                                            max={total || 1}
                                                        />
                                                    </div>
                                                );
                                            })()}
                                        <p>
                                            {m.status}:{' '}
                                            {m.states[run.data.status as keyof typeof m.states] ??
                                                run.data.status}
                                        </p>
                                        {run.data.error && (
                                            <Alert tone="warning">
                                                {m.failed} ({run.data.error})
                                            </Alert>
                                        )}
                                        {['failed', 'queued', 'running'].includes(run.data.status) && (
                                            <Button
                                                variant="secondary"
                                                disabled={busy}
                                                onClick={() =>
                                                    void action(() =>
                                                        adminApi(
                                                            'mutation($runId:ID!){resumeWooImport(runId:$runId)}',
                                                            { runId: activeId },
                                                        ),
                                                    )
                                                }
                                            >
                                                {m.resume}
                                            </Button>
                                        )}
                                        <dl>
                                            {Object.entries(run.data.counts).map(([key, value]) => (
                                                <div className="flex justify-between gap-3" key={key}>
                                                    <dt>{m.stages[key as keyof typeof m.stages] ?? key}</dt>
                                                    <dd>{value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                        <details>
                                            <summary>{m.verification}</summary>
                                            <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                                                {JSON.stringify(run.data.verification, null, 2)}
                                            </pre>
                                        </details>
                                        <div className="flex gap-2">
                                            <Button variant="secondary" onClick={() => void report('csv')}>
                                                {m.csv}
                                            </Button>
                                            <Button variant="secondary" onClick={() => void report('html')}>
                                                {m.html}
                                            </Button>
                                        </div>
                                        <h3>{m.issues}</h3>
                                        <ul className="text-sm">
                                            {run.data.issues?.map(i => (
                                                <li key={i.id}>
                                                    {i.kind} #{i.sourceKey} · {i.code} ({i.severity})
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </CardBody>
                        </Card>
                    </>
                )}
                <LegacyOrders key={sourceId} sourceId={sourceId || undefined} />
            </div>
        </>
    );
}
