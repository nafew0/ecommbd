import { useId } from 'react';
import { cn } from '../../lib/cn';

interface SwitchProps {
    checked: boolean;
    onChange(checked: boolean): void;
    label: string;
    description?: string;
    disabled?: boolean;
}

/** An on/off setting: a real checkbox (keyboard and screen readers work) drawn as a switch. */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
    const id = useId();
    return (
        <label
            htmlFor={id}
            className={cn('flex items-start gap-3', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
        >
            <input
                id={id}
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={checked}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
            />
            <span
                aria-hidden
                className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-600 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
            />
            <span className="min-w-0">
                <span className="block font-medium">{label}</span>
                {description && <span className="block text-sm text-slate-600">{description}</span>}
            </span>
        </label>
    );
}
