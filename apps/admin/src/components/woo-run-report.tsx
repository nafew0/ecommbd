import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { Alert, Badge } from './ui/misc';
import {
    codeMessage,
    countRows,
    formatDuration,
    formatMinor,
    groupIssues,
    isKnownCode,
    issueRecords,
    kindLabel,
    monthLabel,
    sampleSummary,
    STAGES,
    totalRows,
    type Verification,
    type WooIssue,
    type WooRun,
} from './woo-migration-format';

/**
 * The parts of a migration run's screen that turn the importer's JSON into words: progress,
 * the check against the old store, the issues, and the error a run stopped with.
 */

/** The run is done, so its numbers are final (while it runs they're partial). */
const finished = (run: WooRun) => run.status === 'completed' || run.status === 'needsReview';

/**
 * One of the importer's codes as a sentence. Known codes also show the code itself, small, so the
 * merchant can quote it to support; an unknown code's general message already contains it.
 */
export function CodeText({ code }: { code: string }) {
    const { messages } = useI18n();
    const m = messages.migration;
    return (
        <>
            <span className="block">{codeMessage(m, code)}</span>
            {isKnownCode(m, code) && (
                <span className="block text-xs text-slate-500">{m.codeLabel(code)}</span>
            )}
        </>
    );
}

/** Raw data for Ecomm BD support, folded away: merchants never need it, support sometimes does. */
export function TechnicalDetails({ data }: { data: unknown }) {
    const { messages } = useI18n();
    return (
        <details className="rounded-md border border-slate-200 text-sm">
            <summary className="cursor-pointer px-3 py-2 text-slate-600">
                {messages.migration.report.technical}
            </summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-200 p-3 text-xs break-all whitespace-pre-wrap">
                {JSON.stringify(data, null, 2)}
            </pre>
        </details>
    );
}

/** Which stage a running import is on, with a bar when the old store said how many records it has. */
export function RunProgress({ run }: { run: WooRun }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const n = messages.common.number;
    const kind = STAGES[run.cursor.stage];
    // Past the last stage the import is finishing up (images, search index): no stage to show.
    if (run.status !== 'running' || !kind) return null;
    const total = (run.verification as Verification).sourceCounts?.[kind];
    return (
        <div>
            <p>
                {m.stages[kind]} · {n(run.cursor.offset)}
                {total != null ? ` / ${n(total)}` : ''}
            </p>
            <progress
                className="w-full"
                aria-label={m.counts}
                // Without a total the bar has no value, which browsers draw as "busy".
                value={total == null ? undefined : run.cursor.offset}
                max={total || 1}
            />
        </div>
    );
}

/**
 * The run's running tally: records read per kind, and what happened to them (written, unchanged,
 * refused). It's the only count that moves while an import is going; the check against the old
 * store comes at the end.
 */
