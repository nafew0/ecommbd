import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useMessages } from '../../lib/i18n';
import { AnimatePresence, m } from '../../lib/motion';
import { Button, type ButtonProps } from './button';

export interface ActionItem {
    label: string;
    onSelect(): void;
    icon?: ReactNode;
    /** Destructive actions (delete, cancel, block) are red and always confirm first. */
    tone?: 'danger';
    disabled?: boolean;
}

interface ActionMenuProps {
    items: ActionItem[];
    /** Defaults to "More". */
    label?: string;
    /** Replaces the button's content (an avatar, an icon). `label` is still its accessible name. */
    trigger?: ReactNode;
    variant?: ButtonProps['variant'];
    size?: ButtonProps['size'];
    className?: string;
}

/**
 * A button that opens a short list of actions: where a screen keeps everything that isn't its one
 * main button. The list is drawn above the page (never cut off by a card or table), closes on
 * Escape, an outside click or a scroll, and is moved through with the arrow keys.
 */
export function ActionMenu({
    items,
    label,
    trigger,
    variant = 'secondary',
    size = 'md',
    className,
}: ActionMenuProps) {
    const messages = useMessages();
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
    const name = label ?? messages.common.more;

    useLayoutEffect(() => {
        if (!open || !button.current) return;
        const rect = button.current.getBoundingClientRect();
        setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        const onPointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
        };
        const onScroll = (event: Event) => {
            if (!menu.current?.contains(event.target as Node)) close();
        };
        document.addEventListener('pointerdown', onPointer);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    const focusItem = (step: number) => {
        const enabled = [
            ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
        ];
        if (!enabled.length) return;
        const index = enabled.indexOf(document.activeElement as HTMLElement);
        enabled[(index + step + enabled.length) % enabled.length]?.focus();
    };

    if (!items.length) return null;
    return (
        <>
            <Button
                ref={button}
                variant={variant}
                size={size}
                className={className}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-label={trigger ? name : undefined}
                onClick={() => setOpen(value => !value)}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpen(true);
                        requestAnimationFrame(() => focusItem(1));
                    }
                }}
            >
                {trigger ?? (
                    <>
                        {name}
                        <ChevronDown className="size-4" aria-hidden />
                    </>
                )}
            </Button>
            {createPortal(
                <AnimatePresence>
                    {open && position && (
                        <m.div
                            ref={menu}
                            id={id}
                            role="menu"
                            aria-label={name}
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.12 }}
                            style={{ top: position.top, right: position.right, transformOrigin: 'top right' }}
                            className="fixed z-50 max-h-[70dvh] min-w-48 max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
                            onKeyDown={event => {
                                if (event.key === 'Escape') {
                                    setOpen(false);
                                    button.current?.focus();
                                }
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    focusItem(1);
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    focusItem(-1);
                                }
                                if (event.key === 'Tab') setOpen(false);
                            }}
                        >
                            {items.map(item => (
                                <button
                                    key={item.label}
                                    type="button"
                                    role="menuitem"
                                    disabled={item.disabled}
                                    onClick={() => {
                                        setOpen(false);
                                        button.current?.focus();
                                        item.onSelect();
                                    }}
                                    className={cn(
                                        'flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:text-ink-faint',
                                        item.tone === 'danger'
                                            ? 'text-danger hover:bg-danger-soft'
                                            : 'text-ink hover:bg-surface-muted',
                                    )}
                                >
                                    {item.icon}
                                    {item.label}
                                </button>
                            ))}
                        </m.div>
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </>
    );
}
