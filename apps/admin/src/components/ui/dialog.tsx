import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useMessages } from '../../lib/i18n';

interface DialogProps {
    open: boolean;
    onClose(): void;
    title: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    /** `drawer` slides in from the left edge (the phone menu). */
    variant?: 'center' | 'drawer';
    /** Closing by Escape or the backdrop is allowed unless false (e.g. while saving). */
    dismissible?: boolean;
    /** `wide` for pickers with a grid (the page editor's section library). */
    size?: 'default' | 'wide';
}

/**
 * A modal built on the browser's own <dialog>: focus is trapped and restored, Escape closes it, and
 * the rest of the page is inert. No extra library, no injected styles.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    variant = 'center',
    dismissible = true,
    size = 'default',
}: DialogProps) {
    const m = useMessages();
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);
    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            onCancel={event => {
                event.preventDefault();
                if (dismissible) onClose();
            }}
            onClick={event => {
                if (event.target === ref.current && dismissible) onClose();
            }}
            className={cn(
                'bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40',
                variant === 'center' && 'm-auto w-[calc(100%-2rem)] rounded-lg max-h-[calc(100dvh-2rem)]',
                variant === 'center' && (size === 'wide' ? 'max-w-4xl' : 'max-w-lg'),
                variant === 'drawer' && 'm-0 h-dvh max-h-dvh w-72 max-w-[85vw]',
            )}
        >
            {/* Rendered only while open: a closed dialog leaves no labels or fields in the page. */}
            {open && (
                <div className="flex max-h-[inherit] flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div className="min-w-0">
                            <h2 id={titleId} className="font-semibold">
                                {title}
                            </h2>
                            {description && <p className="text-sm text-slate-600">{description}</p>}
                        </div>
                        {dismissible && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="-m-1 rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                aria-label={m.common.close}
                            >
                                <X className="size-5" aria-hidden />
                            </button>
                        )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
                    {footer && (
                        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3">
                            {footer}
                        </div>
                    )}
                </div>
            )}
        </dialog>
    );
}
