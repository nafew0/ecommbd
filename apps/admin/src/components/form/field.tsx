import { type ReactNode, useId } from 'react';
import { useMessages } from '../../lib/i18n';
import type { Messages } from '../../messages/en';

export interface ControlProps {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
}

interface FieldProps {
    label: string;
    hint?: string;
    /** An error code (`required`, `invalidPhone`…), translated here. */
    error?: string;
    optional?: boolean;
    badge?: ReactNode;
    children(control: ControlProps): ReactNode;
}

/** Turns an error code from validation into a sentence in the admin's language. */
export function errorText(m: Messages, code: string | undefined): string | undefined {
    if (!code) return undefined;
    return (m.errors as Record<string, string>)[code] ?? m.errors.invalid;
}

/** Label, control, hint and error, wired together for screen readers. */
export function Field({ label, hint, error, optional, badge, children }: FieldProps) {
    const m = useMessages();
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const message = errorText(m, error);
    const describedBy = [hint && hintId, message && errorId].filter(Boolean).join(' ') || undefined;
    return (
        <div className="space-y-1.5" data-field-error={message ? 'true' : undefined}>
            <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={id} className="font-medium">
                    {label}
                    {optional && (
                        <span className="ml-1 text-sm font-normal text-slate-500">({m.common.optional})</span>
                    )}
                </label>
                {badge}
            </div>
            {children({ id, 'aria-describedby': describedBy, 'aria-invalid': message ? true : undefined })}
            {hint && (
                <p id={hintId} className="text-sm text-slate-600">
                    {hint}
                </p>
            )}
            {message && (
                <p id={errorId} className="text-sm text-red-700">
                    {message}
                </p>
            )}
        </div>
    );
}
