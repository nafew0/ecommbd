import { formatTaka } from '@ecommbd/shared/money';
import { formatBdPhone } from '@ecommbd/shared/phone';
import { formatDhaka } from '@ecommbd/shared/time';
import { useMemo } from 'react';
import { useI18n } from './i18n';

/**
 * Money, dates and numbers in the admin's language: Bangla digits in the Bangla admin, dates in
 * Dhaka time. Phone numbers keep Latin digits everywhere, because staff dial and copy them.
 */
export function useFormat() {
    const { language } = useI18n();
    return useMemo(() => {
        const banglaDigits = language === 'bn';
        return {
            money: (minor: number) => formatTaka(minor, { banglaDigits }),
            date: (iso: string | null | undefined) =>
                iso ? formatDhaka(new Date(iso), { banglaDigits }) : '',
            dateTime: (iso: string | null | undefined) =>
                iso ? formatDhaka(new Date(iso), { banglaDigits, withTime: true }) : '',
            phone: (e164: string | null | undefined) => (e164 ? formatBdPhone(e164) : ''),
        };
    }, [language]);
}
