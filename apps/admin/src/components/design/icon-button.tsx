import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/cn';

/** A compact icon-only button for the editor's dense rows (its label goes in `aria-label`). */
export const IconButton = forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'danger' }
>(function IconButton({ className, tone = 'default', type = 'button', ...props }, ref) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded text-slate-500 transition-colors focus-visible:outline-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-35',
                tone === 'danger'
                    ? 'hover:bg-red-50 hover:text-red-700'
                    : 'hover:bg-slate-100 hover:text-slate-900',
                className,
            )}
            {...props}
        />
    );
});
