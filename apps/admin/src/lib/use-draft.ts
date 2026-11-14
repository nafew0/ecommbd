import { useCallback, useState } from 'react';

/**
 * A form's working copy, and whether it differs from what was last loaded or saved (so the save
 * bar knows when to show). Call `load` with what the server returned, on first load and after
 * each save; call `setDraft` for the merchant's edits.
 */
export function useDraft<T>(initial: T | null = null) {
    const [draft, setDraft] = useState<T | null>(initial);
    const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
    const load = useCallback((value: T) => {
        setDraft(value);
        setBaseline(JSON.stringify(value));
    }, []);
    const discard = useCallback(() => setDraft(JSON.parse(baseline) as T | null), [baseline]);
    const dirty = draft !== null && JSON.stringify(draft) !== baseline;
    return { draft, setDraft: setDraft as (value: T) => void, load, dirty, discard };
}
