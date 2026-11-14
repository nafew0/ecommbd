import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

const widths = {
    /** Lists, tables and the dashboard. */
    full: 'max-w-[1440px]',
    /** Detail and form pages with a side column. */
    wide: 'max-w-[1120px]',
    /** Settings pages and simple forms. */
    narrow: 'max-w-[760px]',
};

/** Every page starts with this: it sets the page's width (design guide, section 3.8). */
export function Page({
    width = 'wide',
    children,
    className,
}: {
    width?: keyof typeof widths;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div data-page={width} className={cn('mx-auto w-full', widths[width], className)}>
            {children}
        </div>
    );
}

/** A main column and a 320 px side column. Below `lg` the side column goes under the main one. */
export function TwoColumn({ main, side }: { main: ReactNode; side: ReactNode }) {
    return (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">{main}</div>
            <div className="min-w-0 space-y-4">{side}</div>
        </div>
    );
}
