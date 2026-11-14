import { ArrowRight, Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { useMessages } from '../../lib/i18n';
import { Skeleton } from './misc';

interface StatTileProps {
    label: string;
    value: ReactNode;
    hint?: string;
    /** Makes the whole tile a link (to the list it counts). */
    to?: string;
    loading?: boolean;
    /** `attention` marks a count that is work waiting (orders to confirm). */
    tone?: 'plain' | 'attention';
}

/** A number with its label: the dashboard's tiles. */
export function StatTile({ label, value, hint, to, loading, tone = 'plain' }: StatTileProps) {
    const body = (
        <>
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                {tone === 'attention' && <span className="size-2 rounded-full bg-warn" aria-hidden />}
                <span className="min-w-0 flex-1">{label}</span>
                {to && (
                    <ArrowRight
                        className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                        aria-hidden
                    />
                )}
            </p>
            {loading ? (
                <Skeleton className="mt-2 h-8 w-20" />
            ) : (
                <p className="mt-1 text-2xl leading-tight font-semibold tabular-nums">{value}</p>
            )}
            {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
        </>
    );
    const box = 'block rounded-lg border border-line bg-surface p-4';
    return to ? (
        <Link
            to={to}
            className={cn(
                box,
                'group transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
            )}
        >
            {body}
        </Link>
    ) : (
        <div className={box}>{body}</div>
    );
}

/** Read-only details as label and value pairs. */
export function KeyValue({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
    return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {rows.map(row => (
                <div key={row.label} className="contents">
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd className="min-w-0 break-words">{row.value}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Copies a phone number, address or order number, and says so. */
export function CopyButton({ value, label }: { value: string; label: string }) {
    const messages = useMessages();
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
    }, [copied]);
    return (
        <button
            type="button"
            aria-label={`${messages.common.copy}: ${label}`}
            title={copied ? messages.common.copied : messages.common.copy}
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
            {copied ? (
                <Check className="size-4 text-ok" aria-hidden />
            ) : (
                <Copy className="size-4" aria-hidden />
            )}
            <span className="sr-only" aria-live="polite">
                {copied ? messages.common.copied : ''}
            </span>
        </button>
    );
}
