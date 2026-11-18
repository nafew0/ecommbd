import type { ReactNode } from 'react';

/**
 * The page builder's own icons (roadmap phase 56): one for each element, drawn for us on a 20 px
 * grid with a 1.5 px stroke and square ends, like the storefront's set. No icon library.
 */
const PATHS: Record<string, ReactNode> = {
    container: (
        <>
            <rect x="2.75" y="3.75" width="14.5" height="12.5" />
            <path d="M10 3.75v12.5" strokeDasharray="2 2" />
        </>
    ),
    heading: <path d="M4.75 4v12M15.25 4v12M4.75 10h10.5" />,
    text: <path d="M3.75 5.25h12.5M3.75 8.75h12.5M3.75 12.25h12.5M3.75 15.75h7" />,
    button: (
        <>
            <rect x="2.75" y="6.25" width="14.5" height="7.5" />
            <path d="M6.5 10h7" />
        </>
    ),
    image: (
        <>
            <rect x="2.75" y="3.75" width="14.5" height="12.5" />
            <path d="M2.75 13.5l4-4 3.5 3.5 2.5-2.5 4.5 4.5" />
            <path d="M12.75 7.25h.5v.5h-.5z" />
        </>
    ),
    icon: <path d="M10 2.75l2.2 4.6 5.05.7-3.65 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.65-3.5 5.05-.7z" />,
    list: (
        <>
            <path d="M7.25 5.25h9M7.25 10h9M7.25 14.75h9" />
            <path d="M3.5 5h.5v.5h-.5zM3.5 9.75h.5v.5h-.5zM3.5 14.5h.5v.5h-.5z" />
        </>
    ),
    'icon-list': (
        <>
            <path d="M8.25 5.25h8M8.25 10h8M8.25 14.75h8" />
            <path d="M2.75 5.25l1.25 1.25 2-2.25M2.75 10l1.25 1.25 2-2.25M2.75 14.75L4 16l2-2.25" />
        </>
    ),
    'icon-box': (
        <>
            <rect x="6.75" y="2.75" width="6.5" height="6.5" />
            <path d="M4.25 12.75h11.5M6.25 16.25h7.5" />
        </>
    ),
    badge: (
        <>
            <path d="M2.75 10.5V3.75h6.75l7.75 7.75-6.75 6.75z" />
            <path d="M6.25 7h.5v.5h-.5z" />
        </>
    ),
    quote: (
        <path d="M3.75 14.25v-4.5a4 4 0 0 1 4-4M3.75 10.25h3.5v4h-3.5zM11.25 14.25v-4.5a4 4 0 0 1 4-4M11.25 10.25h3.5v4h-3.5z" />
    ),
    divider: <path d="M2.75 10h14.5M6.25 5.75h7.5M6.25 14.25h7.5" strokeDasharray="0" />,
    spacer: (
        <path d="M3.75 3.75h12.5M3.75 16.25h12.5M10 6.5v7M7.75 8.5L10 6.25l2.25 2.25M7.75 11.5L10 13.75l2.25-2.25" />
    ),
    video: (
        <>
            <rect x="2.75" y="3.75" width="14.5" height="12.5" />
            <path d="M8.25 7.25v5.5l4.5-2.75z" />
        </>
    ),
    countdown: (
        <>
            <circle cx="10" cy="11" r="6.25" />
            <path d="M10 7.5V11l2.25 1.5M7.75 2.75h4.5" />
        </>
    ),
    price: <path d="M6.25 3.75v9.5a3 3 0 0 0 3 3h.5a3.5 3.5 0 0 0 3.5-3.5v-1.5h-2.5M3.75 7.25h8" />,
    stars: (
        <>
            <path d="M5.5 6.75l1.05 2.15 2.4.35-1.75 1.65.4 2.35-2.1-1.1-2.1 1.1.4-2.35-1.75-1.65 2.4-.35z" />
            <path d="M14.5 6.75l1.05 2.15 2.4.35-1.75 1.65.4 2.35-2.1-1.1-2.1 1.1.4-2.35-1.75-1.65 2.4-.35z" />
        </>
    ),
    live: (
        <>
            <rect x="2.75" y="3.75" width="14.5" height="12.5" />
            <path d="M10.75 6.25L7.5 10.5h5l-3.25 4.25" />
        </>
    ),
    // Editor actions.
    plus: <path d="M10 4.25v11.5M4.25 10h11.5" />,
    up: <path d="M10 15.75V4.25M5.25 9L10 4.25 14.75 9" />,
    down: <path d="M10 4.25v11.5M5.25 11L10 15.75 14.75 11" />,
    copy: (
        <>
            <rect x="6.75" y="6.75" width="10.5" height="10.5" />
            <path d="M13.25 3.75H2.75v10.5" />
        </>
    ),
    trash: (
        <path d="M3.75 5.75h12.5M7.75 5.75v-2h4.5v2M5.25 5.75l.75 10.5h8l.75-10.5M8.5 8.75v4.5M11.5 8.75v4.5" />
    ),
    eye: (
        <>
            <path d="M1.75 10S4.75 4.75 10 4.75 18.25 10 18.25 10 15.25 15.25 10 15.25 1.75 10 1.75 10z" />
            <circle cx="10" cy="10" r="2.25" />
        </>
    ),
    'eye-off': (
        <path d="M3.25 3.25l13.5 13.5M8.4 5a8 8 0 0 1 1.6-.25c5.25 0 8.25 5.25 8.25 5.25a13.500 13.500 0 0 1-2.3 2.85M12.9 14.6a7.300 7.300 0 0 1-2.9.65C4.750 15.250 1.750 10 1.750 10A13.400 13.400 0 0 1 5.500 6.250" />
    ),
    back: <path d="M12.25 4.75L7 10l5.25 5.250" />,
    chevron: <path d="M7.75 4.75L13 10l-5.25 5.250" />,
    open: <path d="M3.75 8V3.75H8M16.25 12v4.25H12M3.75 3.75l5 5M16.25 16.25l-5-5" />,
    desktop: (
        <>
            <rect x="2.75" y="3.75" width="14.5" height="9.5" />
            <path d="M7 16.25h6M10 13.250v3" />
        </>
    ),
    tablet: (
        <>
            <rect x="4.75" y="2.75" width="10.5" height="14.5" />
            <path d="M9 14.75h2" />
        </>
    ),
    phone: (
        <>
            <rect x="6.25" y="2.75" width="7.5" height="14.5" />
            <path d="M9.25 14.75h1.5" />
        </>
    ),
};

export type ElementIconName = keyof typeof PATHS;

export function ElementIcon({ name, className }: { name: string; className?: string }) {
    return (
        <svg
            viewBox="0 0 20 20"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            className={className}
            aria-hidden
        >
            {PATHS[name] ?? PATHS.container}
        </svg>
    );
}

/** A small drawing of a structure: how many columns, and how wide each is. */
export function StructureDiagram({ parts, vertical }: { parts: readonly number[]; vertical?: boolean }) {
    return (
        <span
            className={vertical ? 'flex h-7 w-full flex-col gap-0.5' : 'flex h-7 w-full gap-0.5'}
            aria-hidden
        >
            {parts.map((part, index) => (
                <span
                    key={index}
                    style={{ flexGrow: part }}
                    className="min-h-0 min-w-0 basis-0 rounded-[2px] bg-current opacity-25"
                />
            ))}
        </span>
    );
}
