import { ArrowLeft, CircleAlert, Info } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { type ActionItem, ActionMenu } from './action-menu';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
    return <section className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({
    title,
    description,
    actions,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="card-header flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
            <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">{title}</h2>
                {description && <p className="text-[13px] text-ink-muted">{description}</p>}
            </div>
            {actions}
        </div>
    );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('space-y-4 px-4 py-4 sm:px-5 [.card-header+&]:pt-3', className)} {...props} />;
}

export type BadgeTone = 'slate' | 'amber' | 'teal' | 'red' | 'sky' | 'violet' | 'indigo' | 'green' | 'orange';

/**
 * A status label. Colour here always means something: the tone names are kept from before the
 * redesign so callers didn't change, and map to the admin's tokens. This is the one file allowed
 * to use raw palette colours (violet and indigo have no token).
 */
export function Badge({
    tone = 'slate',
    className,
    ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
    const tones: Record<BadgeTone, string> = {
        slate: 'bg-line/70 text-ink-muted',
        amber: 'bg-warn-soft text-warn',
        teal: 'bg-accent-soft text-accent',
        red: 'bg-danger-soft text-danger',
        sky: 'bg-info-soft text-info',
        violet: 'bg-violet-100 text-violet-900',
        indigo: 'bg-indigo-100 text-indigo-900',
        green: 'bg-ok-soft text-ok',
        orange: 'bg-orange-100 text-orange-900',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
                tones[tone],
                className,
            )}
            {...props}
        />
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn('animate-pulse rounded-md bg-line', className)} />;
}

/** Placeholder blocks while a page loads, so the layout doesn't jump on slow mobile data. */
export function PageSkeleton() {
    return (
        <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
        </div>
    );
}

export function Alert({
    tone = 'info',
    children,
}: {
    tone?: 'info' | 'warning' | 'error';
    children: ReactNode;
}) {
    const tones = {
        info: 'border-info/30 bg-info-soft text-info',
        warning: 'border-warn/30 bg-warn-soft text-warn',
        error: 'border-danger/30 bg-danger-soft text-danger',
    };
    const Icon = tone === 'info' ? Info : CircleAlert;
    return (
        <div
            role={tone === 'error' ? 'alert' : undefined}
            className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', tones[tone])}
        >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function PageHeader({
    title,
    description,
    actions,
    back,
    badges,
    menu,
}: {
    title: string;
    description?: string;
    /** Visible buttons: the one main button last, at most two others before it. */
    actions?: ReactNode;
    /** A link back to the list this page belongs to. */
    back?: { to: string; label: string };
    /** Status badges beside the title. */
    badges?: ReactNode;
    /** Everything else the page can do, in a "More" menu. */
    menu?: ActionItem[];
}) {
    return (
        <header className="mb-5">
            {back && (
                <Link
                    to={back.to}
                    className="mb-1 -ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[13px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                    <ArrowLeft className="size-4" aria-hidden />
                    {back.label}
                </Link>
            )}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl leading-tight font-semibold">{title}</h1>
                        {badges}
                    </div>
                    {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
                </div>
                {(actions || menu?.length) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {menu && menu.length > 0 && <ActionMenu items={menu} />}
                        {actions}
                    </div>
                )}
            </div>
        </header>
    );
}

export function EmptyState({
    icon,
    title,
    body,
    action,
}: {
    icon: ReactNode;
    title: string;
    body: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="mb-2 rounded-full bg-surface-muted p-3 text-ink-muted">{icon}</div>
            <h3 className="font-semibold">{title}</h3>
            <p className="max-w-sm text-sm text-ink-muted">{body}</p>
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}
