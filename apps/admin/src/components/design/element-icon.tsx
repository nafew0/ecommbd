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
    // Phase 61.
    'section-title': <path d="M3.75 4.75h5M3.75 9h12.5M3.75 9v0M3.75 13.25h9.5M3.75 16.250h6" />,
    toggle: (
        <>
            <rect x="2.75" y="5.75" width="14.5" height="8.5" />
            <path d="M12 10h2.500M13.250 8.750v2.500M5.500 10h4" />
        </>
    ),
    accordion: (
        <>
            <path d="M2.750 3.750h14.500v4H2.750zM2.750 7.750h14.500v8.500H2.750z" />
            <path d="M12.500 5.750h2M5.250 11h6M5.250 13.500h4" />
        </>
    ),
    tabs: (
        <>
            <path d="M2.750 7.250h14.500v9H2.750zM2.750 7.250v-3.500h4.500v3.500M7.250 3.750h4.500v3.500" />
        </>
    ),
    notice: (
        <>
            <rect x="2.750" y="4.750" width="14.500" height="10.500" />
            <path d="M5.500 4.750v10.500M10 8v3M10 12.750v.250" />
        </>
    ),
    announcement: <path d="M3.750 8.250v3.500h2.500l6 3.500V4.750l-6 3.500h-2.500zM15 8a3 3 0 0 1 0 4" />,
    ticker: (
        <path d="M1.750 6.750h16.500M1.750 13.250h16.500M4.500 10h4M11.500 10h4M17 8.500l1.500 1.500-1.500 1.500" />
    ),
    steps: (
        <>
            <circle cx="4.750" cy="5.250" r="2" />
            <circle cx="4.750" cy="14.750" r="2" />
            <path d="M4.750 7.250v5.500M9.250 5.250h7M9.250 14.750h7" />
        </>
    ),
    compare: (
        <path d="M2.750 3.750h14.500v12.500H2.750zM2.750 8h14.500M2.750 12.250h14.500M8 3.750v12.500M12.750 3.750v12.500" />
    ),
    stat: <path d="M4 15.250V9.250M8 15.250V5.250M12 15.250v-7M16 15.250V3.750" />,
    progress: (
        <>
            <rect x="2.750" y="8" width="14.500" height="4" />
            <path d="M2.750 10h8.500" strokeWidth="4" />
        </>
    ),
    testimonial: (
        <>
            <path d="M2.750 3.750h14.500v9h-8l-3.500 3.500v-3.500h-3z" />
            <path d="M6 7.250h8M6 9.750h5" />
        </>
    ),
    social: (
        <>
            <circle cx="5" cy="10" r="2.250" />
            <circle cx="15" cy="5" r="2.250" />
            <circle cx="15" cy="15" r="2.250" />
            <path d="M7 9l6-3M7 11l6 3" />
        </>
    ),
    logos: (
        <>
            <rect x="2.750" y="7" width="4" height="6" />
            <rect x="8" y="7" width="4" height="6" />
            <rect x="13.250" y="7" width="4" height="6" />
        </>
    ),
    gallery: (
        <>
            <rect x="2.750" y="2.750" width="6.250" height="6.250" />
            <rect x="11" y="2.750" width="6.250" height="6.250" />
            <rect x="2.750" y="11" width="6.250" height="6.250" />
            <rect x="11" y="11" width="6.250" height="6.250" />
        </>
    ),
    carousel: (
        <>
            <rect x="5.750" y="4.750" width="8.500" height="10.500" />
            <path d="M2.750 6.750v6.500M17.250 6.750v6.500" />
        </>
    ),
    map: (
        <path d="M10 17.500s-5.250-4.500-5.250-9a5.250 5.250 0 0 1 10.500 0c0 4.500-5.250 9-5.250 9zM10 10.250a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    ),
    pricing: (
        <>
            <rect x="4.750" y="2.750" width="10.500" height="14.500" />
            <path d="M7.500 6.250h5M7.500 9.500h5M7.500 13.750h5" />
        </>
    ),
    call: (
        <path d="M6.750 2.750H4.500a1.750 1.750 0 0 0-1.750 2c.700 6.500 5.750 11.500 12.250 12.250a1.750 1.750 0 0 0 2-1.750V13.250l-3.250-1.250-1.750 1.750a10 10 0 0 1-4.500-4.500l1.750-1.750-1.250-3.250z" />
    ),
    whatsapp: (
        <path d="M3 17l1.100-3.800A7.250 7.250 0 1 1 7 16l-4 1zM7.500 7.750c0 2.500 2.250 4.750 4.750 4.750" />
    ),
    'product-card': (
        <>
            <rect x="4.25" y="2.75" width="11.5" height="9.5" />
            <path d="M4.25 14.75h8M4.25 17.25h4.5" />
        </>
    ),
    'product-row': (
        <>
            <rect x="2.75" y="5.25" width="6" height="6.5" />
            <rect x="11.25" y="5.25" width="6" height="6.5" />
            <path d="M2.75 14.25h6M11.25 14.25h6" />
        </>
    ),
    'buy-button': (
        <>
            <path d="M4.75 7.75h10.5l-.75 9H5.5l-.75-9zM7.5 7.75V6.5a2.5 2.5 0 0 1 5 0v1.25" />
            <path d="M10 10.5v4M8 12.5h4" />
        </>
    ),
    'floating-cart': (
        <>
            <rect x="2.75" y="2.75" width="14.500" height="14.500" strokeDasharray="2 2" />
            <path d="M5.25 11.25h6l-.5 4H5.75l-.5-4zM7 11.25v-.75a1.25 1.25 0 0 1 2.500 0v.75" />
        </>
    ),
    'contact-info': (
        <>
            <rect x="2.75" y="3.75" width="14.500" height="12.500" />
            <path d="M5.500 7.250h4M5.500 10h9M5.500 12.750h6.500" />
        </>
    ),
    'store-logo': (
        <>
            <path d="M3.250 8.250l1.250-4.500h11l1.250 4.500M3.250 8.250h13.500M4.750 8.250v8h10.500v-8" />
            <path d="M8.250 16.250v-4h3.500v4" />
        </>
    ),
    'store-menu': <path d="M2.750 6.250h4M8.750 6.250h4M14.750 6.250h2.500M2.750 10.250h14.500" />,
    'search-box': (
        <>
            <rect x="2.750" y="5.750" width="14.500" height="8.500" />
            <path d="M13 10.750a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3zM14.250 10.500l1.250 1.250" />
        </>
    ),
    'cart-link': (
        <path d="M4.750 7.250h10.500l-.75 9.500H5.500l-.75-9.500zM7.500 7.250V6a2.500 2.500 0 0 1 5 0v1.250" />
    ),
    'contact-form': (
        <>
            <rect x="2.750" y="2.750" width="14.500" height="3.500" />
            <rect x="2.750" y="8.250" width="14.500" height="3.500" />
            <path d="M11.250 14.250h6v3h-6z" />
        </>
    ),
    lock: (
        <>
            <rect x="4.250" y="8.750" width="11.500" height="8.500" />
            <path d="M6.750 8.750V6.500a3.250 3.250 0 0 1 6.500 0v2.250" />
        </>
    ),
    link: (
        <path d="M8.250 11.750a3.250 3.250 0 0 0 4.600 0l3-3a3.250 3.250 0 0 0-4.600-4.600l-1 1M11.750 8.250a3.250 3.250 0 0 0-4.600 0l-3 3a3.250 3.250 0 0 0 4.600 4.600l1-1" />
    ),
    page: (
        <>
            <path d="M4.750 2.750h7.500l3 3v11.500H4.750z" />
            <path d="M7.250 8.250h5.500M7.250 11h5.500M7.250 13.750h3" />
        </>
    ),
    email: <path d="M2.750 4.750h14.500v10.500H2.750zM2.750 5.500l7.250 5.500 7.250-5.500" />,
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
