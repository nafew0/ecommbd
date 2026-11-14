import { useMessages } from '../../lib/i18n';
import { AnimatePresence, GLIDE, m } from '../../lib/motion';
import { Button } from './button';

interface SaveBarProps {
    dirty: boolean;
    saving?: boolean;
    onSave(): void;
    onDiscard?(): void;
    saveLabel?: string;
}

/** Slides up from the bottom while a form has unsaved changes: "Unsaved changes · Discard · Save". */
export function SaveBar({ dirty, saving, onSave, onDiscard, saveLabel }: SaveBarProps) {
    const messages = useMessages();
    return (
        <AnimatePresence>
            {(dirty || saving) && (
                <m.div
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 80, opacity: 0 }}
                    transition={GLIDE}
                    className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-60"
                >
                    <div
                        role="region"
                        aria-label={messages.common.unsavedChanges}
                        className="flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-lg bg-bar px-4 py-2.5 text-white shadow-lg"
                    >
                        <p className="min-w-0 flex-1 text-sm">{messages.common.unsavedChanges}</p>
                        {onDiscard && (
                            <button
                                type="button"
                                onClick={onDiscard}
                                disabled={saving}
                                className="min-h-9 rounded-md px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                            >
                                {messages.common.discard}
                            </button>
                        )}
                        <Button
                            size="sm"
                            loading={saving}
                            onClick={onSave}
                            className="bg-white text-ink hover:bg-white/90 disabled:bg-white/60"
                        >
                            {saving ? messages.common.saving : (saveLabel ?? messages.common.save)}
                        </Button>
                    </div>
                </m.div>
            )}
        </AnimatePresence>
    );
}
