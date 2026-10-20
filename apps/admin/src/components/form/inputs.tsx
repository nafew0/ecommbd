import { formatBdPhone, parseBdPhone } from '@ecommbd/shared/phone';
import { asciiToBanglaDigits } from '@ecommbd/shared/text';
import { type InputHTMLAttributes, useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { Input } from '../ui/input';
import { formatTakaInput, fromDhakaInputValue, parseTakaInput, toDhakaInputValue } from './values';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * A Bangladeshi phone number. Accepts Bangla digits, +880, spaces and dashes; tidies it to
 * 01712-345678 when the field loses focus. The server stores it as E.164.
 */
export function PhoneInput({
    value,
    onChange,
    onBlur,
    ...props
}: BaseProps & { value: string; onChange(value: string): void }) {
    const { messages: m } = useI18n();
    return (
        <Input
            {...props}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={m.inputs.phonePlaceholder}
            value={value.startsWith('+880') ? formatBdPhone(value) : value}
            onChange={event => onChange(event.target.value)}
            onBlur={event => {
                const parsed = parseBdPhone(event.target.value);
                if (parsed.ok) onChange(formatBdPhone(parsed.phone.e164));
                onBlur?.(event);
            }}
        />
    );
}

/**
 * A price in whole taka. Accepts Bangla digits and commas; shows lakh grouping (১,০০,০০০ / 1,00,000)
 * in the admin's language. The value is in poisha (integer), `null` when empty.
 */
export function TakaInput({
    value,
    onChange,
    onInvalid,
    onBlur,
    ...props
}: BaseProps & {
    value: number | null;
    onChange(minor: number | null): void;
    onInvalid?(reason: 'invalid' | 'fraction'): void;
}) {
    const { language, messages: m } = useI18n();
    const [text, setText] = useState(() => formatTakaInput(value, language === 'bn'));
    useEffect(() => setText(formatTakaInput(value, language === 'bn')), [value, language]);
    return (
        <div className="relative">
            <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500"
            >
                ৳
            </span>
            <Input
                {...props}
                type="text"
                inputMode="numeric"
                placeholder={m.inputs.takaPlaceholder}
                className="pl-7"
                value={text}
                onChange={event => setText(event.target.value)}
                onBlur={event => {
                    const parsed = parseTakaInput(event.target.value);
                    if (parsed.ok) {
                        onChange(parsed.minor);
                        setText(formatTakaInput(parsed.minor, language === 'bn'));
                    } else {
                        onInvalid?.(parsed.reason);
                    }
                    onBlur?.(event);
                }}
            />
        </div>
    );
}

/** A date and time in Bangladesh time, whatever the device's time zone. The value is a UTC ISO string. */
export function DhakaDateTimeInput({
    value,
    onChange,
    ...props
}: BaseProps & { value: string | null; onChange(iso: string | null): void }) {
    return (
        <Input
            {...props}
            type="datetime-local"
            value={toDhakaInputValue(value)}
            onChange={event => onChange(fromDhakaInputValue(event.target.value))}
        />
    );
}

/** Shows a number in the admin's digits. */
export function useDigits() {
    const { language } = useI18n();
    return (text: string | number) => (language === 'bn' ? asciiToBanglaDigits(String(text)) : String(text));
}
