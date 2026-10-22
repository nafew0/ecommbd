import { useEffect, useState } from 'react';

/** True while the media query matches (e.g. `(min-width: 1024px)`), updated as the window changes. */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const list = window.matchMedia(query);
        const update = () => setMatches(list.matches);
        update();
        list.addEventListener('change', update);
        return () => list.removeEventListener('change', update);
    }, [query]);
    return matches;
}
