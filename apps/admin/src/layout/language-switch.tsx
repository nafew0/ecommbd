import type { Language } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';

/** বাংলা | English. Signed in, the choice is saved for this staff member; before that, on this device. */
export function LanguageSwitch({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
    const { language, messages: m } = useI18n();
    const { setLanguage } = useAuth();
    const options: Language[] = ['bn', 'en'];
    return (
        <div
            role="group"
            aria-label={m.language.label}
            className={cn(
                'inline-flex shrink-0 rounded-md border p-0.5 text-sm',
                tone === 'dark' ? 'border-white/20' : 'border-line-strong bg-surface',
            )}
        >
            {options.map(option => (
                <button
                    key={option}
                    type="button"
                    lang={option}
                    aria-pressed={language === option}
                    onClick={() => setLanguage(option)}
                    className={cn(
                        'min-h-8 rounded px-2 sm:px-3',
                        tone === 'dark'
                            ? language === option
                                ? 'bg-white font-semibold text-ink'
                                : 'text-white/75 hover:text-white'
                            : language === option
                              ? 'bg-primary font-semibold text-white'
                              : 'text-ink-muted hover:bg-surface-muted',
                    )}
                >
                    {m.language[option]}
                </button>
            ))}
        </div>
    );
}
