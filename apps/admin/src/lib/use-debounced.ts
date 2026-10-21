import { useEffect, useState } from 'react';

/** The value, once it has stopped changing for `ms` (search boxes: one request per pause, not per key). */
export function useDebounced<T>(value: T, ms = 300): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = window.setTimeout(() => setSettled(value), ms);
        return () => window.clearTimeout(timer);
    }, [value, ms]);
    return settled;
}
