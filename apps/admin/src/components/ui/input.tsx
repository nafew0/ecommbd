import {
    forwardRef,
    type InputHTMLAttributes,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

const control =
    'block w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus:outline-2 focus:outline-offset-0 focus:outline-accent disabled:bg-surface-muted disabled:text-ink-muted aria-[invalid=true]:border-danger sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
    { className, ...props },
    ref,
) {
    return <input ref={ref} className={cn(control, 'min-h-11 sm:min-h-10', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea({ className, ...props }, ref) {
        return (
            <textarea
                ref={ref}
                className={cn(control, 'min-h-24 py-2 leading-relaxed', className)}
                {...props}
            />
        );
    },
);

/** A native select: the phone's own picker is the easiest to use on a small screen. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
    { className, children, ...props },
    ref,
) {
    return (
        <select ref={ref} className={cn(control, 'min-h-11 pr-8 sm:min-h-10', className)} {...props}>
            {children}
        </select>
    );
});
