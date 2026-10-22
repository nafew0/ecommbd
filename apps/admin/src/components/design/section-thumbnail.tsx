import type { ReactNode } from 'react';

/**
 * A small drawing of each section for the "Add section" library and the templates: what it looks
 * like at a glance, in the admin's own colours. Drawn on a 160 × 100 grid.
 */

const INK = '#94a3b8';
const SOFT = '#e2e8f0';
const ACCENT = '#0f766e';
const LIGHT = '#f8fafc';

const line = (x: number, y: number, width: number, height = 4, fill = INK) => (
    <rect key={`${x}-${y}-${width}`} x={x} y={y} width={width} height={height} rx={1} fill={fill} />
);
const box = (x: number, y: number, width: number, height: number, fill = SOFT) => (
    <rect
        key={`b${x}-${y}-${width}-${height}`}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={fill}
    />
);
const button = (x: number, y: number, width = 28, fill = ACCENT) => (
    <rect key={`k${x}-${y}`} x={x} y={y} width={width} height={8} rx={1.5} fill={fill} />
);
const icon = (x: number, y: number) => (
    <circle key={`i${x}-${y}`} cx={x} cy={y} r={5} fill={ACCENT} opacity={0.85} />
);

const DRAWINGS: Record<string, ReactNode> = {
    hero: [
        box(0, 0, 160, 100, '#cbd5e1'),
        line(46, 36, 68, 7, '#ffffff'),
        line(58, 50, 44, 4, '#f1f5f9'),
        button(64, 62, 32, '#ffffff'),
    ],
    slideshow: [
        box(0, 0, 160, 86, '#cbd5e1'),
        line(50, 34, 60, 7, '#ffffff'),
        button(66, 50, 28, '#ffffff'),
        <circle key="d1" cx={74} cy={93} r={2.5} fill={ACCENT} />,
        <circle key="d2" cx={80} cy={93} r={2.5} fill={INK} />,
        <circle key="d3" cx={86} cy={93} r={2.5} fill={INK} />,
    ],
    banner: [
        box(0, 18, 160, 64, ACCENT),
        line(14, 34, 50, 4, '#99f6e4'),
        line(14, 44, 76, 7, '#ffffff'),
        button(14, 60, 28, '#ffffff'),
        box(106, 28, 42, 44, '#5eead4'),
    ],
    'product-grid': [
        line(8, 8, 50, 6),
        ...[0, 1, 2, 3].flatMap(i => [
            box(8 + i * 37, 22, 33, 40),
            line(8 + i * 37, 66, 26, 3),
            line(8 + i * 37, 73, 16, 3, ACCENT),
        ]),
    ],
    'collection-list': [
        line(8, 8, 56, 6),
        ...[0, 1, 2, 3].flatMap(i => [box(8 + i * 37, 22, 33, 33), line(14 + i * 37, 60, 20, 3)]),
        ...[0, 1, 2, 3].flatMap(i => [box(8 + i * 37, 70, 33, 22)]),
    ],
    'featured-product': [
        box(8, 10, 68, 80),
        line(86, 20, 56, 7),
        line(86, 33, 30, 5, ACCENT),
        line(86, 46, 62),
        line(86, 54, 50),
        button(86, 68, 40),
    ],
    'image-with-text': [
        box(8, 14, 68, 72),
        line(86, 28, 50, 7),
        line(86, 42, 64),
        line(86, 50, 58),
        line(86, 58, 40),
        button(86, 70),
    ],
    'rich-text': [
        line(46, 22, 68, 7),
        line(24, 38, 112),
        line(30, 46, 100),
        line(40, 54, 80),
        button(66, 70),
    ],
    multicolumn: [
        line(50, 8, 60, 6),
        ...[0, 1, 2].flatMap(i => [
            icon(30 + i * 50, 34),
            line(16 + i * 50, 48, 28, 4),
            line(12 + i * 50, 57, 36, 3),
            line(16 + i * 50, 64, 28, 3),
        ]),
    ],
    faq: [
        line(8, 8, 60, 6),
        ...[0, 1, 2, 3].flatMap(i => [line(8, 26 + i * 18, 110, 4), box(8, 34 + i * 18, 144, 1, INK)]),
        ...[0, 1, 2, 3].map(i => line(144, 25 + i * 18, 8, 6, ACCENT)),
    ],
    'image-grid': [
        line(8, 8, 50, 6),
        ...[0, 1, 2].flatMap(row => [0, 1, 2].map(col => box(8 + col * 49, 20 + row * 0, 45, 34))),
        ...[0, 1, 2].map(col => box(8 + col * 49, 58, 45, 34)),
    ],
    video: [
        box(20, 10, 120, 72, '#334155'),
        <polygon key="p" points="74,36 74,56 90,46" fill="#ffffff" />,
        line(50, 88, 60, 3),
    ],
    testimonials: [
        line(44, 8, 72, 6),
        ...[0, 1, 2].flatMap(i => [
            box(8 + i * 49, 22, 45, 66, LIGHT),
            <rect
                key={`r${i}`}
                x={8 + i * 49}
                y={22}
                width={45}
                height={66}
                rx={2}
                fill="none"
                stroke={SOFT}
            />,
            line(13 + i * 49, 30, 24, 3, '#f59e0b'),
            line(13 + i * 49, 40, 34, 3),
            line(13 + i * 49, 47, 30, 3),
            line(13 + i * 49, 54, 26, 3),
            line(13 + i * 49, 74, 22, 4, '#64748b'),
        ]),
    ],
    'trust-badges': [
        ...[0, 1, 2, 3].flatMap(i => [
            icon(22 + i * 38, 44),
            line(12 + i * 38, 56, 22, 4, '#64748b'),
            line(12 + i * 38, 64, 18, 3),
        ]),
    ],
    'delivery-info': [
        line(8, 8, 70, 6),
        ...[0, 1].flatMap(i => [
            box(8 + i * 74, 22, 70, 50, LIGHT),
            <rect
                key={`d${i}`}
                x={8 + i * 74}
                y={22}
                width={70}
                height={50}
                rx={2}
                fill="none"
                stroke={SOFT}
            />,
            line(14 + i * 74, 30, 30, 4, '#64748b'),
            line(14 + i * 74, 44, 24, 6, ACCENT),
            line(14 + i * 74, 58, 40, 3),
        ]),
        line(8, 82, 100, 3),
    ],
    contact: [
        line(8, 8, 50, 6),
        ...[0, 1, 2].flatMap(i => [
            icon(16, 30 + i * 22),
            line(28, 26 + i * 22, 30, 3),
            line(28, 33 + i * 22, 50, 4, '#64748b'),
        ]),
        ...[0, 1, 2].flatMap(i => [
            icon(90, 30 + i * 22),
            line(102, 26 + i * 22, 30, 3),
            line(102, 33 + i * 22, 44, 4, '#64748b'),
        ]),
    ],
    'whatsapp-cta': [
        box(0, 12, 160, 76, LIGHT),
        line(40, 30, 80, 7),
        line(48, 43, 64, 3),
        button(34, 58, 44, '#16a34a'),
        button(84, 58, 42, '#ffffff'),
        <rect key="o" x={84} y={58} width={42} height={8} rx={1.5} fill="none" stroke={INK} />,
    ],
    divider: [line(8, 30, 144, 3, SOFT), box(8, 49, 144, 1.5, INK), line(8, 66, 144, 3, SOFT)],
    // Phase 16: sales sections and the Custom section.
    'sales-hero': [
        box(8, 8, 66, 84, '#cbd5e1'),
        box(10, 10, 14, 6, '#dc2626'),
        line(84, 16, 30, 5, SOFT),
        line(84, 28, 64, 7),
        line(84, 39, 56, 7, ACCENT),
        line(84, 54, 30, 7, '#dc2626'),
        button(84, 68, 64),
        line(84, 82, 44, 3),
    ],
    benefits: [
        line(8, 8, 60, 6),
        ...[0, 1, 2, 3].flatMap(i => [icon(14, 28 + i * 18), line(26, 26 + i * 18, 70 - i * 6, 4)]),
    ],
    specs: [
        line(8, 8, 50, 6),
        ...[0, 1, 2, 3].flatMap(i => [
            line(8, 26 + i * 18, 40, 4),
            line(70, 26 + i * 18, 60, 4, '#64748b'),
            box(8, 34 + i * 18, 144, 1, SOFT),
        ]),
    ],
    'price-packs': [
        line(50, 8, 60, 6),
        ...[0, 1, 2].flatMap(i => [
            <rect
                key={`p${i}`}
                x={8 + i * 50}
                y={22}
                width={44}
                height={70}
                rx={2}
                fill="#ffffff"
                stroke={i === 1 ? ACCENT : SOFT}
                strokeWidth={i === 1 ? 2 : 1}
            />,
            line(20 + i * 50, 34, 20, 4),
            line(16 + i * 50, 46, 28, 7, '#dc2626'),
            line(20 + i * 50, 58, 20, 3),
            button(14 + i * 50, 74, 32, i === 1 ? ACCENT : INK),
        ]),
    ],
    comparison: [
        line(40, 8, 80, 6),
        box(8, 22, 70, 10, SOFT),
        box(82, 22, 70, 10, ACCENT),
        ...[0, 1, 2].flatMap(i => [
            <circle key={`x${i}`} cx={16} cy={46 + i * 16} r={4} fill="#dc2626" opacity={0.85} />,
            line(24, 44 + i * 16, 46, 4),
            icon(90, 46 + i * 16),
            line(98, 44 + i * 16, 46, 4),
        ]),
    ],
    countdown: [
        box(0, 14, 160, 72, ACCENT),
        line(46, 24, 68, 5, '#99f6e4'),
        ...[0, 1, 2, 3].map(i => (
            <rect
                key={`c${i}`}
                x={22 + i * 30}
                y={40}
                width={24}
                height={30}
                rx={2}
                fill="none"
                stroke="#ffffff"
            />
        )),
    ],
    guarantee: [
        <circle key="seal" cx={34} cy={50} r={22} fill="none" stroke={ACCENT} strokeWidth={3} />,
        line(70, 34, 60, 7),
        line(70, 48, 80, 4, '#64748b'),
        line(70, 58, 70, 4, '#64748b'),
    ],
    'order-form': [
        box(24, 6, 112, 88, LIGHT),
        line(40, 14, 80, 5),
        ...[0, 1, 2].map(i => (
            <rect
                key={`f${i}`}
                x={32}
                y={26 + i * 14}
                width={96}
                height={9}
                rx={1.5}
                fill="#ffffff"
                stroke={SOFT}
            />
        )),
        <rect
            key="bump"
            x={32}
            y={68}
            width={96}
            height={8}
            rx={1.5}
            fill="none"
            stroke="#dc2626"
            strokeDasharray="3 2"
        />,
        button(32, 82, 96),
    ],
    custom: [
        box(8, 12, 66, 76, '#cbd5e1'),
        line(84, 20, 60, 7),
        line(84, 34, 66, 4, '#64748b'),
        line(84, 42, 54, 4, '#64748b'),
        icon(90, 58),
        line(100, 56, 40, 4),
        button(84, 72, 40),
    ],
};

export function SectionThumbnail({ type, className }: { type: string; className?: string }) {
    return (
        <svg viewBox="0 0 160 100" className={className} aria-hidden focusable="false">
            <rect width={160} height={100} fill="#ffffff" />
            {DRAWINGS[type] ?? line(20, 46, 120, 8)}
        </svg>
    );
}
