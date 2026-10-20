import type { Language } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';

/** বাংলা | English. Signed in, the choice is saved for this staff member; before that, on this device. */
export function LanguageSwitch() {
    const { language, messages: m } = useI18n();
    const { setLanguage } = useAuth();
    const options: Language[] = ['bn', 'en'];
    return (
        <div
            role="group"
            aria-label={m.language.label}
            className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm"
        >
            {options.map(option => (
                <button
                    key={option}
                    type="button"
                    lang={option}
                    aria-pressed={language === option}
                    onClick={() => setLanguage(option)}
                    className={cn(
                        'min-h-9 rounded px-3',
                        language === option
                            ? 'bg-teal-700 font-medium text-white'
                            : 'text-slate-700 hover:bg-slate-100',
                    )}
                >
                    {m.language[option]}
                </button>
            ))}
        </div>
    );
}
