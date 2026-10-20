import { CircleAlert, Info } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
    return <section className={cn('rounded-lg border border-slate-200 bg-white', className)} {...props} />;
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
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
            <div className="min-w-0">
                <h2 className="font-semibold">{title}</h2>
                {description && <p className="text-sm text-slate-600">{description}</p>}
            </div>
            {actions}
        </div>
    );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('space-y-5 px-4 py-4 sm:px-6', className)} {...props} />;
}

export function Badge({
    tone = 'slate',
    className,
    ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'slate' | 'amber' | 'teal' | 'red' }) {
    const tones = {
        slate: 'bg-slate-100 text-slate-700',
        amber: 'bg-amber-100 text-amber-900',
        teal: 'bg-teal-50 text-teal-800',
        red: 'bg-red-100 text-red-800',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                tones[tone],
                className,
            )}
            {...props}
        />
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn('animate-pulse rounded-md bg-slate-200', className)} />;
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
        info: 'border-sky-200 bg-sky-50 text-sky-900',
        warning: 'border-amber-200 bg-amber-50 text-amber-900',
        error: 'border-red-200 bg-red-50 text-red-900',
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
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
                <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
                {description && <p className="mt-1 text-slate-600">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
            <div className="mb-2 rounded-full bg-teal-50 p-3 text-teal-700">{icon}</div>
            <h3 className="font-semibold">{title}</h3>
            <p className="max-w-sm text-sm text-slate-600">{body}</p>
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}
