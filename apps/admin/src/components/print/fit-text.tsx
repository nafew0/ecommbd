import { type ReactNode, useLayoutEffect, useRef } from 'react';

/**
 * Shrinks its text until it fits its box, down to `minPt`, then lets it wrap (roadmap phase 06:
 * long addresses on small stickers). The box must have a fixed height from its parent.
 */
export function FitText({
    maxPt,
    minPt,
    fontsReady,
    className,
    children,
}: {
    maxPt: number;
    minPt: number;
    /** Measure again once the web font has loaded: its letters are wider than the fallback's. */
    fontsReady: boolean;
    className?: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const box = ref.current;
        if (!box) return;
        let size = maxPt;
        box.style.fontSize = `${size}pt`;
        while (box.scrollHeight > box.clientHeight + 1 && size > minPt) {
            size = Math.max(minPt, size - 0.5);
            box.style.fontSize = `${size}pt`;
        }
        box.dataset.fitPt = String(size);
    }, [maxPt, minPt, fontsReady, children]);
    return (
        <div
            ref={ref}
            className={className}
            style={{ fontSize: `${maxPt}pt`, overflow: 'hidden', height: '100%' }}
        >
            {children}
        </div>
    );
}
