import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from './cn';
import { useMessages } from './i18n';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
    id: number;
    kind: ToastKind;
    message: string;
}

interface ToastApi {
    success(message: string): void;
    error(message: string): void;
    info(message: string): void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

let nextId = 1;

/** Short messages under the top bar (the save bar is at the bottom), announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
    const m = useMessages();
    const [toasts, setToasts] = useState<Toast[]>([]);
    const dismiss = useCallback((id: number) => setToasts(list => list.filter(toast => toast.id !== id)), []);
    const show = useCallback(
        (kind: ToastKind, message: string) => {
            const id = nextId++;
            setToasts(list => [...list.slice(-2), { id, kind, message }]);
            window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
        },
        [dismiss],
    );
    const api = useMemo<ToastApi>(
        () => ({
            success: message => show('success', message),
            error: message => show('error', message),
            info: message => show('info', message),
        }),
        [show],
    );
    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                aria-live="polite"
                className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
            >
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        role={toast.kind === 'error' ? 'alert' : 'status'}
                        className={cn(
                            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
                            toast.kind === 'error'
                                ? 'border-red-200 bg-red-50 text-red-900'
                                : 'border-slate-200 bg-white text-slate-900',
                        )}
                    >
                        {toast.kind === 'error' ? (
                            <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
                        ) : (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" aria-hidden />
                        )}
                        <p className="min-w-0 flex-1">{toast.message}</p>
                        <button
                            type="button"
                            onClick={() => dismiss(toast.id)}
                            className="-m-1 rounded p-1 text-slate-500 hover:text-slate-900"
                            aria-label={m.common.close}
                        >
                            <X className="size-4" aria-hidden />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast needs <ToastProvider>');
    }
    return context;
}
