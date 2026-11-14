import { Loader2 } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/40',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-muted disabled:text-ink-faint',
    ghost: 'text-ink-muted hover:bg-line/60 hover:text-ink disabled:text-ink-faint',
    danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40',
};

const sizes: Record<Size, string> = {
    sm: 'min-h-9 px-3 text-sm',
    md: 'min-h-11 px-4 text-sm sm:min-h-10',
    icon: 'size-10 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    /** Shows a spinner and disables the button. */
    loading?: boolean;
}

/** One `primary` button per screen (the next step). Buttons are 44 px tall on phones (`md`), and wrap long Bangla labels instead of overflowing. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            className={cn(
                'inline-flex items-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed',
                variants[variant],
                sizes[size],
                className,
            )}
            {...props}
        >
            {loading && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
            {children}
        </button>
    );
});
