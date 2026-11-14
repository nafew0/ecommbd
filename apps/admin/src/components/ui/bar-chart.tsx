import { useState } from 'react';
import { cn } from '../../lib/cn';

export interface BarDatum {
    /** Unique, and shown under the first, middle and last bars (a short date). */
    label: string;
    value: number;
    /** What the tooltip and the table say for this bar, already formatted. */
    text: string;
}

interface BarChartProps {
    data: BarDatum[];
    /** Names the one series: the chart needs no legend. */
    title: string;
    /** The top of the scale, formatted (the largest value). */
    maxLabel: string;
    className?: string;
}

/**
 * One series over time as thin bars (dashboard sales per day). One hue, a quiet baseline, the
 * value on hover or focus, and the same numbers as a table for screen readers. Text stays in ink
 * colours; only the bars carry the accent.
 */
export function BarChart({ data, title, maxLabel, className }: BarChartProps) {
    const [active, setActive] = useState<number | null>(null);
    const max = Math.max(1, ...data.map(item => item.value));
    const shown = active === null ? null : data[active];
    const labelAt = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
    return (
        <figure className={cn('min-w-0', className)}>
            <figcaption className="flex items-baseline justify-between gap-3 text-[13px] text-ink-muted">
                <span>{title}</span>
                <span className="tabular-nums" aria-live="polite">
                    {shown ? (
                        <>
                            <span className="text-ink-muted">{shown.label} · </span>
                            <span className="font-semibold text-ink">{shown.text}</span>
                        </>
                    ) : (
                        maxLabel
                    )}
                </span>
            </figcaption>
            <div
                aria-hidden
                className="mt-2 flex h-40 items-end gap-0.5 border-b border-line-strong"
                onMouseLeave={() => setActive(null)}
            >
                {data.map((item, index) => (
                    <div
                        key={item.label}
                        onMouseEnter={() => setActive(index)}
                        className="group flex h-full min-w-0 flex-1 items-end"
                    >
                        <div
                            style={{
                                height: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%`,
                            }}
                            className={cn(
                                'w-full rounded-t-[4px] bg-accent transition-opacity',
                                active !== null && active !== index && 'opacity-40',
                            )}
                        />
                    </div>
                ))}
            </div>
            <div aria-hidden className="mt-1 flex justify-between text-xs text-ink-muted tabular-nums">
                {data.map((item, index) =>
                    labelAt.has(index) ? <span key={item.label}>{item.label}</span> : null,
                )}
            </div>
            <table className="sr-only">
                <caption>{title}</caption>
                <tbody>
                    {data.map(item => (
                        <tr key={item.label}>
                            <th scope="row">{item.label}</th>
                            <td>{item.text}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </figure>
    );
}
