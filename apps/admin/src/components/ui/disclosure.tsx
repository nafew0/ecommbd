import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { useMessages } from '../../lib/i18n';
import { m } from '../../lib/motion';

/**
 * The two ways a screen hides what isn't essential (design guide, section 6). Both keep their
 * children mounted while closed, so the form still validates and saves them, and both open by
 * themselves when `forceOpen` turns true (an error inside, or a value the merchant set).
 */

function useOpen(forceOpen: boolean | undefined, defaultOpen = false) {
    const [open, setOpen] = useState(defaultOpen || Boolean(forceOpen));
    useEffect(() => {
        if (forceOpen) setOpen(true);
    }, [forceOpen]);
    return [open, setOpen] as const;
}

function Panel({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
    return (
        <m.div
            id={id}
            initial={false}
            // Closed, it is also not visible: nothing inside can be read, found or reached.
            animate={
                open
                    ? { height: 'auto', opacity: 1, visibility: 'visible' }
                    : { height: 0, opacity: 0, transitionEnd: { visibility: 'hidden' } }
            }
            className="overflow-hidden"
            inert={!open}
            data-open={open}
        >
            {children}
        </m.div>
    );
}

interface MoreFieldsProps {
    /** What is inside, so nothing is a surprise: "SKU, weight, barcode". */
    summary?: string;
    label?: string;
    forceOpen?: boolean;
    children: ReactNode;
}

/** A "More options" row at the bottom of a card that opens the less-used fields in place. */
export function MoreFields({ summary, label, forceOpen, children }: MoreFieldsProps) {
    const messages = useMessages();
    const id = useId();
    const [open, setOpen] = useOpen(forceOpen);
    return (
        <div className="border-t border-line pt-3">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen(value => !value)}
                className="-mx-2 flex min-h-10 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            >
                <ChevronDown
                    className={cn(
                        'size-4 shrink-0 text-ink-muted transition-transform',
                        open && 'rotate-180',
                    )}
                    aria-hidden
                />
                <span className="font-semibold text-ink">
                    {open ? messages.common.fewerOptions : (label ?? messages.common.moreOptions)}
                </span>
                {!open && summary && <span className="min-w-0 truncate text-ink-muted">{summary}</span>}
            </button>
            <Panel id={id} open={open}>
                <div className="space-y-4 pt-3">{children}</div>
            </Panel>
        </div>
    );
}

interface CollapsibleCardProps {
    title: string;
    /** The current value in a few words ("Off", "৳20 per order"), shown while closed. */
    summary?: ReactNode;
    forceOpen?: boolean;
    defaultOpen?: boolean;
    children: ReactNode;
}

/** A whole card that starts closed, for a group of settings most stores never touch. */
export function CollapsibleCard({ title, summary, forceOpen, defaultOpen, children }: CollapsibleCardProps) {
    const id = useId();
    const [open, setOpen] = useOpen(forceOpen, defaultOpen);
    return (
        <section className="rounded-lg border border-line bg-surface">
            <h2>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={id}
                    onClick={() => setOpen(value => !value)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg px-4 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent sm:px-5"
                >
                    <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold">{title}</span>
                        {!open && summary && (
                            <span className="block truncate text-[13px] font-normal text-ink-muted">
                                {summary}
                            </span>
                        )}
                    </span>
                    <ChevronDown
                        className={cn(
                            'size-4 shrink-0 text-ink-muted transition-transform',
                            open && 'rotate-180',
                        )}
                        aria-hidden
                    />
                </button>
            </h2>
            <Panel id={id} open={open}>
                <div className="space-y-4 px-4 pt-1 pb-4 sm:px-5">{children}</div>
            </Panel>
        </section>
    );
}
