import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useMessages } from './i18n';

interface ConfirmOptions {
    title: string;
    body?: string;
    confirmLabel?: string;
    danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

/** `const confirm = useConfirm(); if (await confirm({ title })) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
    const m = useMessages();
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const resolver = useRef<(answer: boolean) => void>(undefined);
    const confirm = useCallback<ConfirmFn>(next => {
        setOptions(next);
        return new Promise(resolve => {
            resolver.current = resolve;
        });
    }, []);
    const answer = (value: boolean) => {
        resolver.current?.(value);
        setOptions(null);
    };
    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <Dialog
                open={options !== null}
                onClose={() => answer(false)}
                title={options?.title ?? ''}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => answer(false)}>
                            {m.common.cancel}
                        </Button>
                        <Button variant={options?.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
                            {options?.confirmLabel ?? m.common.confirm}
                        </Button>
                    </>
                }
            >
                {options?.body && <p className="text-slate-700">{options.body}</p>}
            </Dialog>
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm needs <ConfirmProvider>');
    }
    return context;
}
