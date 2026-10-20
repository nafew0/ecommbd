import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { bn } from '../messages/bn';
import { en, type Messages } from '../messages/en';
import { type Language, setApiLanguage } from './api';

/**
 * The admin's language. Before sign-in it's remembered on this device; after sign-in it's saved for
 * the staff member (Vendure's settings store, `bdAdmin.language`) by `useAuth().setLanguage`.
 * Bangla is the default.
 */

const STORAGE_KEY = 'ecommbd-admin-language';
const catalogs: Record<Language, Messages> = { bn, en };

function storedLanguage(): Language {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === 'en' || value === 'bn' ? value : 'bn';
    } catch {
        return 'bn';
    }
}

function applyLanguage(language: Language) {
    setApiLanguage(language);
    document.documentElement.lang = language;
    try {
        localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // Private mode or blocked storage: the choice just isn't remembered on this device.
    }
}

interface I18nContextValue {
    language: Language;
    messages: Messages;
    setLanguage(language: Language): void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<Language>(() => {
        const initial = storedLanguage();
        applyLanguage(initial);
        return initial;
    });
    const setLanguage = useCallback((next: Language) => {
        applyLanguage(next);
        setLanguageState(next);
    }, []);
    const value = useMemo(
        () => ({ language, messages: catalogs[language], setLanguage }),
        [language, setLanguage],
    );
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n needs <I18nProvider>');
    }
    return context;
}

export function useMessages(): Messages {
    return useI18n().messages;
}
