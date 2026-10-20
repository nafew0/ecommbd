import {
    forwardRef,
    type InputHTMLAttributes,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

const control =
    'block w-full rounded-md border bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-teal-600 disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
    { className, ...props },
    ref,
) {
    return <input ref={ref} className={cn(control, 'min-h-11 border-slate-300', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea({ className, ...props }, ref) {
        return (
            <textarea
                ref={ref}
                className={cn(control, 'min-h-24 border-slate-300 py-2 leading-relaxed', className)}
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
        <select ref={ref} className={cn(control, 'min-h-11 border-slate-300 pr-8', className)} {...props}>
            {children}
        </select>
    );
});