export function RunCounts({ counts }: { counts: Record<string, number> }) {
    const { messages } = useI18n();
    const m = messages.migration;
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {entries.map(([key, value]) => (
                <div className="flex justify-between gap-3" key={key}>
                    <dt className="text-slate-600">{kindLabel(m, key)}</dt>
                    <dd className="tabular-nums">{messages.common.number(value)}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Why a run stopped, in words (the run's `error` is one of the importer's codes). */
export function RunError({ code }: { code: string }) {
    const { messages } = useI18n();
    return (
        <Alert tone="warning">
            <span className="block font-medium">{messages.migration.runStopped}</span>
            <CodeText code={code} />
        </Alert>
    );
}

/** "Same" / "Different", or a dash when there's nothing to compare. */
function Result({ matches }: { matches?: boolean }) {
    const { messages } = useI18n();
    const r = messages.migration.report;
    if (matches === undefined) return <span className="text-slate-400">—</span>;
    return matches ? <Badge tone="green">{r.same}</Badge> : <Badge tone="red">{r.different}</Badge>;
}

/** A compact table cell, so four or five columns still fit a phone. */
function Cell({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}

const HEAD = 'px-2 py-1.5 font-medium';

/**
 * The check against the old store, readable: records per kind, monthly order totals, the spot
 * checks on sample orders and image coverage. A dry run has only the old store's side, plus how
 * long the real import should take. The raw object stays available under "Technical details".
 */
export function VerificationReport({ run }: { run: WooRun }) {
    const { messages, language } = useI18n();
    const m = messages.migration;
    const r = m.report;
    const n = (value: number | undefined) => (value == null ? '—' : messages.common.number(value));
    const bangla = language === 'bn';
    const v = run.verification as Verification;
    const dryRun = run.mode === 'dryRun';
    const counts = countRows(v, run.counts, dryRun);
    const totals = totalRows(v);
    const differentMonths = totals.filter(row => row.matches === false).length;
    const samples = dryRun ? null : sampleSummary(v);
    const duration = formatDuration(m, v.estimatedSeconds);

    return (
        <section className="space-y-4">
            <h3 className="font-medium">{m.verification}</h3>
            {finished(run) &&
                (dryRun ? (
                    <Alert>{r.dryRun}</Alert>
                ) : v.matches === true ? (
                    <Alert>{r.matches}</Alert>
                ) : v.matches === false ? (
                    <Alert tone="warning">{r.differs}</Alert>
                ) : null)}

            {dryRun && (v.estimatedRecords != null || duration) && (
                <dl className="grid gap-3 sm:grid-cols-2">
                    {v.estimatedRecords != null && (
                        <div>
                            <dt className="text-sm text-slate-600">{r.recordsFound}</dt>
                            <dd className="font-medium">{n(v.estimatedRecords)}</dd>
                        </div>
                    )}
                    {duration && (
                        <div>
                            <dt className="text-sm text-slate-600">{r.estimatedTime}</dt>
                            <dd className="font-medium">{duration}</dd>
                            <dd className="text-xs text-slate-500">{r.estimateHint}</dd>
                        </div>
                    )}
                </dl>
            )}

            {counts.length > 0 && (
                // The table scrolls inside its box on a narrow phone rather than widening the page.
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <caption className="pb-1 text-left font-medium">{r.counts}</caption>
                        <thead className="bg-slate-50 text-slate-600">
                            <tr>
                                <th className={HEAD}>{r.kind}</th>
                                <th className={`${HEAD} text-right`}>{r.oldStore}</th>
                                <th className={`${HEAD} text-right`}>{dryRun ? r.read : r.imported}</th>
                                {!dryRun && <th className={`${HEAD} text-right`}>{r.skipped}</th>}
                                <th className={HEAD}>{r.result}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {counts.map(row => (
                                <tr key={row.kind}>
                                    <Cell>{kindLabel(m, row.kind)}</Cell>
                                    <Cell className="text-right tabular-nums">{n(row.expected)}</Cell>
                                    <Cell className="text-right tabular-nums">{n(row.actual)}</Cell>
                                    {!dryRun && (
                                        <Cell className="text-right tabular-nums">{n(row.skipped)}</Cell>
                                    )}
                                    <Cell>
                                        <Result matches={row.matches} />
                                    </Cell>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {totals.length > 0 && (
                // Folded by default: a store with years of orders has a row per month.
                <details className="rounded-md border border-slate-200 text-sm">
                    <summary className="cursor-pointer px-3 py-2">
                        {r.totals} · {r.totalsSummary(totals.length, differentMonths)}
                    </summary>
                    <div className="overflow-x-auto border-t border-slate-200">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                    <th className={HEAD}>{r.month}</th>
                                    <th className={`${HEAD} text-right`}>{r.oldStore}</th>
                                    {!dryRun && <th className={`${HEAD} text-right`}>{r.imported}</th>}
                                    {!dryRun && <th className={HEAD}>{r.result}</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {totals.map(row => (
                                    <tr key={`${row.currency}:${row.month}`}>
                                        <Cell>{monthLabel(m, row.month, bangla)}</Cell>
                                        <Cell className="text-right whitespace-nowrap tabular-nums">
                                            {row.expected == null
                                                ? '—'
                                                : formatMinor(row.expected, row.currency, bangla)}
                                        </Cell>
                                        {!dryRun && (
                                            <Cell className="text-right whitespace-nowrap tabular-nums">
                                                {row.actual == null
                                                    ? '—'
                                                    : formatMinor(row.actual, row.currency, bangla)}
                                            </Cell>
                                        )}
                                        {!dryRun && (
                                            <Cell>
                                                <Result matches={row.matches} />
                                            </Cell>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {samples && (
                <div className="text-sm">
                    <h4 className="font-medium">{r.samples}</h4>
                    <p>{r.samplesResult(samples.passed, samples.total)}</p>
                    {samples.failed.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                            {samples.failed.map(sample => (
                                <li key={sample.order}>
                                    {/* "sourceKey" among the differences means the order wasn't saved here at all. */}
                                    {sample.fields.includes('sourceKey')
                                        ? r.sampleMissing(sample.order)
                                        : r.sampleDiffers(
                                              sample.order,
                                              sample.fields
                                                  .map(f =>
                                                      f in r.sampleFields
                                                          ? r.sampleFields[f as keyof typeof r.sampleFields]
                                                          : f,
                                                  )
                                                  .join(', '),
                                          )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {!dryRun && (v.images != null || v.imageFailures) && (
                <div className="text-sm">
                    <h4 className="font-medium">{r.images}</h4>
                    <p>
                        {[
                            v.images != null && r.imagesCopied(v.images),
                            // Null when the core couldn't count processed images: say nothing rather than 0.
                            v.readyImages != null && r.imagesReady(v.readyImages),
                            !!v.imageFailures && r.imagesFailed(v.imageFailures),
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>
            )}

            <TechnicalDetails data={run.verification} />
        </section>
    );
}

/**
 * The run's issues, one line per kind of problem: what it means, how many records, which ones.
 * "Must fix" (errors) come first: those keep a run from finishing cleanly.
 */
export function RunIssues({ issues }: { issues: WooIssue[] }) {
    const { messages } = useI18n();
    const m = messages.migration;
    return (
        <section className="space-y-2">
            <h3 className="font-medium">{m.issues}</h3>
            {issues.length === 0 ? (
                <p className="text-sm text-slate-600">{m.noIssues}</p>
            ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                    {groupIssues(issues).map(group => (
                        <li key={`${group.severity}:${group.code}`} className="space-y-1 py-3">
                            <p className="flex flex-wrap items-center gap-2">
                                <Badge tone={group.severity === 'error' ? 'red' : 'amber'}>
                                    {group.severity === 'error' ? m.severities.error : m.severities.warning}
                                </Badge>
                                <span className="text-slate-600">{m.affected(group.issues.length)}</span>
                            </p>
                            <p>{codeMessage(m, group.code)}</p>
                            {issueRecords(m, group.issues).map(line => (
                                <p key={line} className="break-words text-slate-600">
                                    {line}
                                </p>
                            ))}
                            {isKnownCode(m, group.code) && (
                                <p className="text-xs text-slate-500">{m.codeLabel(group.code)}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
